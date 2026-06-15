// The Go Green agent brain — ONE chat-first surface that the LLM actually drives.
//
// This replaces the old "defanged concierge sidebar" (which was told to ignore its
// own tools and just answer FAQs beside a deterministic form). Now the model
// orchestrates the whole funnel by CALLING TOOLS (src/agent-tools.ts), and each
// tool re-derives every number server-side and refuses unsafe actions. The model
// proposes; the deterministic gates dispose. It never charges a card.
//
// Vercel AI SDK v4: streamText + server-side multi-step tool loop (maxSteps) →
// toDataStreamResponse() → consumed by useChat() on the client, which renders each
// tool result as an interactive React component (generative UI).

import { NextRequest } from "next/server";
import { z } from "zod";
import { anthropic } from "@ai-sdk/anthropic";
import { streamText, convertToCoreMessages, type Message } from "ai";
import { FUNNEL_SYSTEM_PROMPT } from "@/src/funnel-prompt";
import { buildTools, type ToolContext } from "@/src/agent-tools";
import { upsertLead, getLead } from "@/src/store";
import type { VisionAssessment } from "@/src/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  messages: z.array(z.any()).default([]),
  leadId: z.string().min(1),
  language: z.enum(["en", "es"]).default("en"),
  photos: z.array(z.string()).optional(),
  address: z.string().optional(),
});

function agentSystemPrompt(lang: "en" | "es", lead: ReturnType<typeof getLead>): string {
  const langName = lang === "es" ? "Spanish" : "English";
  const ctxLines: string[] = [];
  if (lead?.address) ctxLines.push(`Service address on file: ${lead.address}.`);
  ctxLines.push(`Photos on file: ${lead?.photos?.length ?? 0}.`);
  if (lead?.lead_score) ctxLines.push(`Lead score: ${lead.lead_score} (risk ${lead.risk_level ?? "?"}).`);
  if (lead?.desired_frequency) ctxLines.push(`Frequency: ${lead.desired_frequency}.`);
  const vision = lead?.vision_assessment as unknown as VisionAssessment | undefined;
  if (vision && typeof vision.confidence === "number") {
    ctxLines.push(
      `Vision: ${vision.recommended_tier} recommended, condition ${vision.condition_score}/10, cleanup ${vision.cleanup_required ? "required" : "not required"}, confidence ${vision.confidence}.`,
    );
  }

  return `${FUNNEL_SYSTEM_PROMPT}

# THIS SURFACE — the live agent (OVERRIDES the "emit JSON" output contract above)
You ARE the booking experience. There is no separate form — you guide the entire flow
yourself. You HAVE real function-calling tools; USE them. Do NOT emit JSON or tool objects
as text, and never reveal tool names to the customer.

Reply to the customer in ${langName}, mirroring their language. Keep messages warm, short,
and end on ONE clear next step. Ask for at most ONE missing thing per turn.

# How to drive the flow (call tools — never quote a number yourself)
1. Understand the need from what they say.
2. When you have an address, call qualify_lead. If it returns escalate=true (out of area,
   non-residential), call raise_escalation and stop collecting.
3. When photos are on file, call analyze_photos to assess the yard.
4. Call recommend_tier to propose ONE tier (the UI shows the option cards).
5. When the customer has confirmed a tier + frequency (+ any add-ons), call compute_pricing
   to show the exact price. NEVER state a price the tool didn't return.
6. When tier + frequency + address + photos + identity (name, email) are all present, call
   propose_checkout. This stages a secure payment link — you do NOT charge anyone.
7. ONLY after payment is confirmed, call offer_slots, then confirm_booking for the chosen slot.
8. For anything outside a clean standard-residential case (HOA, commercial, property manager,
   complaint, refund/discount, legal, damage, hardscape/large install, out-of-area, extreme
   urgency, an open-ended add-on, contradictory scope, unusable photos), call raise_escalation
   with a complete brief and stop — a human takes over and nothing is charged.

# Current customer context
${ctxLines.join("\n")}`;
}

function devFallbackStream(lang: "en" | "es"): Response {
  const msg =
    lang === "es"
      ? "Estoy en modo de vista previa local (sin clave de IA configurada), así que aún no puedo razonar ni mostrar planes. Configura ANTHROPIC_API_KEY para activar al agente completo."
      : "I'm in local preview mode (no AI key configured), so I can't reason or show live plans yet. Set ANTHROPIC_API_KEY to enable the full agent.";
  const words = msg.split(/(\s+)/);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const w of words) {
        controller.enqueue(new TextEncoder().encode(`0:${JSON.stringify(w)}\n`));
        await new Promise((r) => setTimeout(r, 12));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "x-vercel-ai-data-stream": "v1",
      "cache-control": "no-cache, no-transform",
    },
  });
}

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: "invalid body", issues: parsed.error.issues }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  const { messages, leadId, language, photos, address } = parsed.data;

  // PRODUCTION GUARD: no silent keyword fallback in prod. A deployed agent with no key
  // is a defect, not a degraded mode — fail loudly so it's caught, never shipped dumb.
  if (!process.env.ANTHROPIC_API_KEY) {
    if (process.env.NODE_ENV === "production") {
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY is required in production." }),
        { status: 503, headers: { "content-type": "application/json" } },
      );
    }
    return devFallbackStream(language);
  }

  // Seed the lead so gates (address/photos) and analyze_photos work off real state.
  const existing = getLead(leadId);
  upsertLead({
    lead_id: leadId,
    channel: existing?.channel ?? "form",
    language,
    address: address ?? existing?.address,
    photos: photos ?? existing?.photos ?? [],
  });

  const ctx: ToolContext = { leadId, language };
  const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";

  const result = streamText({
    model: anthropic(model),
    system: agentSystemPrompt(language, getLead(leadId)),
    messages: convertToCoreMessages(messages as Message[]),
    tools: buildTools(ctx),
    maxSteps: 8,
    temperature: 0.4,
  });

  return result.toDataStreamResponse();
}
