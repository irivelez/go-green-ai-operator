"use client";

import { useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import type { Dict } from "@/lib/i18n/en";

export function IntentStep({
  initial,
  onNext,
  t,
}: {
  initial?: string;
  onNext: (intent: string) => void;
  t: Dict;
}) {
  const [value, setValue] = useState(initial ?? "");
  const tt = t.funnel.intent;
  const canContinue = value.trim().length >= 6;

  return (
    <div className="space-y-7 max-w-[680px]">
      <header className="space-y-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-moss-100 border border-moss-200 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-moss-800 font-medium">
          <Sparkles className="h-3 w-3" strokeWidth={2.5} />
          {t.funnel.header.title}
        </span>
        <h2 className="font-display text-3xl sm:text-4xl text-bark-900 leading-tight">
          {tt.title}
        </h2>
        <p className="text-[15px] sm:text-base text-moss-800/85 leading-relaxed">
          {tt.prompt}
        </p>
      </header>

      <div className="space-y-2">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={tt.placeholder}
          rows={4}
          className="w-full rounded-3xl bg-white border border-moss-100 px-5 py-4 text-[15px] text-bark-900 placeholder:text-moss-700/40 focus:outline-none focus:border-moss-400 focus:ring-2 focus:ring-moss-200/40 shadow-petal leading-relaxed resize-none"
          aria-label={tt.title}
        />
        <p className="text-[11.5px] text-moss-700/65 italic">{tt.reassurance}</p>
      </div>

      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={() => onNext(value.trim())}
          disabled={!canContinue}
          className="inline-flex items-center gap-2 rounded-full bg-moss-700 text-moss-50 px-6 py-3 text-[14px] font-medium shadow-petal hover:bg-moss-800 disabled:bg-moss-200 disabled:text-moss-500 transition"
        >
          {tt.cta}
          <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
