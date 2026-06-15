"use client";

// Generative-UI cards — each one renders a tool RESULT from the agent as an
// interactive component instead of a wall of text. This is what makes the agent
// feel like a product (Linear/Vercel bar) rather than a chatbot: the model calls a
// tool, the deterministic engine returns structured data, and that data becomes UI.

import {
  Check,
  Sparkles,
  CalendarCheck,
  CreditCard,
  ShieldAlert,
  Users,
  Search,
  CircleCheck,
} from "lucide-react";
import { PRICE_BOOK, type Tier, type SlotOffer, type PricingResult } from "@/src/contract";
import type {
  QualifyResult,
  RecommendTierResult,
  ProposeCheckoutResult,
  ConfirmBookingResult,
  RaiseEscalationResult,
} from "@/src/agent-tools";

export type Lang = "en" | "es";

const L = {
  en: {
    starting: "from",
    perVisit: "/ visit",
    recommended: "Recommended",
    choose: "Choose",
    chosen: "Chosen",
    firstCharge: "Billed today",
    monthly: "Then monthly",
    addOns: "Add-ons",
    needsQuote: "Needs a quick human quote — not charged now",
    onSite: "Final price confirmed on-site after the first visit.",
    pay: "Pay & lock my booking",
    devNoStripe: "Payment isn't wired in local preview, but this is the exact amount you'd pay.",
    pickSlot: "Pick your first visit",
    book: "Book this",
    crew: (n: number) => `${n}-person crew`,
    booked: "You're booked",
    bookedSub: "We've reserved your first visit. A confirmation is on its way.",
    handoff: "A specialist will take it from here",
    handoffSub: "This one needs a human touch — nothing has been charged.",
    checking: "Checking",
    looked: "Here's what I checked",
  },
  es: {
    starting: "desde",
    perVisit: "/ visita",
    recommended: "Recomendado",
    choose: "Elegir",
    chosen: "Elegido",
    firstCharge: "Se cobra hoy",
    monthly: "Luego mensual",
    addOns: "Adicionales",
    needsQuote: "Requiere una cotización rápida con un humano — no se cobra ahora",
    onSite: "El precio final se confirma en sitio tras la primera visita.",
    pay: "Pagar y reservar",
    devNoStripe: "El pago no está conectado en la vista previa local, pero este es el monto exacto.",
    pickSlot: "Elige tu primera visita",
    book: "Reservar",
    crew: (n: number) => `Cuadrilla de ${n}`,
    booked: "Reserva confirmada",
    bookedSub: "Reservamos tu primera visita. Te enviaremos la confirmación.",
    handoff: "Un especialista lo tomará desde aquí",
    handoffSub: "Este caso necesita atención humana — no se ha cobrado nada.",
    checking: "Revisando",
    looked: "Esto es lo que revisé",
  },
} satisfies Record<Lang, Record<string, unknown>>;

const money = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rise-in rounded-2xl border border-moss-100 bg-white shadow-petal overflow-hidden">
      {children}
    </div>
  );
}

// ── reasoning trace chip — "what I checked" (qualify_lead / analyze_photos) ──────
export function TraceChip({ lang, lines }: { lang: Lang; lines: string[] }) {
  return (
    <details className="rise-in group rounded-xl border border-moss-100 bg-paper/60 px-3 py-2 text-[12px] text-moss-800/80">
      <summary className="flex cursor-pointer select-none items-center gap-2 text-moss-700/80 hover:text-bark-900">
        <Search className="h-3.5 w-3.5" strokeWidth={2} />
        {L[lang].looked}
      </summary>
      <ul className="mt-2 space-y-1 pl-1">
        {lines.map((l, i) => (
          <li key={i} className="flex gap-2 leading-snug">
            <Check className="mt-0.5 h-3 w-3 shrink-0 text-moss-500" strokeWidth={2.5} />
            <span>{l}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function QualifyCard({ lang, r }: { lang: Lang; r: QualifyResult }) {
  return <TraceChip lang={lang} lines={[`${r.inArea ? "✓" : "✕"} ${r.reasons[0] ?? ""}`, ...r.reasons.slice(1), `score ${r.score} · risk ${r.risk}`].filter(Boolean)} />;
}

// ── tier options (recommend_tier) ───────────────────────────────────────────────
export function TierOptionsCard({
  lang,
  r,
  onChoose,
}: {
  lang: Lang;
  r: RecommendTierResult;
  onChoose: (tier: Tier) => void;
}) {
  const t = L[lang];
  return (
    <div className="rise-in grid grid-cols-1 gap-2.5 sm:grid-cols-3">
      {r.options.map((o) => {
        const isRec = o.tier === r.tier;
        const includes = PRICE_BOOK[o.tier].includes.slice(0, 3);
        return (
          <div
            key={o.tier}
            className={[
              "relative flex flex-col rounded-2xl border bg-white p-4 shadow-petal transition-all",
              isRec ? "border-moss-400 ring-2 ring-moss-200/50" : "border-moss-100",
            ].join(" ")}
          >
            {isRec && (
              <span className="absolute -top-2 right-3 inline-flex items-center gap-1 rounded-full bg-moss-700 px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.14em] text-moss-50 shadow-petal">
                <Sparkles className="h-2.5 w-2.5" strokeWidth={2} />
                {t.recommended}
              </span>
            )}
            <div className="font-display text-[17px] leading-tight text-bark-900">{o.name}</div>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="text-[9px] uppercase tracking-[0.14em] text-moss-700/60">{t.starting}</span>
              <span className="font-display text-2xl font-medium text-bark-900">${o.perVisit}</span>
              <span className="text-[11px] text-moss-700/60">{t.perVisit}</span>
            </div>
            <ul className="mt-2 flex-1 space-y-1">
              {includes.map((inc) => (
                <li key={inc} className="flex gap-1.5 text-[11.5px] leading-snug text-moss-800/85">
                  <Check className="mt-0.5 h-3 w-3 shrink-0 text-moss-500" strokeWidth={2.5} />
                  <span>{inc}</span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => onChoose(o.tier)}
              className={[
                "mt-3 inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-2 text-[12.5px] font-medium shadow-petal transition",
                isRec
                  ? "bg-moss-700 text-moss-50 hover:bg-moss-800"
                  : "border border-moss-200 bg-paper text-moss-800 hover:bg-moss-50",
              ].join(" ")}
            >
              {t.choose}
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ── quote (compute_pricing) ─────────────────────────────────────────────────────
export function QuoteCard({ lang, p }: { lang: Lang; p: PricingResult }) {
  const t = L[lang];
  return (
    <Shell>
      <div className="flex items-baseline justify-between gap-3 border-b border-moss-100 bg-paper/40 px-4 py-3">
        <div className="font-display text-[17px] text-bark-900">
          {PRICE_BOOK[p.tier].name}
          <span className="ml-2 text-[12px] font-sans capitalize text-moss-700/70">{p.frequency}</span>
        </div>
        <div className="text-right">
          <div className="font-display text-2xl font-medium text-bark-900">{money(p.firstChargeTotal)}</div>
          <div className="text-[10px] uppercase tracking-[0.12em] text-moss-700/60">{t.firstCharge}</div>
        </div>
      </div>
      <div className="space-y-1.5 px-4 py-3 text-[12.5px]">
        <Row label={`${PRICE_BOOK[p.tier].name} · ${p.frequency}`} value={`${money(p.monthlyRecurring)} ${t.monthly.toLowerCase()}`} />
        {p.fixedAddOnLineItems.map((li) => (
          <Row key={li.addOnId} label={li.name} value={money(li.amount)} muted />
        ))}
        {p.openEndedFlagged.length > 0 && (
          <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/70 px-2.5 py-2 text-[11.5px] text-amber-900">
            <div className="font-medium">{t.addOns}: {t.needsQuote}</div>
            <ul className="mt-1 list-inside list-disc marker:text-amber-400">
              {p.openEndedFlagged.map((o) => (
                <li key={o.addOnId}>{o.name}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="border-t border-moss-100 px-4 py-2 text-[10.5px] italic text-moss-700/55">{t.onSite}</div>
    </Shell>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={muted ? "text-moss-700/70" : "text-bark-900"}>{label}</span>
      <span className={muted ? "text-moss-700/70" : "font-medium text-bark-900"}>{value}</span>
    </div>
  );
}

// ── checkout (propose_checkout) ─────────────────────────────────────────────────
export function CheckoutCard({ lang, r }: { lang: Lang; r: ProposeCheckoutResult }) {
  const t = L[lang];
  if (r.status === "missing_address" || r.status === "missing_photos" || r.status === "error") {
    return null; // the model surfaces these as conversational text
  }
  const amount = typeof r.amount === "number" ? money(r.amount) : "";
  return (
    <Shell>
      <div className="flex items-center gap-3 border-b border-moss-100 bg-paper/40 px-4 py-3">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-moss-100 text-moss-700">
          <CreditCard className="h-4 w-4" strokeWidth={2} />
        </span>
        <div>
          <div className="font-display text-[17px] text-bark-900">{amount}</div>
          <div className="text-[10px] uppercase tracking-[0.12em] text-moss-700/60">{t.firstCharge}</div>
        </div>
      </div>
      <div className="px-4 py-3">
        {r.status === "ready" && r.url ? (
          <a
            href={r.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-moss-700 px-4 py-2.5 text-[13px] font-medium text-moss-50 shadow-petal transition hover:bg-moss-800"
          >
            <CreditCard className="h-4 w-4" strokeWidth={2} />
            {t.pay} · {amount}
          </a>
        ) : (
          <div className="rounded-xl border border-dashed border-moss-200 bg-paper/50 px-3 py-2.5 text-[12px] text-moss-700/80">
            {t.devNoStripe}
          </div>
        )}
      </div>
    </Shell>
  );
}

// ── slots (offer_slots) ─────────────────────────────────────────────────────────
export function SlotPickerCard({
  lang,
  slots,
  onPick,
}: {
  lang: Lang;
  slots: SlotOffer[];
  onPick: (slot: SlotOffer) => void;
}) {
  const t = L[lang];
  const byDate = new Map<string, SlotOffer[]>();
  for (const s of slots.slice(0, 16)) {
    const arr = byDate.get(s.date) ?? [];
    arr.push(s);
    byDate.set(s.date, arr);
  }
  const fmtDate = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Intl.DateTimeFormat(lang === "es" ? "es-MX" : "en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(new Date(y!, m! - 1, d!));
  };
  const fmtTime = (iso: string) =>
    new Intl.DateTimeFormat(lang === "es" ? "es-MX" : "en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/Los_Angeles",
    }).format(new Date(iso));
  return (
    <Shell>
      <div className="border-b border-moss-100 bg-paper/40 px-4 py-2.5 font-display text-[15px] text-bark-900">
        {t.pickSlot}
      </div>
      <div className="max-h-72 space-y-3 overflow-y-auto px-4 py-3">
        {Array.from(byDate.entries()).map(([date, daySlots]) => (
          <div key={date}>
            <div className="mb-1.5 text-[10px] uppercase tracking-[0.14em] text-moss-700/70">{fmtDate(date)}</div>
            <div className="grid grid-cols-2 gap-2">
              {daySlots.map((s) => (
                <button
                  key={s.slotId}
                  type="button"
                  onClick={() => onPick(s)}
                  className="rounded-xl border border-moss-100 bg-white px-3 py-2 text-left shadow-petal transition hover:border-moss-300"
                >
                  <div className="text-[12.5px] font-medium text-bark-900">
                    {fmtTime(s.startTime)} – {fmtTime(s.endTime)}
                  </div>
                  <div className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-moss-700/60">
                    <Users className="h-2.5 w-2.5" strokeWidth={2} />
                    {t.crew(s.crewSize)}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Shell>
  );
}

// ── booking confirmed (confirm_booking) ─────────────────────────────────────────
export function ConfirmationCard({ lang, r }: { lang: Lang; r: ConfirmBookingResult }) {
  const t = L[lang];
  if (r.status !== "booked" || !r.slot) return null;
  return (
    <Shell>
      <div className="flex items-start gap-3 px-4 py-4">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-moss-100 text-moss-700">
          <CircleCheck className="h-5 w-5" strokeWidth={2} />
        </span>
        <div>
          <div className="font-display text-[18px] text-bark-900">{t.booked}</div>
          <div className="mt-0.5 text-[12.5px] text-moss-800/80">{t.bookedSub}</div>
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-paper px-3 py-1 text-[12px] text-moss-800">
            <CalendarCheck className="h-3.5 w-3.5" strokeWidth={2} />
            {r.slot.date} · {new Intl.DateTimeFormat(lang === "es" ? "es-MX" : "en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" }).format(new Date(r.slot.startTime))}
          </div>
        </div>
      </div>
    </Shell>
  );
}

// ── escalation (raise_escalation) ───────────────────────────────────────────────
export function EscalationCard({ lang, r }: { lang: Lang; r: RaiseEscalationResult }) {
  const t = L[lang];
  return (
    <Shell>
      <div className="flex items-start gap-3 px-4 py-4">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <ShieldAlert className="h-5 w-5" strokeWidth={2} />
        </span>
        <div>
          <div className="font-display text-[17px] text-bark-900">{t.handoff}</div>
          <div className="mt-0.5 text-[12.5px] text-moss-800/80">{t.handoffSub}</div>
        </div>
      </div>
    </Shell>
  );
}
