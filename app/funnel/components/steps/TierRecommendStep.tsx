"use client";

import { useMemo } from "react";
import { ArrowLeft, ArrowRight, AlertCircle, Sparkles } from "lucide-react";
import type { Dict } from "@/lib/i18n/en";
import {
  CLEANUP_GATING_ADDON_ID,
  PRICE_BOOK,
  type Tier,
  type VisionAssessment,
} from "@/src/contract";
import { TierCard } from "../TierCard";
import { AddOnGrid } from "../AddOnGrid";

export function TierRecommendStep({
  assessment,
  confirmedTier,
  selectedFixed,
  selectedOpenEnded,
  onTierChange,
  onToggleFixed,
  onToggleOpenEnded,
  onBack,
  onNext,
  t,
}: {
  assessment: VisionAssessment;
  confirmedTier?: Tier;
  selectedFixed: string[];
  selectedOpenEnded: string[];
  onTierChange: (tier: Tier) => void;
  onToggleFixed: (id: string) => void;
  onToggleOpenEnded: (id: string) => void;
  onBack: () => void;
  onNext: () => void;
  t: Dict;
}) {
  const tt = t.funnel.tier;
  const activeTier = confirmedTier ?? assessment.recommended_tier;
  const forceCleanup =
    assessment.cleanup_required && assessment.cleanup_confidence === "high";
  const recommendCleanup =
    assessment.cleanup_required && assessment.cleanup_confidence === "low";

  // Pretty conf %
  const confPct = useMemo(
    () => Math.round(assessment.confidence * 100),
    [assessment.confidence],
  );

  const tiers: Tier[] = ["essential", "signature", "estate"];

  return (
    <div className="space-y-8 max-w-[920px]">
      <header className="space-y-3">
        <h2 className="font-display text-3xl text-bark-900">{tt.title}</h2>
        <p className="text-[14.5px] text-moss-800/85 leading-relaxed">{tt.subtitle}</p>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Stat
            label={tt.assessment.size}
            value={assessment.slope_signals.steepness_hint}
          />
          <Stat
            label={tt.assessment.condition}
            value={`${assessment.condition_score}${tt.assessment.of10}`}
          />
          <Stat
            label={tt.assessment.confidence}
            value={`${confPct}%`}
            tone={confPct >= 60 ? "default" : "warn"}
          />
        </div>
      </header>

      {forceCleanup && (
        <CleanupCallout
          title={tt.cleanupGate.requiredTitle}
          body={tt.cleanupGate.requiredBody}
          tone="required"
        />
      )}
      {recommendCleanup && !forceCleanup && (
        <CleanupCallout
          title={tt.cleanupGate.recommendedTitle}
          body={tt.cleanupGate.recommendedBody}
          tone="recommended"
          dismissLabel={tt.cleanupGate.dismiss}
          includeLabel={tt.cleanupGate.include}
          included={selectedFixed.includes(CLEANUP_GATING_ADDON_ID)}
          onInclude={() => onToggleFixed(CLEANUP_GATING_ADDON_ID)}
        />
      )}

      <section>
        <h3 className="sr-only">{PRICE_BOOK[activeTier].name}</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {tiers.map((tier) => (
            <TierCard
              key={tier}
              tier={tier}
              recommended={tier === assessment.recommended_tier}
              selected={tier === activeTier}
              onSelect={onTierChange}
              t={t}
            />
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-moss-100 bg-white p-5 sm:p-6 shadow-petal space-y-4">
        <AddOnGrid
          selectedFixed={selectedFixed}
          selectedOpenEnded={selectedOpenEnded}
          detectedIds={assessment.detected_extras}
          forceCleanup={forceCleanup}
          onToggleFixed={onToggleFixed}
          onToggleOpenEnded={onToggleOpenEnded}
          t={t}
        />
      </section>

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
          className="inline-flex items-center gap-2 rounded-full bg-moss-700 text-moss-50 px-6 py-3 text-[14px] font-medium shadow-petal hover:bg-moss-800 transition"
        >
          {tt.cta}
          <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "warn";
}) {
  return (
    <div
      className={[
        "inline-flex items-center gap-2 rounded-full border bg-white px-3 py-1 shadow-petal",
        tone === "warn" ? "border-amber-200" : "border-moss-100",
      ].join(" ")}
    >
      <span className="text-[10px] uppercase tracking-[0.14em] text-moss-700/65 font-medium">
        {label}
      </span>
      <span className="text-[12px] font-medium text-bark-900 capitalize">{value}</span>
    </div>
  );
}

function CleanupCallout({
  title,
  body,
  tone,
  dismissLabel,
  includeLabel,
  included,
  onInclude,
}: {
  title: string;
  body: string;
  tone: "required" | "recommended";
  dismissLabel?: string;
  includeLabel?: string;
  included?: boolean;
  onInclude?: () => void;
}) {
  const required = tone === "required";
  return (
    <div
      className={[
        "rounded-3xl border p-5 flex gap-3",
        required
          ? "border-amber-300 bg-amber-50/80"
          : "border-moss-200 bg-moss-50/80",
      ].join(" ")}
    >
      <div
        className={[
          "h-9 w-9 rounded-2xl flex items-center justify-center shrink-0",
          required ? "bg-amber-200/70 text-amber-900" : "bg-moss-200/80 text-moss-900",
        ].join(" ")}
      >
        {required ? (
          <AlertCircle className="h-5 w-5" strokeWidth={2} />
        ) : (
          <Sparkles className="h-5 w-5" strokeWidth={2} />
        )}
      </div>
      <div className="flex-1 min-w-0 space-y-2">
        <h3
          className={[
            "font-display text-lg",
            required ? "text-amber-900" : "text-moss-900",
          ].join(" ")}
        >
          {title}
        </h3>
        <p
          className={[
            "text-[13px] leading-relaxed",
            required ? "text-amber-900/85" : "text-moss-900/85",
          ].join(" ")}
        >
          {body}
        </p>
        {!required && onInclude && (
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onInclude}
              className={[
                "rounded-full px-4 py-1.5 text-[12px] font-medium transition shadow-petal",
                included
                  ? "bg-moss-700 text-moss-50"
                  : "bg-white text-moss-800 border border-moss-200 hover:bg-moss-50",
              ].join(" ")}
            >
              {included ? includeLabel : includeLabel}
            </button>
            {!included && dismissLabel && (
              <button
                type="button"
                className="rounded-full px-3 py-1.5 text-[12px] text-moss-700/70 hover:text-bark-900"
              >
                {dismissLabel}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
