"use client";

import { Check, Plus, Sparkles, UserRoundCog } from "lucide-react";
import type { Dict } from "@/lib/i18n/en";
import {
  CLEANUP_GATING_ADDON_ID,
  fixedAddOns,
  openEndedAddOnsList,
  type AddOn,
} from "@/src/contract";

function Chip({
  addon,
  selected,
  onToggle,
  detected,
  forced,
  t,
}: {
  addon: AddOn;
  selected: boolean;
  onToggle: (id: string) => void;
  detected: boolean;
  forced: boolean;
  t: Dict;
}) {
  return (
    <button
      type="button"
      onClick={() => !forced && onToggle(addon.id)}
      disabled={forced}
      aria-pressed={selected}
      className={[
        "group relative w-full text-left rounded-2xl border bg-white shadow-petal px-4 py-3 transition-all",
        selected
          ? "border-moss-600 ring-2 ring-moss-300/30"
          : detected
            ? "border-moss-200 hover:border-moss-400"
            : "border-moss-100 hover:border-moss-300",
        forced ? "cursor-not-allowed opacity-90" : "cursor-pointer",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13.5px] font-medium text-bark-900 leading-tight">
              {addon.name}
            </span>
            {detected && !forced && (
              <span className="inline-flex items-center gap-1 rounded-full bg-moss-50 border border-moss-200 px-1.5 py-0.5 text-[9.5px] uppercase tracking-[0.12em] text-moss-700">
                <Sparkles className="h-2.5 w-2.5" strokeWidth={2.5} />
                AI
              </span>
            )}
            {forced && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[9.5px] uppercase tracking-[0.12em] text-amber-800">
                Required
              </span>
            )}
          </div>
          <div className="mt-1 flex items-baseline gap-1 text-[11.5px] text-moss-700/75">
            <span className="text-[10px] uppercase tracking-[0.14em] text-moss-700/55">
              {t.common.starting}
            </span>
            <span className="font-medium text-bark-900">${addon.priceStartingAt}</span>
            <span className="text-moss-700/55">· {addon.unit}</span>
          </div>
        </div>
        <span
          className={[
            "inline-flex items-center justify-center h-7 w-7 rounded-full shrink-0 transition",
            selected
              ? "bg-moss-700 text-moss-50"
              : "bg-paper text-moss-700 border border-moss-200 group-hover:bg-moss-50",
          ].join(" ")}
        >
          {selected ? (
            <Check className="h-3.5 w-3.5" strokeWidth={3} />
          ) : (
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
          )}
        </span>
      </div>
    </button>
  );
}

export function AddOnGrid({
  selectedFixed,
  selectedOpenEnded,
  detectedIds,
  forceCleanup,
  onToggleFixed,
  onToggleOpenEnded,
  t,
}: {
  selectedFixed: string[];
  selectedOpenEnded: string[];
  detectedIds: string[];
  forceCleanup: boolean; // §B2 high-confidence neglected → cleanup forced
  onToggleFixed: (id: string) => void;
  onToggleOpenEnded: (id: string) => void;
  t: Dict;
}) {
  const tt = t.funnel.tier;
  const allFixed = fixedAddOns();
  const detectedSet = new Set(detectedIds);

  // Sort: detected (AI-suggested) first, then by category alpha.
  const sortedFixed = [...allFixed].sort((a, b) => {
    const aDet = detectedSet.has(a.id) ? 0 : 1;
    const bDet = detectedSet.has(b.id) ? 0 : 1;
    if (aDet !== bDet) return aDet - bDet;
    return a.category.localeCompare(b.category) || a.name.localeCompare(b.name);
  });

  // For S0, show the AI-detected fixed ones up front + a "show more" toggle by
  // simply rendering the first 8 (detected pushed to front).
  const visibleFixed = sortedFixed.slice(0, 8);
  const openEnded = openEndedAddOnsList();
  // Highlight detected open-ended too (rare, but possible)
  const sortedOpenEnded = [...openEnded].sort((a, b) => {
    const aDet = detectedSet.has(a.id) ? 0 : 1;
    const bDet = detectedSet.has(b.id) ? 0 : 1;
    return aDet - bDet;
  });
  const visibleOpenEnded = sortedOpenEnded.slice(0, 6);

  return (
    <div className="space-y-7">
      {/* Autonomous fixed-price cart */}
      <section className="space-y-3">
        <header>
          <h4 className="font-display text-lg text-bark-900">{tt.addOns.title}</h4>
          <p className="text-[12.5px] text-moss-700/70 leading-relaxed">
            {tt.addOns.subtitle}
          </p>
        </header>
        {visibleFixed.length === 0 ? (
          <p className="text-[12.5px] text-moss-700/60 italic">{tt.addOns.emptyState}</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {visibleFixed.map((a) => (
              <Chip
                key={a.id}
                addon={a}
                selected={selectedFixed.includes(a.id)}
                onToggle={onToggleFixed}
                detected={detectedSet.has(a.id)}
                forced={forceCleanup && a.id === CLEANUP_GATING_ADDON_ID}
                t={t}
              />
            ))}
          </div>
        )}
      </section>

      {/* Human-quote-only — visually distinct */}
      <section className="space-y-3 rounded-3xl border border-dashed border-amber-300/70 bg-amber-50/30 p-5">
        <header className="flex items-start gap-2">
          <UserRoundCog
            className="h-5 w-5 text-amber-700 mt-0.5 shrink-0"
            strokeWidth={1.6}
          />
          <div>
            <h4 className="font-display text-lg text-bark-900">{tt.humanQuote.title}</h4>
            <p className="text-[12.5px] text-amber-900/80 leading-relaxed">
              {tt.humanQuote.subtitle}
            </p>
            <p className="mt-1.5 inline-flex items-center rounded-full bg-amber-100 border border-amber-200 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-amber-900 font-medium">
              {tt.humanQuote.badge}
            </p>
          </div>
        </header>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {visibleOpenEnded.map((a) => {
            const selected = selectedOpenEnded.includes(a.id);
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => onToggleOpenEnded(a.id)}
                aria-pressed={selected}
                className={[
                  "text-left rounded-2xl border bg-white/80 px-4 py-3 transition shadow-petal",
                  selected
                    ? "border-amber-500 ring-2 ring-amber-200"
                    : "border-amber-200 hover:border-amber-400",
                ].join(" ")}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-medium text-bark-900">
                      {a.name}
                    </div>
                    <div className="mt-1 flex items-baseline gap-1 text-[11.5px] text-amber-900/80">
                      <span className="text-[10px] uppercase tracking-[0.14em]">
                        {t.common.starting}
                      </span>
                      <span className="font-medium text-bark-900">
                        ${a.priceStartingAt}
                      </span>
                      <span>· {a.unit}</span>
                    </div>
                    {a.openEndedReason && (
                      <p className="mt-1 text-[11px] text-amber-900/70 italic leading-snug">
                        {a.openEndedReason}
                      </p>
                    )}
                  </div>
                  <span
                    className={[
                      "inline-flex items-center justify-center h-7 px-2.5 rounded-full text-[10px] uppercase tracking-[0.14em] font-medium shrink-0 transition",
                      selected
                        ? "bg-amber-600 text-amber-50"
                        : "bg-amber-100 text-amber-900 border border-amber-200",
                    ].join(" ")}
                  >
                    {selected ? tt.humanQuote.addedCta : tt.humanQuote.addCta}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
