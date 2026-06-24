// Pure helper for the post-payment return (go-live G2). createSubscriptionCheckout
// embeds `?checkout=success&lead=<id>` into the Stripe success_url; the /agent chat
// reads it on load to resume straight to booking — even when the Stripe round-trip
// replaced the tab. (Meta-ad traffic is mostly the FB/IG in-app browser, which
// navigates in place rather than opening a real new tab, so the in-memory leadId +
// transcript are gone on return.) The lead state in the shared store is authoritative,
// so only the leadId has to survive the round-trip; the URL carries it, with a
// localStorage value as the fallback.

export interface CheckoutReturn {
  isSuccess: boolean; // ?checkout=success
  isCancelled: boolean; // ?checkout=cancelled
  leadId: string | null; // URL `lead` param, else the persisted fallback, else null
}

export function parseCheckoutReturn(search: string, storedLeadId: string | null = null): CheckoutReturn {
  const params = new URLSearchParams(search);
  const checkout = params.get("checkout");
  const urlLead = params.get("lead")?.trim();
  return {
    isSuccess: checkout === "success",
    isCancelled: checkout === "cancelled",
    leadId: urlLead || storedLeadId || null,
  };
}
