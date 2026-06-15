"use client";

import type { Dict } from "@/lib/i18n/en";
import { PROGRESS_STEPS, progressIndex, type FunnelStep } from "../state";

type ProgressKey = keyof Dict["progress"];

export function ProgressBar({ step, t }: { step: FunnelStep; t: Dict }) {
  const inFlow = PROGRESS_STEPS.includes(step);
  const idx = progressIndex(step);
  const totalShown = PROGRESS_STEPS.length;

  // Detour surfaces (human_review/waitlist) — show a soft "paused" pill instead.
  if (!inFlow) {
    return (
      <div className="w-full">
        <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-amber-900">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          {step === "human_review" ? "Human review" : "Waitlist"}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Numeric/label crumb (sm+) */}
      <ol className="hidden sm:flex items-center gap-1 mb-2 text-[10px] uppercase tracking-[0.16em] text-moss-700/70">
        {PROGRESS_STEPS.map((s, i) => {
          const active = i <= idx;
          return (
            <li key={s} className="flex items-center gap-1">
              <span
                className={[
                  "font-medium",
                  active ? "text-moss-800" : "text-moss-700/40",
                ].join(" ")}
              >
                {t.progress[s as ProgressKey]}
              </span>
              {i < totalShown - 1 ? (
                <span className="text-moss-300/70">·</span>
              ) : null}
            </li>
          );
        })}
      </ol>

      {/* Segmented progress bar */}
      <div className="flex items-center gap-1.5" aria-hidden="true">
        {PROGRESS_STEPS.map((s, i) => {
          const filled = i <= idx;
          return (
            <span
              key={s}
              className={[
                "h-1 flex-1 rounded-full transition-all",
                filled ? "bg-moss-600" : "bg-moss-100",
              ].join(" ")}
            />
          );
        })}
      </div>

      {/* Step counter for mobile */}
      <div className="sm:hidden mt-2 text-[10px] uppercase tracking-[0.18em] text-moss-700/70">
        <span className="font-medium text-moss-800">{t.progress[step as ProgressKey]}</span>
        <span className="mx-1 text-moss-300">·</span>
        <span>
          {idx + 1} / {totalShown}
        </span>
      </div>
    </div>
  );
}
