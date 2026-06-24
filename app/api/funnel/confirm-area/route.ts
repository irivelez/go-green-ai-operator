// Direct polygon → confirm_area sink. The chat-agent route (/api/funnel/agent)
// only sees a text turn from the user; the actual polygon the customer draws on
// the satellite map would either drown the model context or get hallucinated
// away. So we bypass the LLM for the geometry: AreaConfirmCard POSTs the raw
// ring here, the server re-derives the authoritative sqft via runConfirmArea
// (geo.computePolygonSqft), persists it on the lead, and then the client tells
// the chat thread "I confirmed the maintained area" so the agent advances to
// compute_exact_price. The LLM never sees the polygon, never touches the math.
//
// This is the same isolation pattern as Stripe: the model can propose, but
// money + measurements stay outside its context window.
import type { NextRequest } from "next/server";
import { z } from "zod";
import { runConfirmArea, type ToolContext } from "@/src/agent-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  leadId: z.string().min(1),
  language: z.enum(["en", "es"]).default("en"),
  path: z
    .array(z.object({ lat: z.number(), lng: z.number() }))
    .min(3, "polygon needs at least 3 points")
    .max(500, "polygon too complex"),
});

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: "invalid body", issues: parsed.error.issues }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }
  const { leadId, language, path } = parsed.data;
  const ctx: ToolContext = { leadId, language };
  const result = await runConfirmArea(ctx, { path });
  // lead_missing means the measure step's lead isn't in this store (cross-route
  // split) — surface 409 so the client re-routes through the agent rather than
  // letting the customer pay against a fabricated flat-slope price.
  const status = result.status === "lead_missing" ? 409 : 200;
  return new Response(JSON.stringify(result), {
    status,
    headers: { "content-type": "application/json" },
  });
}
