// Real Stripe Checkout (TEST MODE) via src/stripe.createSubscriptionCheckout.
// When STRIPE_SECRET_KEY (sk_test_…) is set, returns a real Stripe Checkout URL
// (`stripeUrl`) the client redirects to. Open-ended add-ons are stripped before
// charge (defense in depth — the engine also refuses them). When no key is set,
// falls back to a relative mock URL so the funnel still demos end-to-end.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { addOnById, type Frequency, type Tier } from "@/src/contract";
import { createSubscriptionCheckout } from "@/src/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  tier: z.enum(["essential", "signature", "estate"]),
  frequency: z.enum(["weekly", "biweekly", "monthly"]),
  addOnIds: z.array(z.string()).default([]),
  customer: z.object({
    name: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    address: z.string().optional(),
  }),
  leadId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { tier, frequency, addOnIds, customer, leadId } = parsed.data;

  // Only FIXED add-ons are checkout-eligible. Open-ended are human-quoted (§B1).
  const fixedAddOnIds = addOnIds.filter((id) => addOnById(id)?.kind === "fixed");

  const hasStripe = (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_test_");

  // No key → mock path so the funnel still advances in preview.
  if (!hasStripe) {
    await new Promise((r) => setTimeout(r, 250));
    return NextResponse.json({
      url: "/funnel?step=schedule&mock_checkout=success",
      mock: true,
    });
  }

  // Real Stripe — requires email + address (engine enforces too).
  if (!customer.email || !customer.address) {
    return NextResponse.json(
      { error: "email and address are required for checkout" },
      { status: 400 },
    );
  }

  const origin = new URL(req.url).origin;
  try {
    const { url, sessionId } = await createSubscriptionCheckout({
      tier: tier as Tier,
      frequency: frequency as Frequency,
      selectedAddOnIds: fixedAddOnIds,
      customer: {
        name: customer.name ?? "",
        email: customer.email,
        phone: customer.phone ?? "",
        address: customer.address,
      },
      leadId,
      successUrl: `${origin}/funnel?step=schedule&checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/funnel?step=quote&checkout=cancelled`,
    });
    // `stripeUrl` signals the client to redirect to a real Stripe page.
    return NextResponse.json({ url, stripeUrl: url, sessionId, mock: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "checkout failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
