// Stripe checkout (TEST MODE ONLY) for the Go Green web funnel.
//
// BUILD-DECISIONS §A3 charge shape:
//   Monthly Stripe subscription, first month charged now to lock the booking.
//   monthly = per_visit × frequency_multiplier.
//
// What this module owns:
//   - createSubscriptionCheckout: build a Stripe Checkout Session (mode:"subscription")
//     with the recurring monthly line + any FIXED add-ons as one-time first-invoice items.
//   - confirmPayment: read back a Checkout Session to confirm it succeeded.
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
// Client — test-mode only
// ─────────────────────────────────────────────────────────────────────────────

function getStripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set. This build uses Stripe TEST mode only (sk_test_…).",
    );
  }
  if (!key.startsWith("sk_test_")) {
    throw new Error(
      "STRIPE_SECRET_KEY must be a TEST-mode key (sk_test_…). Live keys are not accepted.",
    );
  }
  return new Stripe(key);
}

// Cents-precision conversion. Avoid binary-float drift on round dollar values.
function toCents(usd: number): number {
  return Math.round(usd * 100);
}

// Per-visit × freq multiplier, in integer cents.
function monthlyCents(tier: Tier, frequency: Frequency): number {
  const perVisit = PRICE_BOOK[tier].perVisit;
  const monthly = perVisit * FREQUENCY_MULTIPLIER[frequency];
  return toCents(monthly);
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
  const monthly = monthlyCents(input.tier, input.frequency);

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
// confirmPayment — read-back, used by success_url handler or polling
// ─────────────────────────────────────────────────────────────────────────────

export async function confirmPayment(sessionId: string): Promise<CheckoutResult> {
  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.retrieve(sessionId);

  // payment_status "paid" + status "complete" is the success shape.
  if (session.status === "complete" && session.payment_status === "paid") {
    const amountTotalCents = session.amount_total ?? 0;
    const subscriptionId =
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id;
    return {
      status: "succeeded",
      stripeSubscriptionId: subscriptionId,
      amountCharged: amountTotalCents / 100,
      currency: "USD",
      firstVisitGuaranteeActive: true,
    };
  }

  if (session.status === "expired") {
    return { status: "failed", failureReason: "Checkout session expired." };
  }
  if (session.payment_status === "unpaid") {
    return { status: "pending" };
  }
  return {
    status: "failed",
    failureReason: `Unexpected session state: status=${session.status} payment_status=${session.payment_status}`,
  };
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
export function handleStripeEvent(event: Stripe.Event): StripeWebhookResult {
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
  if (actionSeen(leadId, "stripe.checkout.completed", session.id)) {
    return { received: true, handled: false, reason: "duplicate event (already processed)" };
  }

  const existing = getLead(leadId);
  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id;

  upsertLead({
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
