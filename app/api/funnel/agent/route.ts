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

import type { NextRequest } from "next/server";
import { anthropic } from "@ai-sdk/anthropic";
import { streamText, convertToCoreMessages, type Message } from "ai";
import { buildTools, type ToolContext } from "@/src/agent-tools";
import { upsertLead, getLead } from "@/src/store";
import { Body, agentSystemPrompt } from "@/src/funnel-agent-prompt";
import { isAllowedPhoto } from "@/src/vision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  const { messages, leadId, language, photos, address, intent } = parsed.data;

  // PRODUCTION GUARD: no silent keyword fallback in prod. A deployed agent with no key
  // is a defect, not a degraded mode — fail loudly so it's caught, never shipped dumb.
  if (!process.env.ANTHROPIC_API_KEY) {
    if (process.env.NODE_ENV === "production") {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY is required in production." }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    }
    return devFallbackStream(language);
  }

  // Seed the lead so gates (address/photos) and analyze_photos work off real state.
  // Photos arriving from the request body are untrusted (AGENTS.md §6, Rule of
  // Two). Drop anything that isn't a base64 image data: URI BEFORE we persist —
  // a remote URL on a lead would later be forwarded to Anthropic as an image
  // source (SSRF / exfil). The funnel client only ever uploads data URIs anyway.
  const existing = await getLead(leadId);
  const safePhotos = photos ? photos.filter(isAllowedPhoto) : undefined;
  if (photos && safePhotos && safePhotos.length !== photos.length) {
    console.warn(`[funnel] dropped ${photos.length - safePhotos.length} non-data-URI photo(s) from lead ${leadId}`);
  }
  await upsertLead({
    lead_id: leadId,
    channel: existing?.channel ?? "form",
    language,
    address: address ?? existing?.address,
    photos: safePhotos ?? existing?.photos ?? [],
  });

  const ctx: ToolContext = { leadId, language };
  const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";

  const result = streamText({
    model: anthropic(model),
    system: agentSystemPrompt(language, await getLead(leadId), intent),
    messages: convertToCoreMessages(messages as Message[]),
    tools: buildTools(ctx),
    maxSteps: 8,
    temperature: 0.4,
  });

  return result.toDataStreamResponse();
}
