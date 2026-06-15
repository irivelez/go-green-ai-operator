// Concierge sidebar — the context-aware help assistant that sits BESIDE the
// guided booking funnel. NOT a second intake: the funnel form drives the booking,
// this surface answers questions and keeps the customer moving.
//
// Emits the AI SDK v4 data-stream protocol (`0:"text"\n`) so the client
// `useChat()` from '@ai-sdk/react' consumes it directly. Real Claude streaming
// via @anthropic-ai/sdk when ANTHROPIC_API_KEY is set; honest keyword fallback
// (still context-aware) when it isn't, so the preview never breaks.

import { NextRequest } from "next/server";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { FUNNEL_SYSTEM_PROMPT } from "@/src/funnel-prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FunnelStateSchema = z
  .object({
    language: z.enum(["en", "es"]).optional(),
    step: z.string().optional(),
    intent: z.string().optional(),
    address: z.string().optional(),
    tier: z.string().optional(),
    frequency: z.string().optional(),
    pricing: z
      .object({
        perVisit: z.number().optional(),
        monthlyRecurring: z.number().optional(),
        firstChargeTotal: z.number().optional(),
        currency: z.string().optional(),
      })
      .optional(),
    vision: z
      .object({
        recommended_tier: z.string().optional(),
        condition_score: z.number().optional(),
        cleanup_required: z.boolean().optional(),
      })
      .optional(),
  })
  .optional();

const Body = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system", "data"]),
        content: z.string().optional(),
        parts: z
          .array(z.object({ type: z.string(), text: z.string().optional() }))
          .optional(),
      }),
    )
    .default([]),
  funnelState: FunnelStateSchema,
});

type FunnelStateIn = NonNullable<z.infer<typeof Body>["funnelState"]>;

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

// The customer's live situation, threaded into the system prompt so the
// concierge is genuinely helpful instead of a context-blind chatbot.
function buildContext(fs: FunnelStateIn | undefined): string {
  if (!fs) return "The customer just arrived — no details captured yet.";
  const lines: string[] = [];
  if (fs.step) lines.push(`Current funnel step: ${fs.step}.`);
  if (fs.intent) lines.push(`What they told us they need: "${fs.intent}".`);
  if (fs.address) lines.push(`Service address on file: ${fs.address}.`);
  if (fs.tier) lines.push(`Tier selected/recommended: ${fs.tier}.`);
  if (fs.frequency) lines.push(`Service frequency chosen: ${fs.frequency}.`);
  if (fs.pricing && (fs.pricing.monthlyRecurring || fs.pricing.perVisit)) {
    const p = fs.pricing;
    const cur = p.currency ?? "USD";
    const bits: string[] = [];
    if (p.perVisit) bits.push(`$${p.perVisit} per visit`);
    if (p.monthlyRecurring) bits.push(`$${p.monthlyRecurring}/mo`);
    if (p.firstChargeTotal) bits.push(`first charge $${p.firstChargeTotal} ${cur}`);
    lines.push(
      `Pricing the engine has already computed: ${bits.join(", ")}. These figures are authoritative — you may repeat them, but never invent any other number.`,
    );
  }
  if (fs.vision) {
    const v = fs.vision;
    const vb: string[] = [];
    if (v.recommended_tier) vb.push(`recommended ${v.recommended_tier}`);
    if (typeof v.condition_score === "number")
      vb.push(`condition ${v.condition_score}/10`);
    if (typeof v.cleanup_required === "boolean")
      vb.push(`one-time cleanup ${v.cleanup_required ? "required" : "not required"}`);
    if (vb.length) lines.push(`Photo assessment so far: ${vb.join(", ")}.`);
  }
  return lines.length
    ? lines.join("\n")
    : "The customer just arrived — no details captured yet.";
}

function encodeDataStreamText(s: string): Uint8Array {
  // AI SDK v4 data-stream "text" part: 0:"<json-encoded string>"\n
  return new TextEncoder().encode(`0:${JSON.stringify(s)}\n`);
}

// Context-aware keyword fallback (no key) — still references the customer's intent.
function pickReply(userText: string, lang: "en" | "es", fs?: FunnelStateIn): string {
  const text = userText.toLowerCase();
  if (lang === "es") {
    if (text.includes("precio") || text.includes("cobr") || text.includes("cuesta"))
      return "Cada plan tiene un precio fijo por visita: Essential desde $199, Signature desde $299, Estate desde $399. El equipo confirma el precio final en sitio tras la primera visita. ¿Sigues con las fotos para que te recomiende el plan ideal?";
    if (text.includes("foto") || text.includes("imagen"))
      return "Con 1 a 6 fotos claras del espacio nos basta para recomendarte el plan correcto. ¿Las agregas en el formulario y seguimos?";
    if (text.includes("agenda") || text.includes("horario") || text.includes("cita"))
      return "Eliges tu horario después del pago — trabajamos cuatro ventanas al día desde el jueves. Primero terminemos tu plan en el formulario.";
    if (fs?.intent)
      return `Perfecto — anotamos que buscas: "${fs.intent}". Sigue el formulario y te recomendaremos el plan ideal con su precio antes de reservar.`;
    return "Estoy aquí para resolver tus dudas mientras decides. Completa el formulario a la izquierda y te guío con el plan, el precio y la primera visita.";
  }
  if (text.includes("price") || text.includes("cost") || text.includes("charge"))
    return "Each plan is a fixed per-visit price: Essential from $199, Signature from $299, Estate from $399. The crew confirms the final price on-site after the first visit. Want to add your photos so I can recommend the right plan?";
  if (text.includes("photo") || text.includes("picture") || text.includes("image"))
    return "Just 1–6 clear photos of the space lets us recommend the right plan. Add them in the form and we'll keep going.";
  if (text.includes("schedule") || text.includes("slot") || text.includes("appointment"))
    return "You pick your slot after payment — we run four windows a day starting Thursday. Let's finish your plan in the form first.";
  if (fs?.intent)
    return `Got it — we've noted you're after: "${fs.intent}". Keep going in the form and I'll help you land on the right plan and price before anything's booked.`;
  return "I'm here for any questions while you decide. Fill out the form on the left and I'll guide you on the plan, the price, and your first visit.";
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

  const fs = parsed.data.funnelState;
  const lang = fs?.language ?? "en";
  const userText = lastUserText(parsed.data.messages);

  const headers = {
    "content-type": "text/plain; charset=utf-8",
    "x-vercel-ai-data-stream": "v1",
    "cache-control": "no-cache, no-transform",
  };

  if (process.env.ANTHROPIC_API_KEY) {
    return new Response(streamClaude(parsed.data.messages, lang, fs), { headers });
  }

  const reply = pickReply(userText, lang, fs);
  const words = reply.split(/(\s+)/);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const w of words) {
        controller.enqueue(encodeDataStreamText(w));
        await new Promise((r) => setTimeout(r, 16));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers });
}

function streamClaude(
  messages: z.infer<typeof Body>["messages"],
  lang: "en" | "es",
  fs?: FunnelStateIn,
): ReadableStream<Uint8Array> {
  const client = new Anthropic();
  const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";
  const convo = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content ?? m.parts?.find((p) => p.type === "text")?.text ?? "",
    }))
    .filter((m) => m.content);

  const langName = lang === "es" ? "Spanish" : "English";

  // FUNNEL_SYSTEM_PROMPT carries the voice + every tier/price/add-on fact. Its
  // JSON/tools output contract is for the agent runtime — NOT this chat surface,
  // so we explicitly override it last (recency) to avoid contradictory output.
  const sys = `${FUNNEL_SYSTEM_PROMPT}

# THIS SURFACE — concierge sidebar (OVERRIDES the JSON output contract above)
You are the help concierge sitting BESIDE a guided booking form. The customer uses the FORM to move through the steps (describe need → photos → plan → details → quote → pay → schedule). You are NOT the intake — you answer their questions and keep them confident, then point them back to the form.

For THIS surface ONLY, IGNORE the JSON/tools output contract above. Reply with plain conversational text — no JSON, no code fences, no tool objects. Reply in ${langName}. Keep it under 80 words, give ONE helpful answer, and end on a gentle next step that points back to the form when relevant. Use the live context below — be specific, never ask for something we already have, and never invent a price the context doesn't give you.

# LIVE CUSTOMER CONTEXT
${buildContext(fs)}`;

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
