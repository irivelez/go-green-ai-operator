// MOCK — replaced in S6 (real Claude streaming via @anthropic-ai/sdk).
//
// Uses the AI SDK v4 data-stream protocol so the client `useChat()` from
// '@ai-sdk/react' can consume it without any provider/model wired up.
// Each chunk is encoded as `0:"text"\n` (text part) per the Vercel AI SDK
// Data Stream spec. Closing the stream is enough — no final marker required
// for the text-only happy path.
//
// Reply rules (matches Master Prompt / BUILD-DECISIONS):
//   - Warm, premium, no-pressure. One ask at a time. Under 80 words.
//   - Mirror language from funnelState.language (else default EN).
//   - Surface a suggestedPatch in the funnel state via a follow-up POST in S6;
//     for the S0 slice we keep replies text-only.

import { NextRequest } from "next/server";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { FUNNEL_SYSTEM_PROMPT } from "@/src/funnel-prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system", "data"]),
        content: z.string().optional(),
        parts: z
          .array(
            z.object({
              type: z.string(),
              text: z.string().optional(),
            }),
          )
          .optional(),
      }),
    )
    .default([]),
  funnelState: z
    .object({
      language: z.enum(["en", "es"]).optional(),
      step: z.string().optional(),
    })
    .optional(),
});

function lastUserText(messages: z.infer<typeof Body>["messages"]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== "user") continue;
    if (m.content) return m.content;
    const t = m.parts?.find((p) => p.type === "text")?.text;
    if (t) return t;
  }
  return "";
}

function pickReply(userText: string, lang: "en" | "es", step?: string): string {
  const text = userText.toLowerCase();

  if (lang === "es") {
    if (text.includes("precio") || text.includes("cobr") || text.includes("cuesta")) {
      return "Cada plan parte de un precio fijo por visita: Essential desde $199, Signature desde $299, Estate desde $399. El precio final lo confirma el equipo en sitio tras la primera visita. ¿Quieres que te recomiende un plan según tus fotos?";
    }
    if (text.includes("foto") || text.includes("imagen")) {
      return "Con 1 a 6 fotos del espacio nos basta — entre más claras, mejor el plan que te recomendaremos. ¿Te gustaría seguir al paso de fotos?";
    }
    if (text.includes("agenda") || text.includes("horario") || text.includes("cita")) {
      return "Trabajamos cuatro ventanas al día desde el jueves. Eliges el horario después del pago. ¿Tienes alguna preferencia de mañana, mediodía, tarde o noche?";
    }
    if (step === "intent") {
      return "Cuéntame en una línea qué te gustaría cuidar — patio frontal, setos, mantenimiento semanal. Con eso te sugerimos el plan correcto.";
    }
    return "Estoy aquí para ayudarte a decidir sin presión. ¿Qué te gustaría saber del plan, del proceso o del cuidado del jardín?";
  }

  if (text.includes("price") || text.includes("cost") || text.includes("charge")) {
    return "Each plan is a fixed per-visit price: Essential from $199, Signature from $299, Estate from $399. Final price is confirmed by the crew on-site after the first visit. Want me to recommend a plan from your photos?";
  }
  if (text.includes("photo") || text.includes("picture") || text.includes("image")) {
    return "Just 1–6 photos of the space is plenty — the clearer the angle, the better the plan we'll recommend. Ready to move to the photos step?";
  }
  if (text.includes("schedule") || text.includes("slot") || text.includes("appointment")) {
    return "We run four windows a day starting Thursday. You pick the slot after payment. Any preference — morning, midday, afternoon, or evening?";
  }
  if (step === "intent") {
    return "Tell me in one line what you'd like cared for — front yard, hedges, weekly upkeep. That's enough for me to suggest the right plan.";
  }
  return "I'm here to help you decide, no pressure. What would you like to know about the plan, the process, or how we care for the garden?";
}

function encodeDataStreamText(s: string): Uint8Array {
  // AI SDK v4 data-stream "text" part: 0:"<json-encoded string>"\n
  return new TextEncoder().encode(`0:${JSON.stringify(s)}\n`);
}

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: "invalid body", issues: parsed.error.issues }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  const lang = parsed.data.funnelState?.language ?? "en";
  const step = parsed.data.funnelState?.step;
  const userText = lastUserText(parsed.data.messages);

  const headers = {
    "content-type": "text/plain; charset=utf-8",
    "x-vercel-ai-data-stream": "v1",
    "cache-control": "no-cache, no-transform",
  };

  // Real Claude when keyed; keyword templates otherwise (preview still works).
  if (process.env.ANTHROPIC_API_KEY) {
    const stream = streamClaude(parsed.data.messages, lang, step);
    return new Response(stream, { headers });
  }

  const reply = pickReply(userText, lang, step);
  const words = reply.split(/(\s+)/);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const w of words) {
        controller.enqueue(encodeDataStreamText(w));
        await new Promise((r) => setTimeout(r, 18));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers });
}

function streamClaude(
  messages: z.infer<typeof Body>["messages"],
  lang: "en" | "es",
  step?: string,
): ReadableStream<Uint8Array> {
  const client = new Anthropic();
  const model = process.env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-latest";
  const convo = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content ?? m.parts?.find((p) => p.type === "text")?.text ?? "",
    }))
    .filter((m) => m.content);

  const sys = `${FUNNEL_SYSTEM_PROMPT}\n\nReply in ${lang === "es" ? "Spanish" : "English"}. Current funnel step: ${step ?? "intent"}. Keep it under 80 words, one ask at a time. Reply with plain conversational text only (no JSON).`;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const s = await client.messages.stream({
          model,
          max_tokens: 400,
          system: sys,
          messages: convo.length ? convo : [{ role: "user", content: "Hello" }],
        });
        s.on("text", (t) => controller.enqueue(encodeDataStreamText(t)));
        await s.finalMessage();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "assistant unavailable";
        controller.enqueue(encodeDataStreamText(`(${msg})`));
      } finally {
        controller.close();
      }
    },
  });
}
