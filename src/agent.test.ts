// Funnel-agent test (key-gated).
//
// - No ANTHROPIC_API_KEY → SKIP the live assertions cleanly (exit 0). The deterministic
//   surface (language detection, bilingual escalation routing, gating math) is proven by
//   the offline checks below, which always run.
// - With a key → fires two real Messages calls and asserts:
//     S1 (happy, EN): a populated state missing only identity → the agent asks for the
//         ONE remaining field (identity) and does NOT re-ask address/photos. nextStep=identity.
//     S2 (escalation, ES): "soy administrador de la propiedad" → suggestedPatch.escalation
//         with primary="property_manager", routed to human_review, reply in Spanish, and
//         no client-facing charge/schedule action.
//   Plus prints the sample EN + ES replies.

import {
  runFunnelAgent,
  missingGatingFields,
  __test__,
  type ChatMessage,
} from "./agent";
import type { FunnelState } from "./contract";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`ASSERT FAILED: ${msg}`);
    process.exit(1);
  }
}

// ── Field-ask keyword detectors (to prove "exactly ONE missing field" asked) ──
// "email address" / "correo" legitimately appears when asking identity, so strip the
// email-address phrasing before checking for a PROPERTY-address re-ask.
const stripEmail = (s: string) => s.replace(/e-?mail\s+address(es)?/gi, "email").replace(/correo\s+electr[oó]nico/gi, "correo");
const KW = {
  address: /\baddress\b|direcci[oó]n|\bzip\b|\b94\d{3}\b/i,
  photos: /\bphotos?\b|\bfotos?\b|\bpictures?\b|im[aá]genes/i,
  identity: /\bname\b|\bemail\b|\be-mail\b|\bphone\b|contact|nombre|correo|tel[eé]fono/i,
};
const reAsksAddress = (reply: string) => KW.address.test(stripEmail(reply));
const reAsksPhotos = (reply: string) => KW.photos.test(reply);

const isSpanish = (s: string) =>
  /[áéíóúñ¿¡]|\b(gracias|equipo|revisi[oó]n|cargo|por favor|nombre|correo|jard[ií]n|plan|propiedad|reservar|hola)\b/i.test(
    s,
  );

// ── A fully-populated standard-residential state missing ONLY identity ──
function happyStateMissingIdentity(): FunnelState {
  return {
    step: "identity",
    language: "en",
    intent: "weekly maintenance for the front yard",
    address: "123 Valencia St, San Francisco, CA 94110",
    photos: ["photo-1.jpg", "photo-2.jpg"],
    recommendedTier: "signature",
    confirmedTier: "signature",
    selectedAddOns: [],
    frequency: "weekly",
    // identity intentionally absent → the single remaining gating field
  };
}

function freshState(language: "en" | "es"): FunnelState {
  return { step: "intent", language, photos: [], selectedAddOns: [] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Offline checks — always run, no key needed.
// ─────────────────────────────────────────────────────────────────────────────
function offlineChecks() {
  // Language detection mirrors the customer.
  assert(__test__.detectLanguage("weekly maintenance, 94110") === "en", "EN detect");
  assert(__test__.detectLanguage("soy administrador de la propiedad") === "es", "ES detect");

  // Bilingual escalation gate maps Spanish property-manager wording → enum.
  const esEsc = __test__.detectEscalation("soy administrador de la propiedad", freshState("es"));
  assert(esEsc !== null, "ES property-manager must escalate");
  assert(esEsc!.primary === "property_manager", `primary must be property_manager, got ${esEsc?.primary}`);
  assert(esEsc!.autoChargeBlocked === true, "escalation must block auto-charge");
  assert(typeof esEsc!.brief === "string" && esEsc!.brief.length > 20, "escalation brief must be a complete string");

  // English HOA still flags.
  const enEsc = __test__.detectEscalation("We are an HOA board looking for service", freshState("en"));
  assert(enEsc?.primary === "hoa", "EN HOA must flag hoa");

  // A clean residential message does NOT escalate.
  const clean = __test__.detectEscalation("weekly maintenance for my front yard, 94110", freshState("en"));
  assert(clean === null, "clean residential must not escalate");

  // Gating math: the happy state is missing exactly identity.
  const miss = missingGatingFields(happyStateMissingIdentity());
  assert(miss.length === 1 && miss[0] === "identity", `expected only [identity], got ${JSON.stringify(miss)}`);

  // Fresh state is missing everything, intent first.
  const allMiss = missingGatingFields(freshState("en"));
  assert(allMiss[0] === "intent", "fresh state asks intent first");

  // deriveNextStep advances to identity when only identity is missing.
  assert(
    __test__.deriveNextStep(happyStateMissingIdentity(), miss) === "identity",
    "nextStep must be identity",
  );

  console.log("[agent.test] offline checks: PASS");
}

// Escalation routing is a deterministic pre-LLM gate (asserted regardless of key). The
// template happy-path is only meaningful with NO key — with a key, runFunnelAgent calls
// the live LLM, which is liveChecks' job — so it stays key-gated to avoid flakiness.
async function deterministicRuntimeChecks() {
  const esc = await runFunnelAgent({
    messages: [{ role: "user", content: "Hola, soy administrador de la propiedad y necesito servicio" }],
    funnelState: freshState("es"),
  });
  assert(esc.nextStep === "human_review", "escalation nextStep must be human_review");
  assert(esc.suggestedPatch?.escalation?.primary === "property_manager", "escalation primary must be property_manager");
  assert(esc.suggestedPatch?.escalation?.autoChargeBlocked === true, "escalation must block auto-charge");
  assert(isSpanish(esc.reply), "escalation reply must be Spanish");

  if (!process.env.ANTHROPIC_API_KEY) {
    const res = await runFunnelAgent({
      messages: [{ role: "user", content: "weekly maintenance for my front yard, 94110, photos attached" }],
      funnelState: happyStateMissingIdentity(),
    });
    assert(res.nextStep === "identity", `no-key happy nextStep should be identity, got ${res.nextStep}`);
    assert(KW.identity.test(res.reply), "no-key happy reply must ask for name/email");
    assert(!reAsksAddress(res.reply), "no-key happy reply must NOT re-ask property address");
    assert(!reAsksPhotos(res.reply), "no-key happy reply must NOT re-ask photos");
  }

  console.log("[agent.test] deterministic runtime checks: PASS");
}

// ─────────────────────────────────────────────────────────────────────────────
// Live checks — only with a key.
// ─────────────────────────────────────────────────────────────────────────────
async function liveChecks() {
  console.log(`[agent.test] live model = ${__test__.getFunnelModel()}`);

  // S1 — Happy, EN. Populated state missing only identity → asks the ONE field.
  const messagesEN: ChatMessage[] = [
    { role: "user", content: "weekly maintenance for my front yard, 94110, photos attached" },
  ];
  const s1 = await runFunnelAgent({ messages: messagesEN, funnelState: happyStateMissingIdentity() });
  console.log("\n[agent.test] ── SAMPLE EN REPLY (happy, asks ONE field) ──");
  console.log(`  nextStep: ${s1.nextStep}`);
  console.log(`  reply:    ${s1.reply}`);
  console.log(`  patch:    ${JSON.stringify(s1.suggestedPatch)}`);

  assert(s1.nextStep === "identity", `S1 nextStep must be identity, got ${s1.nextStep}`);
  assert(KW.identity.test(s1.reply), "S1 reply must ask for the identity field (name/email)");
  assert(!reAsksAddress(s1.reply), "S1 reply must NOT re-ask the already-known property address");
  assert(!reAsksPhotos(s1.reply), "S1 reply must NOT re-ask the already-known photos");

  // S2 — Escalation, ES. Property manager → escalation, Spanish, no charge.
  const messagesES: ChatMessage[] = [
    { role: "user", content: "Hola, soy administrador de la propiedad y administro varios edificios. Necesito mantenimiento." },
  ];
  const s2 = await runFunnelAgent({ messages: messagesES, funnelState: freshState("es") });
  console.log("\n[agent.test] ── SAMPLE ES REPLY (escalation, property_manager) ──");
  console.log(`  nextStep: ${s2.nextStep}`);
  console.log(`  reply:    ${s2.reply}`);
  console.log(`  patch:    ${JSON.stringify(s2.suggestedPatch)}`);

  assert(s2.nextStep === "human_review", `S2 nextStep must be human_review, got ${s2.nextStep}`);
  assert(
    s2.suggestedPatch?.escalation?.primary === "property_manager",
    `S2 escalation primary must be property_manager, got ${s2.suggestedPatch?.escalation?.primary}`,
  );
  assert(s2.suggestedPatch?.escalation?.autoChargeBlocked === true, "S2 must block auto-charge");
  assert(isSpanish(s2.reply), "S2 reply must be in Spanish (mirror the customer)");

  console.log("\n[agent.test] live checks: PASS");
}

async function main() {
  offlineChecks();
  await deterministicRuntimeChecks();

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("[agent.test] SKIP live: no ANTHROPIC_API_KEY");
    process.exit(0);
  }
  await liveChecks();
}

main().catch((err) => {
  console.error("[agent.test] unexpected error:", err);
  process.exit(1);
});
