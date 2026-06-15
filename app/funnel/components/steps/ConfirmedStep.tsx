"use client";

import { CheckCircle2, Sparkles } from "lucide-react";
import type { Dict } from "@/lib/i18n/en";

export function ConfirmedStep({
  onRestart,
  t,
}: {
  onRestart: () => void;
  t: Dict;
}) {
  const tt = t.funnel.confirmed;
  return (
    <div className="space-y-7 max-w-[640px]">
      <div className="rounded-3xl border border-moss-200 bg-moss-50/60 p-8 sm:p-10 text-center shadow-petal-lg rise-in">
        <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-moss-700 text-moss-50 mb-4 shadow-petal">
          <CheckCircle2 className="h-7 w-7" strokeWidth={1.8} />
        </div>
        <h2 className="font-display text-3xl sm:text-4xl text-bark-900 leading-tight">
          {tt.title}
        </h2>
        <p className="mt-2 text-[15px] text-moss-800/85 leading-relaxed max-w-[44ch] mx-auto">
          {tt.subtitle}
        </p>
      </div>

      <section className="rounded-3xl border border-moss-100 bg-white p-6 shadow-petal space-y-3">
        <h3 className="text-[11px] uppercase tracking-[0.16em] text-moss-700 font-medium flex items-center gap-1.5">
          <Sparkles className="h-3 w-3" strokeWidth={2.5} />
          {tt.whatNext}
        </h3>
        <ol className="space-y-2.5 text-[13.5px] text-bark-900 leading-relaxed">
          <Step n={1}>{tt.step1}</Step>
          <Step n={2}>{tt.step2}</Step>
          <Step n={3}>{tt.step3}</Step>
        </ol>
      </section>

      <div className="flex justify-center">
        <button
          type="button"
          onClick={onRestart}
          className="rounded-full px-5 py-2 text-[13px] text-moss-700 hover:text-bark-900 hover:bg-moss-50 transition"
        >
          {tt.cta}
        </button>
      </div>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-moss-100 text-moss-800 text-[11px] font-medium">
        {n}
      </span>
      <span>{children}</span>
    </li>
  );
}
