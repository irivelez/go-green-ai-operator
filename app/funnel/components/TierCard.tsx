"use client";

import { Check, Sparkles } from "lucide-react";
import type { Dict } from "@/lib/i18n/en";
import { PRICE_BOOK, type Tier } from "@/src/contract";

export function TierCard({
  tier,
  recommended,
  selected,
  onSelect,
  t,
}: {
  tier: Tier;
  recommended: boolean;
  selected: boolean;
  onSelect: (tier: Tier) => void;
  t: Dict;
}) {
  const spec = PRICE_BOOK[tier];
  const tt = t.funnel.tier;

  return (
    <div
      className={[
        "relative flex flex-col rounded-3xl border bg-white shadow-petal overflow-hidden transition-all",
        selected
          ? "border-moss-600 ring-2 ring-moss-300/40 -translate-y-0.5"
          : recommended
            ? "border-moss-300"
            : "border-moss-100",
      ].join(" ")}
    >
      {recommended && (
        <div className="absolute top-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-moss-700 text-moss-50 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] font-medium shadow-petal">
          <Sparkles className="h-3 w-3" strokeWidth={2} />
          {tt.recommendedBadge}
        </div>
      )}

      <div className="p-6 pb-4 space-y-3">
        <div>
          <h3 className="font-display text-2xl text-bark-900 leading-tight">
            {spec.name}
          </h3>
          <p className="mt-1 text-sm text-moss-800/75 leading-relaxed">{spec.blurb}</p>
        </div>

        <div className="flex items-baseline gap-1.5 pt-1">
          <span className="text-[10px] uppercase tracking-[0.16em] text-moss-700/70 font-medium">
            {t.common.starting}
          </span>
          <span className="font-display text-3xl text-bark-900 font-medium">
            ${spec.perVisit}
          </span>
          <span className="text-[12px] text-moss-700/70">{t.common.perVisit}</span>
        </div>
        <p className="text-[10.5px] text-moss-700/60 italic leading-snug">
          {t.common.onSiteCaveat}
        </p>
      </div>

      <div className="border-t border-moss-100/70 px-6 py-4 space-y-3 bg-paper/30 flex-1">
        <div>
          <h4 className="text-[10px] uppercase tracking-[0.16em] text-moss-700/70 font-medium mb-1.5">
            {tt.includes}
          </h4>
          <ul className="space-y-1">
            {spec.includes.slice(0, 6).map((inc) => (
              <li key={inc} className="flex gap-2 text-[12.5px] text-bark-900 leading-snug">
                <Check
                  className="h-3.5 w-3.5 mt-0.5 shrink-0 text-moss-600"
                  strokeWidth={2.5}
                />
                <span>{inc}</span>
              </li>
            ))}
            {spec.includes.length > 6 && (
              <li className="text-[11px] text-moss-700/55 italic pl-5">
                + {spec.includes.length - 6} more
              </li>
            )}
          </ul>
        </div>
        <details className="text-[11px] text-moss-700/70">
          <summary className="cursor-pointer hover:text-moss-800 select-none">
            {tt.notIncluded}
          </summary>
          <ul className="mt-1.5 space-y-0.5 pl-3">
            {spec.notIncluded.map((n) => (
              <li key={n} className="list-disc list-inside marker:text-moss-300">
                {n}
              </li>
            ))}
          </ul>
        </details>
      </div>

      <div className="p-4 border-t border-moss-100/70 bg-white">
        <button
          type="button"
          onClick={() => onSelect(tier)}
          aria-pressed={selected}
          className={[
            "w-full inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium transition shadow-petal",
            selected
              ? "bg-moss-700 text-moss-50 hover:bg-moss-800"
              : "bg-paper text-moss-800 hover:bg-moss-50 border border-moss-200",
          ].join(" ")}
        >
          {selected ? (
            <>
              <Check className="h-4 w-4" strokeWidth={2.5} />
              {tt.selected}
            </>
          ) : (
            tt.selectCta
          )}
        </button>
      </div>
    </div>
  );
}
