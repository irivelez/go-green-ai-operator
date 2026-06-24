// offer_slots + confirm_booking — moved verbatim from src/agent-tools.ts during
// the mechanical split.

import { z } from "zod";
import { availableSlots, bookSlot } from "../scheduler";
import { upsertLead, getLead } from "../store";
import { createCrewEvent } from "../calendar";
import { type SlotOffer } from "../contract";
import { type ToolContext, PAID_STATES } from "./shared";

// ─────────────────────────────────────────────────────────────────────────────
// offer_slots
// ─────────────────────────────────────────────────────────────────────────────

export const OfferSlotsArgsSchema = z.object({});

export async function runOfferSlots(ctx: ToolContext): Promise<SlotOffer[]> {
  // Async for uniform run* shape; availableSlots does not touch the store.
  return availableSlots(ctx.leadId);
}

// ─────────────────────────────────────────────────────────────────────────────
// confirm_booking — refuses until the lead is paid; idempotent via scheduler
// ─────────────────────────────────────────────────────────────────────────────

export interface ConfirmBookingResult {
  status: "payment_required" | "lead_missing" | "booked" | "taken" | "out_of_window";
  slot?: SlotOffer;
  message?: string;
}

export const ConfirmBookingArgsSchema = z.object({ slotId: z.string() });

export async function runConfirmBooking(
  ctx: ToolContext,
  args: z.infer<typeof ConfirmBookingArgsSchema>,
): Promise<ConfirmBookingResult> {
  const lead = await getLead(ctx.leadId);
  if (!lead) return { status: "lead_missing", message: "Lead not found." };
  // Gate on PROOF of a real Stripe charge (lead.paid_at, set ONLY by the webhook
  // reducer handleStripeEvent), not on the status string alone. operator.ts and
  // hitl.ts also set status "Ready to Schedule" for the dashboard view WITHOUT any
  // charge — gating on status alone is a latent payment-gate bypass. Require BOTH:
  // a paid status AND the webhook's payment marker.
  if (!PAID_STATES.has(lead.status) || !lead.paid_at) {
    return {
      status: "payment_required",
      message: "Booking is only available after the first payment is confirmed.",
    };
  }
  const result = await bookSlot(ctx.leadId, args.slotId);
  if (!result.ok) {
    return { status: result.reason === "lead_missing" ? "lead_missing" : result.reason };
  }
  await upsertLead({
    lead_id: ctx.leadId,
    channel: lead.channel,
    status: "Scheduled",
    visit_at: result.slot.startTime,
    work_order: {
      slotId: result.slot.slotId,
      date: result.slot.date,
      window: `${result.slot.startTime}–${result.slot.endTime}`,
      crewSize: result.slot.crewSize,
    },
  });
  // Fire-and-forget crew handoff (spec §A.5). Calendar failure MUST NOT fail the booking;
  // createCrewEvent never throws, BUT the .then body now awaits two store ops (getLead +
  // upsertLead) that CAN throw on Upstash REST. Surface those via console.warn instead of
  // silently swallowing — Constitution §8 forbids empty catches (errors are events, never
  // swallowed). We still don't rethrow: the booking is already persisted, so a calendar
  // hiccup must not surface as an HTTP error to the customer.
  void createCrewEvent({
    lead_id: ctx.leadId,
    address: lead.address ?? "",
    sqft: lead.confirmed_sqft ?? lead.estimated_sqft ?? 0,
    slope_tier: lead.slope_tier ?? "flat",
    tier_name: lead.suggested_package ?? "Maintenance",
    start_iso: result.slot.startTime,
    end_iso: result.slot.endTime,
    paid: true,
  })
    .then(async (r) => {
      if (r.eventId) {
        const fresh = await getLead(ctx.leadId);
        await upsertLead({
          lead_id: ctx.leadId,
          channel: fresh?.channel ?? lead.channel,
          work_order: { ...(fresh?.work_order ?? {}), calendar_event_id: r.eventId },
        });
      }
    })
    .catch((e) =>
      console.warn(
        `[booking] calendar handoff failed for lead=${ctx.leadId}: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  return { status: "booked", slot: result.slot };
}
