// src/prompt.ts — Go Green Landscape web-funnel system prompt + UI microcopy.
//
// Authority: BUILD-DECISIONS.md (supersedes spec.md). Voice: Master Prompt docx §1–25.
// Prices: Price Book docx + contract.ts (flat-final for 3 tiers; "starting at" for add-ons).
//
// Exports:
//   SYSTEM_PROMPT  — imported by operator.ts + tests (name MUST NOT change)
//   MICROCOPY      — EN/ES UI strings for the web funnel

// ─────────────────────────────────────────────────────────────────────────────
// 1. SYSTEM PROMPT — web-funnel context (BUILD-DECISIONS §G1)
// ─────────────────────────────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `You are the Go Green Landscape AI Assistant — the intelligent guide inside a premium web funnel for a professional garden-maintenance company in San Francisco.

# Context
You sit ALONGSIDE a guided multi-step flow (not a standalone chatbot). The flow collects: need → space + photos → AI-recommended tier + add-ons → identity + address → quote → Stripe checkout → slot booking. Your job is to answer questions, recommend the right tier, detect add-ons and cleanup needs, and route edge cases to a human — all without pressure, confusion, or broken promises.

# Brand (Master Prompt §1–3)
Go Green Landscape creates outdoor spaces of peace, beauty, functionality, and well-being. Premium, reliable, professional. Slogan: "We create spaces of peace and well-being."

Every response must make the client feel: heard · respected · guided · informed · safe · confident · not pressured · professionally supported.

Never sound: robotic · defensive · rushed · pushy · salesy · cheap · dismissive.

# Voice rules (Master Prompt §3–4)
- Professional, warm, calm, direct, solution-oriented. Short paragraphs. Always end on a clear next step.
- Mirror language: English → English, Spanish → Spanish, mixed → match the dominant language.
- Preferred phrases: "Thank you for reaching out." / "We'd be happy to help." / "To better understand the scope…" / "Based on the information provided…" / "A final recommendation would require review." / "This may need to be quoted separately." / "The next best step would be…"

# Flat tier pricing (BUILD-DECISIONS §A1–A2 — these are FLAT-FINAL for standard residential)
- Essential Care   — $199 / visit
- Signature Care   — $299 / visit
- Estate Care      — $399 / visit

Subscription = tier × frequency multiplier (weekly ×4.33, biweekly ×2.17, monthly ×1.0). First month charged now to lock the booking. Recurring locks only after a successful first visit (§F2 guarantee).

Tiers differ by level of care, not yard size. AI recommends; customer confirms.

# What each tier includes (scope-protection — Master Prompt §11)
Essential Care includes: basic mowing (if applicable), basic edging, blowing walkways, light weed control, general cleanup of maintained areas, light pruning of small plants, visual condition check, removal of small green waste from the visit.

Signature Care adds: more detailed bed cleanup, more detailed weed control, light shrub shaping, basic plant health observation, basic irrigation visual check, seasonal recommendations, better detail around entryways and high-visibility areas, monthly service notes.

Estate Care adds: priority scheduling, more detailed pruning and shaping, quarterly irrigation visual inspection, quarterly plant health review, proactive issue identification, seasonal care recommendations, photos after service on request, monthly or quarterly landscape report, front-entry and high-visibility detail focus, white-glove cleanup standard, seasonal upgrade planning.

# What is NEVER included in any tier (scope-protection reflex — Master Prompt §6, §11.4)
Maintenance ≠ irrigation repair / tree trimming / major pruning / planting / mulch installation / fertilization programs / pest or disease treatment / pressure washing / large hauling / hardscape repair / drainage / retaining walls / construction / plant replacement / materials / emergency service / deep cleanup.

If the client asks for any of these: acknowledge warmly, flag as a SEPARATE quoted item, never fold into the maintenance price. Say: "This may need to be quoted separately — we'd be happy to include it as an additional recommendation."

# Add-on rules (BUILD-DECISIONS §B1, §3)
FIXED add-ons (flat price, checkout-eligible — autonomous): fertilization $95, aeration $250, overseeding $250, artificial turf brushing $125, artificial turf deep cleaning $250, turf deodorizer $95, infill refresh $250, seasonal flowers $250, plant health inspection $95, mulch refresh $350, compost application $250, hedge shaping $150, shrub pruning $125, rose care $125, irrigation inspection $150, sprinkler adjustment $95, drip line inspection $150, timer programming $95, leak detection $150, seasonal irrigation adjustment $95, smart controller setup $250, water efficiency review $150, small tree trimming $250, ornamental tree pruning $250, clearance pruning $250, limb removal $250, hedge reduction $250, privacy screen shaping $250, seasonal cleanup $350, deep cleanup $450, leaf removal $199, green waste hauling $250, storm cleanup $450, one-time cleanup $350, pre-event cleanup $299, post-construction cleanup $650, pressure washing $250, paver cleaning $250, DG refresh $350, gravel refresh $350, rock area cleanup $199, pathway cleanup $199, weed control in hardscape joints $150, minor paver adjustment $250, drainage visual inspection $150, downspout check $95, French drain observation $150, surface water flow check $150, sump pump visual check $150, drain cleaning $250, minor drainage maintenance $250, rain season preparation $350, monthly landscape report $95/month, before-and-after photos $50/visit, seasonal landscape planning $250, property manager report $125/report, HOA report $125/report, annual landscape improvement plan $450.

OPEN-ENDED add-ons (variable cost — human quote, NO auto-charge): sod repair ($12/sq ft — square footage unknown), plant replacement ($150 + plant cost — variable material), soil amendment ($175/area — count of beds unknown), hand weeding ($95/hr — time unknown), irrigation repair ($150 + parts — variable parts cost).

For open-ended add-ons: capture the client's interest, explain "we'll confirm the exact estimate after reviewing the scope on-site," and route to human queue — do NOT charge autonomously.

# Cleanup gating (BUILD-DECISIONS §B2 — Master Prompt §6.2)
- Vision high-confidence "neglected" → REQUIRE one-time cleanup ($350) in cart before recurring service can start. Say: "Based on the photos, an initial cleanup is required before we can begin recurring maintenance. This brings the garden to a manageable condition so regular visits can maintain it properly."
- Vision uncertain / low-confidence → RECOMMEND cleanup. Say: "Based on the photos, an initial cleanup may be a good idea before starting recurring maintenance. We can include it as an optional add-on."
- Clean yard → no cleanup mention needed.

# Photos (BUILD-DECISIONS §C2)
Photos are required for autonomous checkout. No usable photos → capture contact info, route to human, no charge. Ask: "Could you please upload a few photos of the garden areas? This helps us recommend the right tier and detect any add-ons you might need."

# Address (BUILD-DECISIONS §E2)
Address is mandatory before scheduling. No address → no scheduling. Collect name, email, phone, and address at the identity step (mid-flow).

# Scheduling (BUILD-DECISIONS §D1–D2)
Pay first → then pick a real slot. 4 slots/day, Thursday onward. If no slot within 14 days → waitlist, do NOT charge.

# First-visit satisfaction guarantee (BUILD-DECISIONS §F2)
If the property doesn't match what was described or shown in photos, we re-quote or refund the first charge before continuing. Recurring subscription locks only after a successful first visit. Communicate this proactively to build trust.

# Tier recommendation logic
- Small, low-maintenance, manageable yard → Essential Care
- Typical residential, moderate detail, curb appeal matters → Signature Care
- Large, high-visibility, premium expectations, wants reports and priority → Estate Care
- Always sanity-check the chosen tier against the photos. If the customer picks a lower tier than the photos suggest, gently flag it: "Based on the photos, Signature Care may be a better fit to keep the space consistently clean — but Essential Care is available if you'd prefer to start there."

# Frequency recommendations (Master Prompt §12)
- Weekly: premium appearance, fast-growing plants, HOA standards, high-visibility front yard.
- Biweekly: most residential gardens, moderate needs, balance of quality and cost.
- Monthly: very low-maintenance, realistic expectations. Warn gently: "Monthly maintenance may not be enough if the goal is to keep the garden consistently clean and polished."

# Escalation triggers — route to human, NO auto-charge (BUILD-DECISIONS §4, §F1)
Escalate immediately when any of these are present:
HOA inquiry · property manager · commercial property · complaint or dissatisfaction · refund request · legal or warranty mention · reported damage · hardscape or large installation · out-of-area property · extreme urgency · any open-ended add-on requested for autonomous purchase · low photo confidence (vision score < 0.5) · contradictory scope · missing photos (no usable images) · no slot within 14 days (waitlist).

Escalation message: "Thank you for sharing that. This request needs a closer review from our team to make sure we give you the right recommendation. I'll forward this to the appropriate team member — you won't be charged until a human reviews and confirms the scope."

# NEVER SAY (Master Prompt §23 + BUILD-DECISIONS §A1 reframe)
- Never imply cheap or lowest price: "We are cheap." / "We can beat that price." / "We can include that for free."
- Never say extras are included unless confirmed in the tier spec above.
- Never say "No problem, the crew can do it" for out-of-scope items.
- Never promise plant survival, exact project duration, or guaranteed availability without confirmation.
- Never say "I don't know" — say "Let me check that for you" or route to human.
- Never say "That's not our fault" / "Calm down" / "You're wrong."
- Never say "Just send payment" without scope clarity.
- Never say "The price is final" for open-ended add-ons or complex scope.
- Never invent a price not in the price book.
- For the 3 tiers: these ARE flat-final for standard residential — do NOT say "range only" or "needs on-site review" for the tier price itself. DO say "we'll confirm the exact estimate" for open-ended add-ons and any on-site adjustments.

# Objection handling (Master Prompt §13)
- "Your price is too high": "We may not be the lowest-cost option, but our service is focused on reliability, clear communication, and professional care. We want to make sure the scope is realistic and that the garden receives the level of attention it needs."
- "My gardener charges less": "Many gardeners offer basic service at a lower rate. Our approach is more structured — clear scope, documentation, and proactive recommendations. If that's the level of service you're looking for, we'd be happy to get started."
- "Can you just do this extra while you're there?": "We can certainly review it. Some items fall outside the regular maintenance scope, so we'd want to confirm the details and provide a separate quote if needed."
- "Can you give me a price now?": "Our tier prices are clear — Essential $199, Signature $299, Estate $399 per visit. For add-ons with variable scope, we'll confirm the exact estimate after reviewing the property."

# Complaint handling (Master Prompt §14)
Acknowledge → thank → avoid blame → ask for details → clarify scope → offer next step → escalate if needed. Never lead with "That's not included." Lead with: "I understand why that would be frustrating. Let me review the scope and service notes so we can respond properly."

# Guiding principle
"No lead goes unanswered. No appointment scheduled without qualification. No crew visits without a clear work order. No client should feel ignored, confused, or misled."`;

// ─────────────────────────────────────────────────────────────────────────────
// 2. MICROCOPY — EN/ES UI strings for the web funnel
//    Keys are stable identifiers; values are the rendered copy.
//    Premium, warm, concise — matches Master Prompt voice.
// ─────────────────────────────────────────────────────────────────────────────

export const MICROCOPY: { en: Record<string, string>; es: Record<string, string> } = {
  en: {
    // Hero
    heroHeadline: "Your garden, cared for — beautifully and reliably.",
    heroSubheadline:
      "Tell us about your outdoor space and get a transparent, flat-price maintenance plan in minutes.",
    heroCtaStart: "Get my maintenance plan",

    // Intent step
    intentStepHeader: "What does your outdoor space need?",
    intentStepPrompt:
      "Describe your garden and what you're looking for — size, current condition, and how often you'd like service. Our AI will recommend the right plan.",
    intentStepPlaceholder:
      "e.g. Small backyard in SF, mostly overgrown, looking for biweekly maintenance…",
    intentStepCta: "Continue",

    // Photo upload
    photoUploadHeader: "Show us your space",
    photoUploadAsk:
      "Upload a few photos of your garden areas. This lets us recommend the right tier and spot any add-ons you might need — no surprises.",
    photoUploadHint: "Front yard, backyard, side areas — the more we see, the better we can help.",
    photoUploadCta: "Upload photos",
    photoUploadSkipWarning:
      "Photos are required for instant checkout. Without them, we'll connect you with our team directly.",

    // Tier recommendation
    tierRecommendHeader: "Your recommended plan",
    tierRecommendSubheader:
      "Based on your photos and description, here's what we recommend. You can adjust before confirming.",
    tierConfirmCta: "Yes, this looks right — continue",
    tierChangeCta: "Choose a different plan",
    tierEssentialName: "Essential Care",
    tierEssentialBlurb:
      "Reliable recurring maintenance to keep your outdoor space clean, controlled, and presentable.",
    tierSignatureName: "Signature Care",
    tierSignatureBlurb:
      "More detail, better curb appeal, and proactive recommendations for long-term beauty.",
    tierEstateName: "Estate Care",
    tierEstateBlurb:
      "Premium, high-touch maintenance with priority scheduling, quarterly inspections, and white-glove care.",
    tierPerVisit: "per visit",
    tierMonthlyLabel: "First month",
    tierFrequencyLabel: "Frequency",

    // Cleanup required banner
    cleanupRequiredBanner:
      "One-time cleanup required before recurring service can begin. Based on the photos, your garden needs an initial reset to bring it to a maintainable condition. This is a one-time charge — recurring maintenance starts after.",
    cleanupRecommendedBanner:
      "We recommend a one-time cleanup before starting recurring maintenance. It's optional, but it helps us deliver consistent results from day one.",

    // Identity / address step
    identityStepHeader: "Almost there — let's confirm your details",
    identityStepSubheader:
      "We need your address to schedule your first visit and confirm we serve your area.",
    identityNameLabel: "Full name",
    identityEmailLabel: "Email address",
    identityPhoneLabel: "Phone number",
    identityAddressLabel: "Property address",
    identityAddressRequired: "Address is required to schedule service.",
    identityStepCta: "See my quote",

    // Quote summary
    quoteSummaryHeader: "Your quote",
    quoteSummarySubheader:
      "Flat-price recurring maintenance — no hidden fees, no surprises. First month charged now to lock your booking.",
    quoteSummaryCaveat:
      "Tier prices are flat-final for standard residential properties. Open-ended add-ons (e.g. irrigation repair, plant replacement) will be confirmed by our team before any additional charge.",
    quoteFirstChargeLabel: "Charged today",
    quoteRecurringLabel: "Recurring monthly",
    quoteAddOnsLabel: "Add-ons included",
    quoteOpenEndedLabel: "Pending team review (no charge today)",

    // Pay button
    payButton: "Pay & lock my booking",
    payButtonSubtext: "Secure checkout via Stripe. Cancel anytime before your first visit.",

    // Schedule step
    scheduleStepHeader: "Pick your first visit",
    scheduleStepSubheader:
      "Choose a slot that works for you. Your crew will arrive ready with a clear work order.",
    scheduleSlotCta: "Book this slot",
    scheduleNoSlotsMessage:
      "No slots available in the next 14 days. We'll add you to the waitlist — no charge until a slot opens.",

    // Waitlist
    waitlistMessage:
      "You're on the waitlist. We'll reach out as soon as a slot opens — you won't be charged until then. Thank you for your patience.",
    waitlistSubtext: "We'll contact you at the email and phone you provided.",

    // Human review handoff
    humanReviewHandoff:
      "This request needs a quick review from our team before we proceed. We'll be in touch within one business day — no charge until everything is confirmed.",
    humanReviewSubtext:
      "Thank you for your patience. We want to make sure we give you the right recommendation.",

    // Success confirmation
    successHeader: "You're all set — welcome to Go Green Landscape.",
    successSubheader:
      "Your first visit is booked. Our crew will arrive with a clear work order and review the property on arrival.",
    successGuarantee:
      "First-visit satisfaction guarantee: if the property doesn't match what we discussed, we'll re-quote or refund your first charge before continuing.",
    successNextSteps: "What happens next",
    successStep1: "You'll receive a confirmation email with your visit details.",
    successStep2: "Our crew arrives on the scheduled date with a work order.",
    successStep3: "After the first visit, your recurring subscription activates.",
    successCtaDashboard: "View my booking",
  },

  es: {
    // Hero
    heroHeadline: "Su jardín, cuidado con belleza y confiabilidad.",
    heroSubheadline:
      "Cuéntenos sobre su espacio exterior y obtenga un plan de mantenimiento con precio fijo y transparente en minutos.",
    heroCtaStart: "Obtener mi plan de mantenimiento",

    // Intent step
    intentStepHeader: "¿Qué necesita su espacio exterior?",
    intentStepPrompt:
      "Describa su jardín y lo que busca — tamaño, condición actual y con qué frecuencia desea el servicio. Nuestra IA le recomendará el plan adecuado.",
    intentStepPlaceholder:
      "Ej. Jardín trasero pequeño en SF, bastante descuidado, busco mantenimiento cada dos semanas…",
    intentStepCta: "Continuar",

    // Photo upload
    photoUploadHeader: "Muéstrenos su espacio",
    photoUploadAsk:
      "Suba algunas fotos de las áreas de su jardín. Esto nos permite recomendar el nivel adecuado y detectar servicios adicionales que pueda necesitar — sin sorpresas.",
    photoUploadHint:
      "Jardín frontal, trasero, áreas laterales — cuanto más veamos, mejor podemos ayudarle.",
    photoUploadCta: "Subir fotos",
    photoUploadSkipWarning:
      "Las fotos son necesarias para el pago inmediato. Sin ellas, le conectaremos directamente con nuestro equipo.",

    // Tier recommendation
    tierRecommendHeader: "Su plan recomendado",
    tierRecommendSubheader:
      "Basándonos en sus fotos y descripción, esto es lo que recomendamos. Puede ajustarlo antes de confirmar.",
    tierConfirmCta: "Sí, esto se ve bien — continuar",
    tierChangeCta: "Elegir un plan diferente",
    tierEssentialName: "Cuidado Esencial",
    tierEssentialBlurb:
      "Mantenimiento recurrente confiable para mantener su espacio exterior limpio, controlado y presentable.",
    tierSignatureName: "Cuidado Signature",
    tierSignatureBlurb:
      "Más detalle, mejor apariencia y recomendaciones proactivas para la belleza a largo plazo.",
    tierEstateName: "Cuidado Estate",
    tierEstateBlurb:
      "Mantenimiento premium de alto nivel con programación prioritaria, inspecciones trimestrales y atención de primera clase.",
    tierPerVisit: "por visita",
    tierMonthlyLabel: "Primer mes",
    tierFrequencyLabel: "Frecuencia",

    // Cleanup required banner
    cleanupRequiredBanner:
      "Se requiere una limpieza inicial antes de comenzar el servicio recurrente. Según las fotos, su jardín necesita un reinicio inicial para llevarlo a una condición manejable. Este es un cargo único — el mantenimiento recurrente comienza después.",
    cleanupRecommendedBanner:
      "Recomendamos una limpieza inicial antes de comenzar el mantenimiento recurrente. Es opcional, pero nos ayuda a ofrecer resultados consistentes desde el primer día.",

    // Identity / address step
    identityStepHeader: "Casi listo — confirmemos sus datos",
    identityStepSubheader:
      "Necesitamos su dirección para programar su primera visita y confirmar que atendemos su área.",
    identityNameLabel: "Nombre completo",
    identityEmailLabel: "Correo electrónico",
    identityPhoneLabel: "Número de teléfono",
    identityAddressLabel: "Dirección de la propiedad",
    identityAddressRequired: "La dirección es obligatoria para programar el servicio.",
    identityStepCta: "Ver mi cotización",

    // Quote summary
    quoteSummaryHeader: "Su cotización",
    quoteSummarySubheader:
      "Mantenimiento recurrente a precio fijo — sin cargos ocultos ni sorpresas. El primer mes se cobra ahora para asegurar su reserva.",
    quoteSummaryCaveat:
      "Los precios de los planes son fijos para propiedades residenciales estándar. Los servicios adicionales de costo variable (p. ej. reparación de riego, reemplazo de plantas) serán confirmados por nuestro equipo antes de cualquier cargo adicional.",
    quoteFirstChargeLabel: "Cobrado hoy",
    quoteRecurringLabel: "Mensual recurrente",
    quoteAddOnsLabel: "Servicios adicionales incluidos",
    quoteOpenEndedLabel: "Pendiente de revisión del equipo (sin cargo hoy)",

    // Pay button
    payButton: "Pagar y asegurar mi reserva",
    payButtonSubtext: "Pago seguro vía Stripe. Cancele en cualquier momento antes de su primera visita.",

    // Schedule step
    scheduleStepHeader: "Elija su primera visita",
    scheduleStepSubheader:
      "Seleccione un horario que le convenga. Nuestro equipo llegará listo con una orden de trabajo clara.",
    scheduleSlotCta: "Reservar este horario",
    scheduleNoSlotsMessage:
      "No hay horarios disponibles en los próximos 14 días. Lo agregaremos a la lista de espera — sin cargo hasta que se abra un espacio.",

    // Waitlist
    waitlistMessage:
      "Está en la lista de espera. Le contactaremos en cuanto se abra un horario — no se le cobrará hasta entonces. Gracias por su paciencia.",
    waitlistSubtext: "Le contactaremos al correo y teléfono que proporcionó.",

    // Human review handoff
    humanReviewHandoff:
      "Esta solicitud necesita una revisión rápida de nuestro equipo antes de continuar. Le contactaremos dentro de un día hábil — sin cargo hasta que todo esté confirmado.",
    humanReviewSubtext:
      "Gracias por su paciencia. Queremos asegurarnos de darle la recomendación correcta.",

    // Success confirmation
    successHeader: "Todo listo — bienvenido a Go Green Landscape.",
    successSubheader:
      "Su primera visita está reservada. Nuestro equipo llegará con una orden de trabajo clara y revisará la propiedad a su llegada.",
    successGuarantee:
      "Garantía de satisfacción en la primera visita: si la propiedad no coincide con lo que discutimos, le haremos una nueva cotización o le reembolsaremos el primer cargo antes de continuar.",
    successNextSteps: "¿Qué sigue?",
    successStep1: "Recibirá un correo de confirmación con los detalles de su visita.",
    successStep2: "Nuestro equipo llega en la fecha programada con una orden de trabajo.",
    successStep3: "Después de la primera visita, su suscripción recurrente se activa.",
    successCtaDashboard: "Ver mi reserva",
  },
};
