// Proof driver — Stripe webhook idempotency SURVIVES the RMW race (todo 13, S7).
//
// Now that A1 made store writes per-field-atomic, this proves: a webhook flipping
// `paid` concurrently with a chat-path write of `confirmed_sqft` loses NEITHER
// field, AND replaying the same event id is a no-op (the idempotency ledger).
// Run: npx tsx src/stripe.test.ts

import type Stripe from "stripe";
import { handleStripeEvent } from "./stripe";
import { resetStore, upsertLead, getLead } from "./store";
import { resetEvents } from "./events";
import { createJobWithFirstVisit, getJob, resetJobs } from "./job";

let pass = 0,
  fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

// Minimal checkout.session.completed event for a lead.
function checkoutCompleted(leadId: string, sessionId: string): Stripe.Event {
  return {
    id: `evt_${sessionId}`,
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        metadata: { lead_id: leadId, tier: "signature", frequency: "biweekly" },
        subscription: `sub_${sessionId}`,
        customer: `cus_${sessionId}`,
        amount_total: 19000,
        customer_email: "race@example.com",
      },
    },
  } as unknown as Stripe.Event;
}

async function main() {
  console.log("\n=== Stripe 1: webhook (paid) + concurrent chat write (confirmed_sqft) — BOTH survive ===");
  {
    resetStore([]);
    resetEvents();
    await upsertLead({ lead_id: "RW1", channel: "form", customer_email: "race@example.com" });

    await Promise.all([
      handleStripeEvent(checkoutCompleted("RW1", "cs_RW1")),
      upsertLead({ lead_id: "RW1", channel: "form", confirmed_sqft: 2500 }),
    ]);

    const lead = await getLead("RW1");
    ok("status flipped to PAID by webhook", lead?.status === "PAID", lead?.status);
    ok("concurrent confirmed_sqft survived", lead?.confirmed_sqft === 2500, String(lead?.confirmed_sqft));
  }

  console.log("\n=== Stripe 2: replay same event id → no-op (idempotency ledger) ===");
  {
    resetStore([]);
    resetEvents();
    await upsertLead({ lead_id: "RW2", channel: "form", customer_email: "race@example.com" });

    const first = await handleStripeEvent(checkoutCompleted("RW2", "cs_RW2"));
    const second = await handleStripeEvent(checkoutCompleted("RW2", "cs_RW2"));
    ok("first event handled", first.handled === true, JSON.stringify(first));
    ok("replay is a no-op (duplicate)", second.handled === false, JSON.stringify(second));
    ok("lead still PAID exactly once", (await getLead("RW2"))?.status === "PAID");
  }

  console.log("\n=== Stripe 3: chat write LANDS between two webhook replays → field survives + single state change ===");
  {
    resetStore([]);
    resetEvents();
    await upsertLead({ lead_id: "RW3", channel: "form", customer_email: "race@example.com" });

    await handleStripeEvent(checkoutCompleted("RW3", "cs_RW3")); // first: flips PAID
    await upsertLead({ lead_id: "RW3", channel: "form", confirmed_sqft: 1800 }); // chat write between
    const replay = await handleStripeEvent(checkoutCompleted("RW3", "cs_RW3")); // replay: no-op

    const lead = await getLead("RW3");
    ok("replay after a chat write is still a no-op", replay.handled === false);
    ok("status PAID preserved", lead?.status === "PAID", lead?.status);
    ok("the interleaved confirmed_sqft survived", lead?.confirmed_sqft === 1800, String(lead?.confirmed_sqft));
  }

  console.log("\n=== Stripe 4: non-checkout event ignored ===");
  {
    resetStore([]);
    const ignored = await handleStripeEvent({ id: "evt_x", type: "invoice.created", data: { object: {} } } as unknown as Stripe.Event);
    ok("unrelated event type ignored", ignored.handled === false, JSON.stringify(ignored));
  }

  console.log("\n=== Stripe 5: invoice.payment_failed → Job past_due + escalation (C23) ===");
  {
    resetStore([]);
    resetJobs();
    // Seed a Job for the subscription so the webhook has something to flip.
    await createJobWithFirstVisit({
      customer_email: "pf@example.com",
      stripe_subscription_id: "sub_pf",
      frequency: "biweekly",
      tier: "signature",
      scheduled_at: "2026-07-01T15:00:00-07:00",
      slot_id: "2026-07-01-T1",
    });
    const evt = {
      id: "evt_pf_1",
      type: "invoice.payment_failed",
      data: { object: { subscription: "sub_pf" } },
    } as unknown as Stripe.Event;
    const r = await handleStripeEvent(evt);
    ok("payment_failed handled", r.handled === true, JSON.stringify(r));
    ok("job marked past_due", (await getJob("job_sub_pf"))?.status === "past_due");
    // Replay same event id → no-op (global stripe:event dedup).
    const replay = await handleStripeEvent(evt);
    ok("replay same event id → no-op", replay.handled === false, JSON.stringify(replay));
  }

  console.log("\n=== Stripe 6: customer.subscription.deleted → Job canceled (C23) ===");
  {
    resetStore([]);
    resetJobs();
    await createJobWithFirstVisit({
      customer_email: "del@example.com",
      stripe_subscription_id: "sub_del",
      frequency: "weekly",
      tier: "essential",
      scheduled_at: "2026-07-02T15:00:00-07:00",
      slot_id: "2026-07-02-T1",
    });
    const evt = {
      id: "evt_del_1",
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_del" } },
    } as unknown as Stripe.Event;
    const r = await handleStripeEvent(evt);
    ok("subscription.deleted handled", r.handled === true, JSON.stringify(r));
    ok("job marked canceled", (await getJob("job_sub_del"))?.status === "canceled");
    const replay = await handleStripeEvent(evt);
    ok("replay subscription.deleted → single state change", replay.handled === false, JSON.stringify(replay));
  }

  console.log("\n=== Stripe 7: B2 chain — paid webhook → Job keyed on real sub id → payment_failed finds it ===");
  {
    resetStore([]);
    resetEvents();
    resetJobs();
    // 1) Paid webhook lands → writes the REAL subscription id (sub_b2) onto the lead.
    await upsertLead({ lead_id: "B2", channel: "form", customer_email: "b2@example.com" });
    const completed = {
      id: "evt_b2_paid",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_b2", // Checkout SESSION id (NOT the subscription id)
          metadata: { lead_id: "B2", tier: "signature", frequency: "biweekly" },
          subscription: "sub_b2", // the REAL subscription id
          customer: "cus_b2",
          amount_total: 19000,
        },
      },
    } as unknown as Stripe.Event;
    await handleStripeEvent(completed);
    const paidLead = await getLead("B2");
    ok("lead carries the real subscription id after paid webhook", paidLead?.stripe_subscription_id === "sub_b2", String(paidLead?.stripe_subscription_id));

    // 2) Booking creates the Job keyed on the REAL sub id (mirrors runConfirmBooking wiring).
    const { job } = await createJobWithFirstVisit({
      customer_email: paidLead!.customer_email!,
      stripe_subscription_id: paidLead!.stripe_subscription_id ?? paidLead!.staged_session_id,
      frequency: "biweekly",
      tier: "signature",
      scheduled_at: "2026-07-01T15:00:00-07:00",
      slot_id: "2026-07-01-T1",
    });
    ok("Job keyed on sub id (job_sub_b2), NOT session id", job.job_id === "job_sub_b2", job.job_id);

    // 3) payment_failed webhook keys on the SAME sub id → finds + flips the real Job.
    const failed = {
      id: "evt_b2_fail",
      type: "invoice.payment_failed",
      data: { object: { subscription: "sub_b2" } },
    } as unknown as Stripe.Event;
    await handleStripeEvent(failed);
    ok("payment_failed flips the SAME Job to past_due (no orphan)", (await getJob("job_sub_b2"))?.status === "past_due");
  }

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail === 0 ? 0 : 1);
}
void main();
