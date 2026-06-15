"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, ShieldCheck } from "lucide-react";
import type { Dict } from "@/lib/i18n/en";
import type { Frequency, PricingResult, Tier } from "@/src/contract";
import { PRICE_BOOK } from "@/src/contract";

export function QuoteStep({
  tier,
  frequency,
  selectedFixed,
  selectedOpenEnded,
  onFrequencyChange,
  onPricing,
  onBack,
  onNext,
  t,
}: {
  tier: Tier;
  frequency: Frequency;
  selectedFixed: string[];
  selectedOpenEnded: string[];
  onFrequencyChange: (f: Frequency) => void;
  onPricing: (p: PricingResult) => void;
  onBack: () => void;
  onNext: () => void;
  t: Dict;
}) {
  const tt = t.funnel.quote;
  const [pricing, setPricing] = useState<PricingResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPricing = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/funnel/pricing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tier,
          frequency,
          addOnIds: [...selectedFixed, ...selectedOpenEnded],
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as PricingResult;
      setPricing(data);
      onPricing(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.common.error);
    } finally {
      setLoading(false);
    }
  }, [tier, frequency, selectedFixed, selectedOpenEnded, onPricing, t.common.error]);

  useEffect(() => {
    void fetchPricing();
  }, [fetchPricing]);

  const freqs: Frequency[] = ["weekly", "biweekly", "monthly"];

  return (
    <div className="space-y-7 max-w-[760px]">
      <header className="space-y-2">
        <h2 className="font-display text-3xl text-bark-900">{tt.title}</h2>
        <p className="text-[14.5px] text-moss-800/85 leading-relaxed">{tt.subtitle}</p>
      </header>

      {/* Frequency selector */}
      <section className="space-y-3">
        <h3 className="text-[12px] uppercase tracking-[0.16em] text-moss-700 font-medium">
          {tt.frequencyLabel}
        </h3>
        <div className="grid grid-cols-3 gap-2">
          {freqs.map((f) => {
            const active = f === frequency;
            return (
              <button
                key={f}
                type="button"
                onClick={() => onFrequencyChange(f)}
                aria-pressed={active}
                className={[
                  "rounded-2xl border px-3 py-3 text-[13px] font-medium transition shadow-petal",
                  active
                    ? "bg-moss-700 text-moss-50 border-moss-700"
                    : "bg-white text-bark-900 border-moss-100 hover:border-moss-300",
                ].join(" ")}
              >
                {tt.frequency[f]}
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-3xl border border-moss-100 bg-white shadow-petal-lg overflow-hidden">
        <div className="px-5 sm:px-6 py-5 space-y-4 bg-paper/40">
          <Row label={tt.baseLabel} value={PRICE_BOOK[tier].name} muted />
          <Row
            label={tt.perVisitLabel}
            value={`$${PRICE_BOOK[tier].perVisit.toFixed(0)}`}
          />
          <Row
            label={tt.monthlyRecurringLabel}
            value={
              loading || !pricing
                ? "—"
                : `$${pricing.monthlyRecurring.toFixed(2)}`
            }
            strong
          />
        </div>

        {pricing && pricing.fixedAddOnLineItems.length > 0 && (
          <div className="px-5 sm:px-6 py-5 border-t border-moss-100 space-y-2">
            <h4 className="text-[11px] uppercase tracking-[0.16em] text-moss-700 font-medium">
              {tt.addOnsLabel}
            </h4>
            <ul className="space-y-1.5">
              {pricing.fixedAddOnLineItems.map((li) => (
                <li
                  key={li.addOnId}
                  className="flex items-baseline justify-between gap-3 text-[13.5px]"
                >
                  <span className="text-bark-900">
                    {li.name}
                    <span className="ml-1.5 text-[11px] text-moss-700/60">
                      · {li.unit}
                    </span>
                  </span>
                  <span className="font-medium text-bark-900">
                    ${li.amount.toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {pricing && pricing.openEndedFlagged.length > 0 && (
          <div className="px-5 sm:px-6 py-5 border-t border-dashed border-amber-300/70 bg-amber-50/40 space-y-2">
            <h4 className="text-[11px] uppercase tracking-[0.16em] text-amber-900 font-medium">
              {tt.humanQuoteLabel}
            </h4>
            <ul className="space-y-1.5">
              {pricing.openEndedFlagged.map((li) => (
                <li
                  key={li.addOnId}
                  className="flex items-baseline justify-between gap-3 text-[13px] text-amber-900/85"
                >
                  <span>{li.name}</span>
                  <span className="italic text-[11.5px]">{li.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="px-5 sm:px-6 py-5 border-t border-moss-100 bg-white space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[11px] uppercase tracking-[0.16em] text-moss-700 font-medium">
              {tt.dueToday}
            </span>
            <span className="font-display text-3xl text-bark-900 font-medium">
              {loading || !pricing
                ? "—"
                : `$${pricing.firstChargeTotal.toFixed(2)}`}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3 text-[12px] text-moss-700/75">
            <span>{tt.renewsMonthly}</span>
            <span className="font-medium">
              {loading || !pricing
                ? "—"
                : `$${pricing.recurringMonthly.toFixed(2)} / mo`}
            </span>
          </div>
          <p className="text-[10.5px] text-moss-700/65 italic">{tt.onSiteCaveat}</p>
        </div>

        {pricing && pricing.assumptions.length > 0 && (
          <div className="px-5 sm:px-6 py-4 border-t border-moss-100 bg-paper/40 space-y-1.5">
            <h4 className="text-[10px] uppercase tracking-[0.16em] text-moss-700/70 font-medium">
              {tt.assumptions}
            </h4>
            <ul className="space-y-1 text-[11.5px] text-moss-700/75">
              {pricing.assumptions.map((a) => (
                <li key={a} className="leading-snug">
                  · {a}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <div className="rounded-2xl border border-moss-100 bg-moss-50/60 p-4 flex gap-3">
        <ShieldCheck
          className="h-5 w-5 text-moss-700 mt-0.5 shrink-0"
          strokeWidth={1.8}
        />
        <p className="text-[12.5px] text-moss-900/85 leading-relaxed">{tt.guarantee}</p>
      </div>

      {error && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 pt-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] text-moss-700 hover:text-bark-900 hover:bg-moss-50 transition"
        >
          <ArrowLeft className="h-4 w-4" />
          {t.common.back}
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!pricing || loading}
          className="inline-flex items-center gap-2 rounded-full bg-moss-700 text-moss-50 px-6 py-3 text-[14px] font-medium shadow-petal hover:bg-moss-800 disabled:bg-moss-200 disabled:text-moss-500 transition"
        >
          {tt.cta}
          <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  muted,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span
        className={[
          "text-[12px] uppercase tracking-[0.14em] font-medium",
          muted ? "text-moss-700/55" : "text-moss-700",
        ].join(" ")}
      >
        {label}
      </span>
      <span
        className={[
          strong ? "font-display text-xl text-bark-900" : "text-[14px] text-bark-900",
          "font-medium",
        ].join(" ")}
      >
        {value}
      </span>
    </div>
  );
}
