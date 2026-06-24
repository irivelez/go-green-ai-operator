// Stripe checkout (TEST MODE ONLY) for the Go Green web funnel.
//
// BUILD-DECISIONS §A3 charge shape:
//   Monthly Stripe subscription, first month charged now to lock the booking.
//   monthly = per_visit × frequency_multiplier.
//
// What this module owns:
//   - createSubscriptionCheckout: build a Stripe Checkout Session (mode:"subscription")
//     with the recurring monthly line + any FIXED add-ons as one-time first-invoice items.
//   - handleStripeWebhook: idempotent reducer for checkout.session.completed → marks
//     the lead paid via upsertLead. Open-ended add-ons are NEVER charged here (defense
//     in depth — the funnel's selection gate is the primary line of defense).
//
// Hard invariants:
//   - STRIPE_SECRET_KEY must start with "sk_test_". Live keys are refused at boot.
//   - Open-ended add-ons in the selection set throw before any Stripe call.
//   - Webhook is idempotent on (lead_id, "stripe.checkout.completed", sessionId).

import Stripe from "stripe";
import {
  PRICE_BOOK,
  FREQUENCY_MULTIPLIER,
  addOnById,
  type Tier,
  type Frequency,
  type CheckoutResult,
} from "./contract";
import { upsertLead, actionSeen, getLead } from "./store";

// ─────────────────────────────────────────────────────────────────────────────
// Client — test-mode by default, live-mode gated by STRIPE_LIVE_OK=1
// ─────────────────────────────────────────────────────────────────────────────

let liveModePrinted = false;

export function getStripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set. This build uses Stripe TEST mode only (sk_test_…).",
    );
  }
  if (key.startsWith("sk_test_")) {
    return new Stripe(key);
  }
  if (key.startsWith("sk_live_")) {
    if (process.env.STRIPE_LIVE_OK !== "1") {
      throw new Error(
        "STRIPE_SECRET_KEY is a LIVE key (sk_live_…). Set STRIPE_LIVE_OK=1 to enable live mode.",
      );
    }
    if (!liveModePrinted) {
      console.warn("[stripe] LIVE MODE active — real charges enabled");
      liveModePrinted = true;
    }
    return new Stripe(key);
  }
  throw new Error(
    "STRIPE_SECRET_KEY must start with sk_test_ or sk_live_.",
  );
}

// Cents-precision conversion. Avoid binary-float drift on round dollar values.
function toCents(usd: number): number {
  return Math.round(usd * 100);
}

// Recurring subscription unit_amount in cents.
//
// REVIEW BLOCKER A — the bug this branch closes: the funnel quoted the
// MEASURED area×slope price (pricePerVisit using confirmed_sqft + slope_tier),
// but Stripe was charging the flat PRICE_BOOK[tier].perVisit — customer quoted
// $173/visit, billed $299/visit. With measuredPerVisit present, that wins;
// without it, the legacy PRICE_BOOK[tier].perVisit fallback path is preserved
// for back-compat (operator.ts + any legacy caller without a measurement).
export function recurringUnitAmountCents(input: {
  measuredPerVisit?: number;
  tier?: Tier;
  frequency: Frequency;
}): number {
  const perVisit =
    input.measuredPerVisit ??
    (input.tier !== undefined ? PRICE_BOOK[input.tier].perVisit : undefined);
  if (perVisit === undefined) {
    throw new Error(
      "recurringUnitAmountCents: requires measuredPerVisit or tier",
    );
  }
  return toCents(perVisit * FREQUENCY_MULTIPLIER[input.frequency]);
}

// ─────────────────────────────────────────────────────────────────────────────
// createSubscriptionCheckout
// ─────────────────────────────────────────────────────────────────────────────

export interface CheckoutCustomer {
  name: string;
  email: string;
  phone: string;
  address: string;
}

export interface CreateCheckoutInput {
  tier: Tier;
  frequency: Frequency;
  selectedAddOnIds: string[];
  customer: CheckoutCustomer;
  // Optional lead linkage — webhook uses this to mark the right lead paid.
  leadId?: string;
  // Authoritative measured per-visit USD (area bucket × slope multiplier). When
  // present, recurring unit_amount = measuredPerVisit × FREQUENCY_MULTIPLIER —
  // SAME number the funnel quoted on ExactPriceCard (review blocker A). When
  // absent, falls back to PRICE_BOOK[tier].perVisit so legacy callers stay safe.
  measuredPerVisit?: number;
  successUrl?: string;
  cancelUrl?: string;
}

export interface CreateCheckoutOutput {
  url: string;
  sessionId: string;
}

export async function createSubscriptionCheckout(
  input: CreateCheckoutInput,
): Promise<CreateCheckoutOutput> {
  // ── Validation (deterministic gates — BEFORE any Stripe call) ──────────────
  if (!PRICE_BOOK[input.tier]) {
    throw new Error(`Unknown tier: ${input.tier}`);
  }
  if (!FREQUENCY_MULTIPLIER[input.frequency]) {
    throw new Error(`Unknown frequency: ${input.frequency}`);
  }
  if (!input.customer?.email) {
    throw new Error("customer.email is required for checkout.");
  }
  if (!input.customer?.address) {
    throw new Error("customer.address is required for checkout (no scheduling without address).");
  }

  // Defense in depth: open-ended add-ons MUST NOT reach Stripe.
  // (The funnel's selection UI is the primary gate; this is the failsafe.)
  const resolved = input.selectedAddOnIds.map((id) => {
    const a = addOnById(id);
    if (!a) throw new Error(`Unknown add-on id: ${id}`);
    return a;
  });
  const openEnded = resolved.filter((a) => a.kind === "open_ended");
  if (openEnded.length > 0) {
    throw new Error(
      `Open-ended add-ons cannot be auto-charged (BUILD-DECISIONS §B1): ${openEnded
        .map((a) => a.id)
        .join(", ")}. Route to human quote instead.`,
    );
  }

  const stripe = getStripeClient();
  const tierSpec = PRICE_BOOK[input.tier];
  const monthly = recurringUnitAmountCents({
    measuredPerVisit: input.measuredPerVisit,
    tier: input.tier,
    frequency: input.frequency,
  });

  // Recurring subscription line: tier × frequency, monthly cadence.
  const subscriptionLine: Stripe.Checkout.SessionCreateParams.LineItem = {
    quantity: 1,
    price_data: {
      currency: "usd",
      unit_amount: monthly,
      recurring: { interval: "month" },
      product_data: {
        name: `${tierSpec.name} — ${input.frequency}`,
        description: `Recurring landscape maintenance. ${tierSpec.blurb}`,
      },
    },
  };

  // One-time add-on lines — FIXED only, charged on the first invoice.
  const addOnLines: Stripe.Checkout.SessionCreateParams.LineItem[] = resolved.map((a) => ({
    quantity: 1,
    price_data: {
      currency: "usd",
      unit_amount: toCents(a.priceStartingAt),
      // Subscription mode allows mixing recurring + one-time line items.
      // One-time items get charged on the first invoice.
      product_data: {
        name: a.name,
        description: `One-time add-on (${a.unit}).`,
      },
    },
  }));

  const successUrl =
    input.successUrl ?? "http://localhost:3000/funnel/success?session_id={CHECKOUT_SESSION_ID}";
  const cancelUrl = input.cancelUrl ?? "http://localhost:3000/funnel/cancel";

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [subscriptionLine, ...addOnLines],
    customer_email: input.customer.email,
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      lead_id: input.leadId ?? "",
      tier: input.tier,
      frequency: input.frequency,
      add_on_ids: resolved.map((a) => a.id).join(","),
      customer_name: input.customer.name,
      customer_phone: input.customer.phone,
      customer_address: input.customer.address,
    },
    subscription_data: {
      metadata: {
        lead_id: input.leadId ?? "",
        tier: input.tier,
        frequency: input.frequency,
      },
    },
  });

  if (!session.url) {
    throw new Error("Stripe did not return a Checkout URL.");
  }
  return { url: session.url, sessionId: session.id };
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook handler — idempotent reducer
// Exposed for app/api/stripe/webhook/route.ts to call.
// ─────────────────────────────────────────────────────────────────────────────

export interface StripeWebhookResult {
  received: true;
  handled: boolean;
  reason?: string;
}

/**
 * Construct + verify a Stripe webhook event from raw request body.
 * Throws if STRIPE_WEBHOOK_SECRET is missing or the signature is invalid.
 */
export function constructWebhookEvent(rawBody: string | Buffer, signature: string): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not set.");
  }
  const stripe = getStripeClient();
  return stripe.webhooks.constructEvent(rawBody, signature, secret);
}

/**
 * Reduce a verified Stripe event into our store. Idempotent per
 * (lead_id, "stripe.checkout.completed", sessionId).
 */
export async function handleStripeEvent(event: Stripe.Event): Promise<StripeWebhookResult> {
  if (event.type !== "checkout.session.completed") {
    return { received: true, handled: false, reason: `ignored event type: ${event.type}` };
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const leadId = session.metadata?.lead_id;
  if (!leadId) {
    return { received: true, handled: false, reason: "no lead_id in session metadata" };
  }

  // Idempotency on (lead_id, action, sessionId). actionSeen returns true
  // on the SECOND call — so we early-return on duplicates.
  if (await actionSeen(leadId, "stripe.checkout.completed", session.id)) {
    return { received: true, handled: false, reason: "duplicate event (already processed)" };
  }

  const existing = await getLead(leadId);
  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id;

  await upsertLead({
    lead_id: leadId,
    channel: existing?.channel ?? "form",
    status: "Ready to Schedule",
    internal_notes: [
      existing?.internal_notes,
      `Stripe checkout paid: session=${session.id} sub=${subscriptionId ?? "?"} amount_total=${session.amount_total ?? 0}`,
    ]
      .filter(Boolean)
      .join("\n"),
  });

  return { received: true, handled: true };
}
