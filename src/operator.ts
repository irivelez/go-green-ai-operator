// Serverless brain (spec §5) — the same decision logic the Agent SDK runs, but as a
// stateless, per-request function that runs on Vercel. DECISIONS are deterministic
// (qualify/price/escalate/book via the pure modules); the natural-language reply is the
// only thing the LLM touches, and only when ANTHROPIC_API_KEY is present. No key → on-brand
// templates. Pricing is NEVER an LLM guess (spec §9.1).

import { geoQualify } from "./qualify";
import { quoteRange, type Frequency, type YardSize, type PackageTier } from "./pricing";
import { checkEscalation } from "./escalation";
import { upsertLead, getLead, type Lead } from "./store";
import { SYSTEM_PROMPT } from "./prompt";
import {
  tool_score_lead, tool_book_evaluation, tool_create_work_order,
  tool_raise_escalation, visionFallback, type YardAssessment,
} from "./tools";

export interface OperatorInput {
  lead_id: string;
  channel: Lead["channel"];
  name?: string;
  text: string;
  has_photo?: boolean;
}

export interface OperatorDecision {
  intent: string;
  language: "en" | "es";
  escalated: boolean;
  escalation_reasons: string[];
  score?: "A" | "B" | "C";
  missing: string[];
  price_range?: { low: number; high: number };
  suggested_package?: string;
  slots: string[];
  booked_slot?: string;
  stage: Lead["status"];
  used_llm: boolean;
  trace: string[];
}

export interface OperatorResult {
  reply: string;
  lead: Lead;
  decision: OperatorDecision;
}

const FREQ_WORDS: Array<[RegExp, Frequency]> = [
  [/\bweekly\b|\bsemanal\b|every week|cada semana/i, "weekly"],
  [/\bbi-?weekly\b|every two weeks|every other week|quincenal|cada dos semanas/i, "biweekly"],
  [/\bmonthly\b|\bmensual\b|once a month|cada mes/i, "monthly"],
];

function detectLanguage(text: string): "en" | "es" {
  if (/[áéíóúñ¿¡]/i.test(text)) return "es";
  if (/\b(hola|gracias|jardín|jardin|mantenimiento|semanal|quincenal|mensual|por favor|necesito|cotización)\b/i.test(text)) return "es";
  return "en";
}

function extractZip(text: string): string | undefined {
  return text.match(/\b9\d{4}\b/)?.[0];
}

function looksLikeAddress(text: string): boolean {
  return /\d{1,5}\s+[A-Za-z0-9.\s]+\b(st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|way|ct|court|ter|terrace|pl|place)\b/i.test(text)
    || /\b9\d{4}\b/.test(text);
}

function extractFrequency(text: string): Frequency | undefined {
  for (const [re, f] of FREQ_WORDS) if (re.test(text)) return f;
  return undefined;
}

function detectPropertyType(text: string): string | undefined {
  if (/\bHOA\b|homeowners? association/i.test(text)) return "hoa";
  if (/property manager|management compan/i.test(text)) return "property_manager";
  if (/commercial|office building|retail|storefront/i.test(text)) return "commercial";
  return undefined;
}

function inferYardSize(text: string, fallback: YardSize): YardSize {
  if (/\b(small|tiny|little|patio|courtyard|pequeñ)/i.test(text)) return "small";
  if (/\b(large|big|huge|estate|acre|gran|grande)/i.test(text)) return "large";
  return fallback;
}

function confirmsBooking(text: string): boolean {
  return /\b(yes|yep|sure|confirm|book it|that works|sounds good|let'?s do|go ahead|option|first|second|morning|afternoon|sí|si|confirmo|el primero|reservar)\b/i.test(text);
}

function chosenSlotIndex(text: string): 0 | 1 {
  if (/\b(2|second|afternoon|segundo|tarde)\b/i.test(text)) return 1;
  return 0;
}

function recommendPackage(freq: Frequency, size: YardSize): PackageTier {
  if (freq === "monthly") return "essential";
  if (size === "large" || freq === "weekly") return "premium";
  return "signature";
}

// Two stable, human-friendly evaluation slots from a base date (next business mornings/afternoons).
export function nextSlots(base = new Date()): string[] {
  const slots: string[] = [];
  const d = new Date(base);
  d.setUTCHours(0, 0, 0, 0);
  const hours = [16, 21]; // 9am & 2pm Pacific ≈ 16:00 & 21:00 UTC
  let added = 0;
  while (added < 2) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const s = new Date(d);
    s.setUTCHours(hours[added]!, 0, 0, 0);
    slots.push(s.toISOString());
    added++;
  }
  return slots;
}

function fmtSlot(iso: string, lang: "en" | "es"): string {
  const d = new Date(iso);
  return d.toLocaleString(lang === "es" ? "es-US" : "en-US", {
    weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    timeZone: "America/Los_Angeles",
  });
}

export async function runOperator(input: OperatorInput): Promise<OperatorResult> {
  const trace: string[] = [];
  const text = input.text.trim();
  const lang = detectLanguage(text) ?? "en";

  const prev = getLead(input.lead_id);
  const photos = [...(prev?.photos ?? [])];
  if (input.has_photo) photos.push(`photo-${Date.now()}.jpg`);

  const zip = extractZip(text);
  const freq = extractFrequency(text);
  const propType = detectPropertyType(text);
  const hasAddress = !!prev?.address || looksLikeAddress(text);
  const address = looksLikeAddress(text) ? text : prev?.address;

  let lead = upsertLead({
    lead_id: input.lead_id,
    channel: input.channel,
    name: input.name ?? prev?.name,
    language: lang,
    ...(address ? { address } : {}),
    ...(freq ? { desired_frequency: freq } : {}),
    ...(propType ? { property_type: propType } : {}),
    photos,
    first_response_at: prev?.first_response_at ?? new Date().toISOString(),
  });
  trace.push(`parsed signals: lang=${lang}${zip ? ` zip=${zip}` : ""}${freq ? ` freq=${freq}` : ""}${propType ? ` type=${propType}` : ""}${input.has_photo ? " +photo" : ""}`);

  const decision: OperatorDecision = {
    intent: "intake", language: lang, escalated: false, escalation_reasons: [],
    missing: [], slots: [], stage: lead.status, used_llm: false, trace,
  };

  // 1) Escalation gate (spec §12.2) — runs before any client-facing booking.
  const esc = checkEscalation({ inbound_text: text, property_type: lead.property_type });
  if (esc.escalate) {
    lead = tool_raise_escalation(
      lead.lead_id, lead.channel, esc.reasons.join(", "),
      `Auto-flagged on intake: ${esc.reasons.join("; ")}. Inbound: "${text.slice(0, 240)}"`,
    );
    decision.escalated = true;
    decision.escalation_reasons = esc.reasons;
    decision.intent = "escalate";
    decision.stage = lead.status;
    trace.push(`escalation flags: ${esc.reasons.join(", ")} → Needs Human Review`);
    const reply = await composeReply({ kind: "escalated", lang, reasons: esc.reasons, lead, userText: text, decision });
    return { reply, lead, decision };
  }

  // 2) Qualify (geo + A/B/C). Out of area → not a fit.
  const geo = geoQualify({ address: lead.address, zip });
  const scored = tool_score_lead({
    address: lead.address, zip,
    property_type: (lead.property_type as never) ?? "residential",
    has_photos: lead.photos.length > 0,
    desired_frequency: lead.desired_frequency,
    vision_confidence: (lead.vision_assessment?.confidence as number) ?? undefined,
  });
  decision.score = scored.score;
  trace.push(`geo: ${geo.reason}; score=${scored.score} (${scored.reasons.join("; ")})`);

  if (scored.score === "C" && geo.in_area === false && (lead.address || zip)) {
    lead = upsertLead({ lead_id: lead.lead_id, channel: lead.channel, lead_score: "C", status: "Not a Fit", ai_recommendation: geo.reason });
    decision.intent = "decline"; decision.stage = lead.status;
    const reply = await composeReply({ kind: "out_of_area", lang, lead, userText: text, decision });
    return { reply, lead, decision };
  }

  // 3) Missing info → ask for exactly what's missing (spec §8.2).
  const missing: string[] = [];
  if (!lead.address) missing.push(lang === "es" ? "la dirección" : "the property address");
  if (!lead.desired_frequency) missing.push(lang === "es" ? "la frecuencia (semanal, quincenal o mensual)" : "preferred frequency (weekly, biweekly, or monthly)");
  if (lead.photos.length === 0) missing.push(lang === "es" ? "algunas fotos del jardín" : "a few photos of the garden");
  decision.missing = missing;

  if (missing.length > 0) {
    lead = upsertLead({
      lead_id: lead.lead_id, channel: lead.channel, lead_score: scored.score, zone: geo.zone,
      status: lead.address || lead.desired_frequency || lead.photos.length ? "Waiting for Info" : "New Lead",
    });
    decision.intent = "collect_info"; decision.stage = lead.status;
    trace.push(`missing: ${missing.join(", ")} → ${lead.status}`);
    const reply = await composeReply({ kind: "collect_info", lang, missing, lead, userText: text, decision });
    return { reply, lead, decision };
  }

  // 4) Complete A-lead → vision + price + recommend, then book or offer slots.
  const vision: YardAssessment = (lead.vision_assessment as unknown as YardAssessment) ?? visionFallback();
  const size = inferYardSize(text, vision.yard_size_estimate);
  const range = quoteRange({
    yard_size_bucket: size,
    frequency: lead.desired_frequency as Frequency,
    cleanup_required: vision.cleanup_required,
  });
  const pkg = recommendPackage(lead.desired_frequency as Frequency, size);
  decision.price_range = range.covered ? { low: range.low, high: range.high } : undefined;
  decision.suggested_package = pkg;
  trace.push(`vision: ${size} yard, cleanup=${vision.cleanup_required}; range=$${range.low}-$${range.high}; package=${pkg}`);

  if (!range.covered) {
    lead = tool_raise_escalation(lead.lead_id, lead.channel, "pricing outside rubric coverage", `Pricing engine returned no covered range for ${size}/${lead.desired_frequency}.`);
    decision.escalated = true; decision.escalation_reasons = ["pricing outside rubric coverage"]; decision.stage = lead.status;
    const reply = await composeReply({ kind: "escalated", lang, reasons: decision.escalation_reasons, lead, userText: text, decision });
    return { reply, lead, decision };
  }

  lead = upsertLead({
    lead_id: lead.lead_id, channel: lead.channel, lead_score: "A", zone: geo.zone,
    vision_assessment: vision as unknown as Record<string, unknown>,
    suggested_package: pkg, price_range: { low: range.low, high: range.high },
    ai_recommendation: `${lead.desired_frequency} ${pkg} maintenance${vision.cleanup_required ? " (initial cleanup required first — separate quote)" : ""}.`,
    status: "AI Qualified",
  });

  const slots = nextSlots(new Date());
  decision.slots = slots;

  // 5) Booking: if they're confirming after slots were offered, book it.
  const wasOffered = prev?.status === "Ready to Schedule" || prev?.status === "AI Qualified";
  if (wasOffered && confirmsBooking(text)) {
    const slot = slots[chosenSlotIndex(text)]!;
    const booked = tool_book_evaluation({ ...lead, address: lead.address } as never, slot);
    if (booked.ok) {
      lead = tool_create_work_order(lead.lead_id) as Lead;
      decision.booked_slot = slot; decision.intent = "booked"; decision.stage = lead.status;
      trace.push(`booked ${slot} → work order created`);
      const reply = await composeReply({ kind: "booked", lang, lead, slot, range, pkg, userText: text, decision });
      return { reply, lead, decision };
    }
    trace.push(`booking blocked: ${booked.reason}`);
  }

  // Otherwise, offer two slots.
  lead = upsertLead({ lead_id: lead.lead_id, channel: lead.channel, status: "Ready to Schedule" });
  decision.intent = "offer_slots"; decision.stage = lead.status;
  trace.push(`offered slots → Ready to Schedule`);
  const reply = await composeReply({ kind: "offer_slots", lang, lead, slots, range, pkg, vision, userText: text, decision });
  return { reply, lead, decision };
}

// ---- Reply composition: deterministic decision in, brand-voice prose out ----

type ReplyCtx =
  | { kind: "collect_info"; lang: "en" | "es"; missing: string[]; lead: Lead; userText: string; decision: OperatorDecision }
  | { kind: "escalated"; lang: "en" | "es"; reasons: string[]; lead: Lead; userText: string; decision: OperatorDecision }
  | { kind: "out_of_area"; lang: "en" | "es"; lead: Lead; userText: string; decision: OperatorDecision }
  | { kind: "offer_slots"; lang: "en" | "es"; lead: Lead; slots: string[]; range: ReturnType<typeof quoteRange>; pkg: string; vision: YardAssessment; userText: string; decision: OperatorDecision }
  | { kind: "booked"; lang: "en" | "es"; lead: Lead; slot: string; range: ReturnType<typeof quoteRange>; pkg: string; userText: string; decision: OperatorDecision };

async function composeReply(ctx: ReplyCtx): Promise<string> {
  const fallback = templateReply(ctx);
  if (!process.env.ANTHROPIC_API_KEY) return fallback;
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic();
    const model = process.env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-latest";
    const authoritative = {
      reply_kind: ctx.kind,
      language: ctx.lang,
      client_name: ctx.lead.name,
      decision: ctx.decision,
      do_not_change: "Use ONLY these numbers/slots. Never invent or alter a price. End on a clear next step.",
    };
    const resp = await client.messages.create({
      model, max_tokens: 500,
      system: `${SYSTEM_PROMPT}\n\n# AUTHORITATIVE DECISION (already made by the deterministic engine — phrase it warmly, never contradict, never invent prices)\n${JSON.stringify(authoritative, null, 2)}`,
      messages: [{ role: "user", content: ctx.userText || "(client opened the conversation)" }],
    });
    const out = resp.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
    ctx.decision.used_llm = true;
    return out || fallback;
  } catch {
    return fallback;
  }
}

function templateReply(ctx: ReplyCtx): string {
  const name = ctx.lead.name ? ` ${ctx.lead.name}` : "";
  const es = ctx.lang === "es";
  switch (ctx.kind) {
    case "collect_info": {
      const items = ctx.missing.join(es ? " y " : " and ");
      return es
        ? `Hola${name}, gracias por contactar a Go Green Landscape. Con gusto le ayudamos con el mantenimiento de su jardín. Para entender mejor el alcance, ¿podría enviarnos ${items}? Con eso le recomendamos el mejor siguiente paso.`
        : `Hi${name}, thank you for reaching out to Go Green Landscape. We'd be happy to help with your garden maintenance. To understand the scope, could you please send us ${items}? Once we have that, we'll recommend the best next step.`;
    }
    case "escalated":
      return es
        ? `Gracias${name} por la información. Por la naturaleza de su solicitud (${ctx.reasons.join(", ")}), un miembro de nuestro equipo la revisará personalmente para darle la recomendación correcta. Le daremos seguimiento muy pronto.`
        : `Thank you${name} for sharing that. Given the nature of your request (${ctx.reasons.join(", ")}), a member of our team will review it personally to make sure we give you the right recommendation. We'll follow up shortly.`;
    case "out_of_area":
      return es
        ? `Gracias${name} por considerar a Go Green Landscape. Por ahora su ubicación está fuera de nuestra área de servicio en San Francisco, así que no sería el mejor encaje para nuestro mantenimiento recurrente. Le deseamos lo mejor con su jardín.`
        : `Thank you${name} for considering Go Green Landscape. Your location is currently outside our San Francisco service area, so this may not be the best fit for our recurring maintenance. We truly appreciate you reaching out.`;
    case "offer_slots": {
      const [a, b] = ctx.slots;
      const cleanup = (ctx.vision.cleanup_required)
        ? (es ? " Antes del servicio recurrente recomendamos una limpieza inicial (se cotiza por separado)." : " Before recurring service we'd recommend an initial cleanup (quoted separately).")
        : "";
      return es
        ? `Gracias${name}. Según lo que vemos, recomendamos mantenimiento ${frEs(ctx.lead.desired_frequency)} plan ${ctx.pkg}, en un rango aproximado de $${ctx.range.low}–$${ctx.range.high} por visita (el precio final requiere una revisión en sitio).${cleanup} Tenemos disponibilidad el ${fmtSlot(a!, "es")} o el ${fmtSlot(b!, "es")}. ¿Cuál le funciona mejor?`
        : `Thank you${name}. Based on what we can see, we'd recommend ${ctx.lead.desired_frequency} ${ctx.pkg} maintenance, in an approximate range of $${ctx.range.low}–$${ctx.range.high} per visit (final pricing needs an on-site review).${cleanup} We have availability on ${fmtSlot(a!, "en")} or ${fmtSlot(b!, "en")}. Which works better for you?`;
    }
    case "booked":
      return es
        ? `¡Perfecto${name}! Su evaluación de mantenimiento quedó agendada para el ${fmtSlot(ctx.slot, "es")}. Nuestro equipo revisará la propiedad, confirmará el alcance y le dará la mejor recomendación. Gracias por elegir a Go Green Landscape.`
        : `Perfect${name}! Your maintenance evaluation is scheduled for ${fmtSlot(ctx.slot, "en")}. Our team will review the property, confirm the scope, and provide the best recommendation. Thank you for choosing Go Green Landscape.`;
  }
}

function frEs(freq?: string): string {
  if (freq === "weekly") return "semanal";
  if (freq === "biweekly") return "quincenal";
  if (freq === "monthly") return "mensual";
  return freq ?? "";
}
