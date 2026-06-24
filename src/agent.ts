// Web-funnel orchestrator (BUILD-DECISIONS pivot: Telegram chat → web funnel + Stripe).
//
// This is the REASONING SURFACE. It never charges, books, or invents a price. It:
//   - detects the customer's language and mirrors it,
//   - runs the deterministic escalation gate FIRST (bilingual) and routes edges to a
//     human with a complete brief (EscalationFlag shape from contract.ts),
//   - figures out the single next missing gating field and asks for ONLY that one thing,
//   - when everything is present, advances the funnel toward tier_recommend → quote →
//     checkout via a suggestedPatch,
//   - lets Claude phrase the reply + call the in-prompt "tools" (recommend_tier,
//     sanity_check_tier, mark_escalation) via JSON-mode (NOT function-calling).
//
// Reliability lives in the deterministic gates (S1) and routes (S6). The model can
// recommend and mark intent; the irreversible actions are code. Per AGENTS.md "two
// surfaces", this runs in the SERVERLESS context, so it uses @anthropic-ai/sdk Messages
// API — NOT @anthropic-ai/claude-agent-sdk (which needs a subprocess + writable FS).
//
// With no ANTHROPIC_API_KEY it still works (zero-key promise): deterministic templates
// ask for the missing field. With a key, Claude writes the reply.

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { FUNNEL_SYSTEM_PROMPT } from "./funnel-prompt";
import {
  PRICE_BOOK,
  type Tier,
  type FunnelState,
  type FunnelStep,
  type EscalationFlag,
  type EscalationReason,
} from "./contract";
import { runOperator } from "./operator";

// ─────────────────────────────────────────────────────────────────────────────
// Public I/O
// ─────────────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface FunnelAgentInput {
  messages: ChatMessage[];
  funnelState: FunnelState;
}

export interface FunnelAgentResult {
  reply: string;
  nextStep: FunnelStep;
  suggestedPatch?: Partial<FunnelState>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Model selection
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_FUNNEL_MODEL = "claude-sonnet-4-5";
function getFunnelModel(): string {
  return process.env.FUNNEL_MODEL ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_FUNNEL_MODEL;
}

// ─────────────────────────────────────────────────────────────────────────────
// Language detection — mirror the customer (BUILD-DECISIONS §G2)
// ─────────────────────────────────────────────────────────────────────────────

const ES_HINT =
  /[áéíóúñ¿¡]|\b(hola|gracias|jard[ií]n|soy|de la|del|por favor|necesito|quiero|mantenimiento|semanal|quincenal|mensual|propiedad|administrador|administradora|fotos|foto|direcci[oó]n|c[oó]mo|cu[aá]nto|precio|patio|cesped|c[eé]sped|riego)\b/i;

function detectLanguage(text: string, fallback: "en" | "es" = "en"): "en" | "es" {
  if (!text || !text.trim()) return fallback;
  if (ES_HINT.test(text)) return "es";
  return "en";
}

function lastUserMessage(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === "user") return m.content;
  }
  return messages[messages.length - 1]?.content ?? "";
}

// ─────────────────────────────────────────────────────────────────────────────
// Escalation gate — bilingual, deterministic, maps to EscalationReason (contract.ts)
//
// The shared escalation.ts patterns are English-only and return label strings; here we
// need the contract's EscalationReason enum AND Spanish coverage (e.g. "administrador de
// la propiedad"). This is the funnel's own edge-router. It does NOT modify escalation.ts.
// ─────────────────────────────────────────────────────────────────────────────

const ESCALATION_PATTERNS: Array<[RegExp, EscalationReason]> = [
  [/\bHOA\b|homeowners?\s*association|asociaci[oó]n de (propietarios|vecinos)/i, "hoa"],
  [
    /property\s*manager|propert(y|ies)\s*management|building\s*manager|administrador(a)?\s+de\s+(la\s+)?propiedad|administraci[oó]n de (la )?propiedad|gerente de (la )?propiedad|encargad[oa] del edificio/i,
    "property_manager",
  ],
  [
    /commercial|office\s*building|retail|storefront|multifamily|apartment\s*complex|comercial|edificio de oficinas|local comercial|plaza comercial/i,
    "commercial",
  ],
  [/refund|money\s*back|reembolso|devoluci[oó]n|me devuelvan|descuento|discount/i, "refund"],
  [
    /lawsuit|legal|attorney|lawyer|liabilit|warrant(y|ies)|demanda|abogad[oa]|garant[ií]a|responsabilidad legal/i,
    "legal_warranty",
  ],
  [/damage|broke|destroyed|killed my|ruined|da[ñn]o|da[ñn]aron|destru|arruin|mataron mis/i, "damage"],
  [
    /complaint|terrible|awful|furious|unacceptable|horrible|queja|inaceptable|p[eé]simo|muy molest|indignad/i,
    "complaint",
  ],
  [
    /hardscape|retaining\s*wall|pergola|french\s*drain|paver\s*install|patio\s*install|deck\s*build|concrete\s*work|muro de contenci[oó]n|construcci[oó]n|instalaci[oó]n de (patio|pavimento)/i,
    "hardscape_large_install",
  ],
  [
    /\b(urgent|emergency|asap|today\s*only|right\s*now|immediately)\b|urgente|emergencia|hoy mismo|ahora mismo|de inmediato|cuanto antes/i,
    "extreme_urgency",
  ],
];

const ESCALATION_LABEL: Record<EscalationReason, string> = {
  hoa: "HOA inquiry",
  property_manager: "property manager inquiry",
  commercial: "commercial property",
  complaint: "complaint / upset customer",
  refund: "refund or discount request",
  legal_warranty: "legal / warranty mention",
  damage: "damage report",
  hardscape_large_install: "hardscape / large install",
  out_of_area: "out of service area",
  extreme_urgency: "extreme urgency",
  open_ended_addon: "open-ended add-on (needs human quote)",
  low_vision_confidence: "low photo confidence",
  contradictory_scope: "contradictory scope",
  missing_photos: "missing / unusable photos",
  no_slot_within_window: "no slot within 14-day window",
};

function detectEscalation(text: string, state: FunnelState): EscalationFlag | null {
  const flags: EscalationReason[] = [];
  for (const [re, reason] of ESCALATION_PATTERNS) {
    if (re.test(text) && !flags.includes(reason)) flags.push(reason);
  }
  if (flags.length === 0) return null;

  const primary = flags[0]!;
  const labels = flags.map((f) => ESCALATION_LABEL[f]).join("; ");
  const capturedContact: NonNullable<EscalationFlag["capturedContact"]> = {};
  if (state.identity?.name) capturedContact.name = state.identity.name;
  if (state.identity?.email) capturedContact.email = state.identity.email;
  if (state.identity?.phone) capturedContact.phone = state.identity.phone;
  const addr = state.address ?? state.identity?.address;
  if (addr) capturedContact.address = addr;

  const brief =
    `Auto-flagged by the funnel agent: ${labels}. ` +
    `No auto-charge per BUILD-DECISIONS §F1 — routed to the human queue for personal review. ` +
    `Customer language: ${state.language}. ` +
    `Inbound: "${text.slice(0, 240)}".`;

  return {
    flags,
    primary,
    brief,
    ...(Object.keys(capturedContact).length ? { capturedContact } : {}),
    autoChargeBlocked: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic gating — which ONE field is missing, and what's the next step.
// Stop condition (ready to price + pay): tier + address + photos + frequency + identity.
// ─────────────────────────────────────────────────────────────────────────────

export type GatingField = "intent" | "address" | "photos" | "frequency" | "tier" | "identity";

export function missingGatingFields(s: FunnelState): GatingField[] {
  const out: GatingField[] = [];
  if (!s.intent || !s.intent.trim()) out.push("intent");
  if (!(s.address || s.identity?.address)) out.push("address");
  if (!s.photos || s.photos.length === 0) out.push("photos");
  if (!s.frequency) out.push("frequency");
  if (!s.confirmedTier) out.push("tier");
  if (!(s.identity?.name && s.identity?.email)) out.push("identity");
  return out;
}

function deriveNextStep(s: FunnelState, missing: GatingField[]): FunnelStep {
  if (s.escalation) return "human_review";
  if (missing.includes("intent")) return "intent";
  if (missing.includes("address") || missing.includes("photos") || missing.includes("frequency")) {
    return "space_photos";
  }
  if (missing.includes("tier")) return "tier_recommend";
  if (missing.includes("identity")) return "identity";
  // Everything gating is present → price + pay (S1/S6 own the math + charge).
  if (!s.pricingResult) return "quote";
  if (!s.checkoutResult || s.checkoutResult.status !== "succeeded") return "checkout";
  if (!s.selectedSlotId) return "schedule";
  return "confirmed";
}

// English description of the single field to ask for (the model mirrors it into ES).
const FIELD_ASK: Record<GatingField, string> = {
  intent:
    "what they'd like help with — which areas of the garden and their goal for the space",
  address: "the property address, including the ZIP code",
  photos: "a few photos of the garden areas (needed to recommend the right care)",
  frequency: "their preferred service frequency: weekly, biweekly, or monthly",
  tier: "(do not ask a field — recommend ONE care tier and invite them to confirm it)",
  identity: "their contact details — name and email (phone optional)",
};

// ─────────────────────────────────────────────────────────────────────────────
// LLM output schema (JSON-mode). The model EMITS this; we never trust it for the
// irreversible decisions — nextStep + missing field are computed deterministically.
// ─────────────────────────────────────────────────────────────────────────────

const TierEnum = z.enum(["essential", "signature", "estate"]);
const ESCALATION_REASONS = [
  "hoa", "property_manager", "commercial", "complaint", "refund", "legal_warranty",
  "damage", "hardscape_large_install", "out_of_area", "extreme_urgency",
  "open_ended_addon", "low_vision_confidence", "contradictory_scope", "missing_photos",
  "no_slot_within_window",
] as const;
const EscalationReasonEnum = z.enum(ESCALATION_REASONS);

const TurnSchema = z.object({
  language: z.enum(["en", "es"]),
  reply: z.string().min(1),
  asked_field: z
    .enum(["intent", "address", "photos", "frequency", "tier", "identity"])
    .nullable()
    .optional(),
  tools: z
    .object({
      recommend_tier: z
        .object({ tier: TierEnum, reason: z.string() })
        .nullable()
        .optional(),
      sanity_check_tier: z
        .object({
          chosen: TierEnum,
          verdict: z.enum(["ok", "suggest_upgrade", "suggest_downgrade"]),
          note: z.string(),
        })
        .nullable()
        .optional(),
      mark_escalation: z
        .object({
          primary: EscalationReasonEnum,
          flags: z.array(EscalationReasonEnum).optional(),
          brief: z.string(),
        })
        .nullable()
        .optional(),
    })
    .optional(),
});
type TurnOutput = z.infer<typeof TurnSchema>;

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) return fence[1].trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  return trimmed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-turn directive — the dynamic, deterministic context the model must honor.
// ─────────────────────────────────────────────────────────────────────────────

function buildTurnDirective(
  state: FunnelState,
  language: "en" | "es",
  missing: GatingField[],
  nextStep: FunnelStep,
): string {
  const settled: string[] = [];
  if (state.intent?.trim()) settled.push("the need/intent");
  if (state.address ?? state.identity?.address) settled.push("the address");
  if ((state.photos?.length ?? 0) > 0) settled.push("the photos");
  if (state.frequency) settled.push(`the frequency (${state.frequency})`);
  if (state.confirmedTier) settled.push(`the tier (confirmed: ${PRICE_BOOK[state.confirmedTier].name})`);
  if (state.identity?.name && state.identity?.email) settled.push("the identity");
  const settledLine = settled.length ? settled.join(", ") : "nothing yet";

  let action: string;
  if (nextStep === "tier_recommend") {
    action =
      "All needs are known but no tier is confirmed yet. Recommend EXACTLY ONE care tier via the recommend_tier tool and, in your reply, invite the customer to confirm it. Ask for no other field.";
  } else if (nextStep === "quote" || nextStep === "checkout" || nextStep === "schedule") {
    action =
      "Everything required is collected. Do NOT ask any qualifying question and do NOT re-pitch the tier. Confirm warmly and tell them the next step is to review their plan total and pay the first month now (the system shows the exact figure and handles payment — you NEVER state a number or take payment), then choose a real time slot.";
  } else {
    const field = missing[0] ?? "intent";
    const ask = FIELD_ASK[field];
    action =
      `Your ONLY task this turn: ask the customer for ${ask}. ` +
      `Everything else is already settled (${settledLine}) — do NOT re-ask, re-confirm, re-recommend, or re-pitch any of it (including the tier). ` +
      `Ask this ONE thing and nothing else. Set asked_field="${field}".`;
  }

  const tierPrices = Object.values(PRICE_BOOK)
    .map((t) => `${t.name}=$${t.perVisit}`)
    .join(", ");

  return `# THIS TURN — deterministic context. Obey it exactly; never contradict the engine.
Reply language MUST be: ${language}
Already settled (NEVER revisit, re-ask, or re-pitch these): ${settledLine}
Target funnel step: ${nextStep}
Flat tier prices (authoritative, never alter): ${tierPrices}
YOUR SINGLE NEXT ACTION: ${action}

Output ONLY the single JSON object from the contract. Put your customer-facing words in "reply", written in ${language}. Keep it brief — one short paragraph, one ask.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// No-key deterministic templates — the zero-key promise (AGENTS.md two surfaces).
// ─────────────────────────────────────────────────────────────────────────────

function templateAsk(field: GatingField | "ready", language: "en" | "es", state: FunnelState): string {
  const es = language === "es";
  switch (field) {
    case "intent":
      return es
        ? "Gracias por contactar a Go Green Landscape. Con gusto le ayudamos a cuidar su jardín. Para empezar, ¿podría contarnos qué áreas le gustaría atender y qué busca para su espacio?"
        : "Thank you for reaching out to Go Green Landscape. We'd be glad to help care for your garden. To start, could you tell us which areas you'd like us to handle and what you're hoping for from the space?";
    case "address":
      return es
        ? "Gracias. Para continuar, ¿podría compartirnos la dirección de la propiedad, incluyendo el código postal?"
        : "Thank you. To continue, could you share the property address, including the ZIP code?";
    case "photos":
      return es
        ? "Perfecto. ¿Podría enviarnos algunas fotos de las áreas del jardín? Nos ayudan a recomendarle el nivel de cuidado correcto."
        : "Perfect. Could you send a few photos of the garden areas? They help us recommend the right level of care.";
    case "frequency":
      return es
        ? "Gracias. ¿Con qué frecuencia le gustaría el servicio: semanal, cada dos semanas o mensual?"
        : "Thank you. How often would you like service: weekly, biweekly, or monthly?";
    case "tier": {
      const tierSpec = PRICE_BOOK[state.recommendedTier ?? "signature"];
      return es
        ? `Según lo que vemos, le recomendamos el plan ${tierSpec.name} ($${tierSpec.perVisit} por visita). ¿Le gustaría confirmar este plan para continuar?`
        : `Based on what we see, we'd recommend ${tierSpec.name} ($${tierSpec.perVisit} per visit). Would you like to confirm this plan to continue?`;
    }
    case "identity":
      return es
        ? "Excelente. Para preparar su plan, ¿podría darnos su nombre y correo electrónico (el teléfono es opcional)?"
        : "Great. To prepare your plan, could you share your name and email (phone is optional)?";
    case "ready":
      return es
        ? "¡Todo listo! El siguiente paso es revisar el total de su plan y pagar el primer mes para reservar. Después podrá elegir el horario de su primera visita. Recuerde: el plan recurrente solo se confirma después de una primera visita exitosa."
        : "You're all set! The next step is to review your plan total and pay the first month to reserve. After that, you'll choose your first visit's time slot. Remember: the recurring plan only locks in after a successful first visit.";
  }
}

function templateEscalationReply(language: "en" | "es"): string {
  return language === "es"
    ? "Gracias por compartir esa información. Una solicitud como esta la atiende mejor un miembro de nuestro equipo, así que la estoy remitiendo ahora para una revisión personal. Se comunicarán con usted muy pronto — y para su tranquilidad, no se realizará ningún cargo mientras la revisamos."
    : "Thank you for sharing that. A request like this is best handled directly by a member of our team, so I'm forwarding your details now for a personal review. They'll follow up with you shortly — and to be clear, nothing will be charged while we review this.";
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry — the funnel reasoning surface.
// ─────────────────────────────────────────────────────────────────────────────

export async function runFunnelAgent(input: FunnelAgentInput): Promise<FunnelAgentResult> {
  const { messages, funnelState } = input;
  const latest = lastUserMessage(messages);
  const language = detectLanguage(latest, funnelState.language ?? "en");

  // 1) Escalation gate FIRST — deterministic, bilingual. Flagged → no client-facing
  //    collection, no charge, complete brief, human takes over (§F1).
  const escalation = detectEscalation(latest, { ...funnelState, language });
  if (escalation) {
    return {
      reply: templateEscalationReply(language),
      nextStep: "human_review",
      suggestedPatch: { language, step: "human_review", escalation },
    };
  }

  // 2) Deterministic gating — the single missing field + the next step.
  const missing = missingGatingFields(funnelState);
  const nextStep = deriveNextStep(funnelState, missing);

  // 3) No key → deterministic template (zero-key promise). Still mirrors language.
  if (!process.env.ANTHROPIC_API_KEY) {
    const reply =
      nextStep === "tier_recommend"
        ? templateAsk("tier", language, funnelState)
        : nextStep === "quote" || nextStep === "checkout" || nextStep === "schedule"
          ? templateAsk("ready", language, funnelState)
          : templateAsk(missing[0] ?? "intent", language, funnelState);
    return { reply, nextStep, suggestedPatch: buildPatch(language, nextStep, undefined) };
  }

  // 4) Claude phrases the reply + may call the in-prompt tools (JSON-mode).
  const directive = buildTurnDirective(funnelState, language, missing, nextStep);
  let turn: TurnOutput | null = null;
  try {
    const client = new Anthropic();
    const resp = await client.messages.create({
      model: getFunnelModel(),
      max_tokens: 700,
      system: `${FUNNEL_SYSTEM_PROMPT}\n\n${directive}`,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });
    const raw = resp.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("")
      .trim();
    const parsed = TurnSchema.safeParse(JSON.parse(extractJsonObject(raw)));
    if (parsed.success) turn = parsed.data;
  } catch {
    turn = null;
  }

  // 5) Parse failure / no output → deterministic fallback (never throw on the hot path).
  if (!turn) {
    const reply =
      nextStep === "tier_recommend"
        ? templateAsk("tier", language, funnelState)
        : nextStep === "quote" || nextStep === "checkout" || nextStep === "schedule"
          ? templateAsk("ready", language, funnelState)
          : templateAsk(missing[0] ?? "intent", language, funnelState);
    return { reply, nextStep, suggestedPatch: buildPatch(language, nextStep, undefined) };
  }

  // 6) The model may surface an escalation the regex missed (e.g. nuanced wording).
  //    Honor it: route to human, no charge, build the contract EscalationFlag.
  const llmEsc = turn.tools?.mark_escalation;
  if (llmEsc) {
    const flags = (llmEsc.flags && llmEsc.flags.length ? llmEsc.flags : [llmEsc.primary]) as EscalationReason[];
    const flag: EscalationFlag = {
      flags,
      primary: llmEsc.primary as EscalationReason,
      brief: llmEsc.brief,
      autoChargeBlocked: true,
    };
    const contact = collectContact(funnelState);
    if (contact) flag.capturedContact = contact;
    return {
      reply: turn.reply,
      nextStep: "human_review",
      suggestedPatch: { language: turn.language, step: "human_review", escalation: flag },
    };
  }

  // 7) Normal turn. nextStep is deterministic; the model only phrased + (maybe)
  //    recommended a tier.
  const recommended =
    turn.tools?.recommend_tier?.tier ?? funnelState.recommendedTier ?? undefined;
  return {
    reply: turn.reply,
    nextStep,
    suggestedPatch: buildPatch(turn.language, nextStep, recommended),
  };
}

function collectContact(s: FunnelState): EscalationFlag["capturedContact"] | undefined {
  const cc: NonNullable<EscalationFlag["capturedContact"]> = {};
  if (s.identity?.name) cc.name = s.identity.name;
  if (s.identity?.email) cc.email = s.identity.email;
  if (s.identity?.phone) cc.phone = s.identity.phone;
  const addr = s.address ?? s.identity?.address;
  if (addr) cc.address = addr;
  return Object.keys(cc).length ? cc : undefined;
}

function buildPatch(
  language: "en" | "es",
  nextStep: FunnelStep,
  recommendedTier: Tier | undefined,
): Partial<FunnelState> {
  const patch: Partial<FunnelState> = { language, step: nextStep };
  if (recommendedTier) patch.recommendedTier = recommendedTier;
  return patch;
}

// ─────────────────────────────────────────────────────────────────────────────
// Backward-compat shim for the staged Telegram entrypoint (src/index.ts — out of
// scope). The Agent-SDK runtime was retired in the web-funnel pivot; route the legacy
// call through the deterministic operator so index.ts keeps typechecking and running
// WITHOUT the serverless-incompatible claude-agent-sdk.
// ─────────────────────────────────────────────────────────────────────────────

export interface RunLeadInput {
  lead_id: string;
  channel: "telegram" | "email" | "whatsapp" | "form";
  inbound_text: string;
  photo_urls?: string[];
}

/** @deprecated Legacy Telegram path. Prefer runFunnelAgent for the web funnel. */
export async function runLead(input: RunLeadInput): Promise<{ result: string }> {
  const res = await runOperator({
    lead_id: input.lead_id,
    channel: input.channel,
    text: input.inbound_text,
    has_photo: (input.photo_urls?.length ?? 0) > 0,
  });
  return { result: res.reply };
}

// Exposed for tests.
export const __test__ = {
  detectLanguage,
  detectEscalation,
  missingGatingFields,
  deriveNextStep,
  extractJsonObject,
  getFunnelModel,
  TurnSchema,
};
