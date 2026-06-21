// Stripe webhook — TEST MODE ONLY.
//
// Verifies the signature, decodes the event, and reduces it into the lead store
// via the pure handler in src/stripe.ts. Idempotent on (lead_id, sessionId).
//
// Setup (test mode):
//   stripe listen --forward-to localhost:3000/api/stripe/webhook
//   → exposes STRIPE_WEBHOOK_SECRET (whsec_…); add it to .env.local.

import { NextRequest, NextResponse } from "next/server";
import { constructWebhookEvent, handleStripeEvent } from "@/src/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "missing stripe-signature header" }, { status: 400 });
  }

  // Raw body is required for signature verification. Next 15 gives us the raw
  // bytes via req.text() on the App Router edge — no body parser in front.
  const rawBody = await req.text();

  let event;
  try {
    event = constructWebhookEvent(rawBody, signature);
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid signature";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const result = await handleStripeEvent(event);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "handler error";
    return NextResponse.json({ received: true, handled: false, error: message }, { status: 500 });
  }
}
