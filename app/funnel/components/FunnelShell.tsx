"use client";

import { Leaf } from "lucide-react";
import type { ReactNode } from "react";
import type { Dict } from "@/lib/i18n/en";
import type { FunnelStep, Lang } from "../state";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { ProgressBar } from "./ProgressBar";

export function FunnelShell({
  step,
  lang,
  onLangChange,
  t,
  children,
  chatSlot,
}: {
  step: FunnelStep;
  lang: Lang;
  onLangChange: (l: Lang) => void;
  t: Dict;
  children: ReactNode;
  chatSlot: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-paper">
      <header className="bg-moss-mesh border-b border-moss-100">
        <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-10 py-5 sm:py-7">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-2xl bg-white shadow-petal border border-moss-100 shrink-0">
                <Leaf className="h-5 w-5 text-moss-600" strokeWidth={1.6} />
              </div>
              <div className="leading-tight min-w-0">
                <div className="text-[10px] sm:text-[11px] uppercase tracking-[0.18em] text-moss-700 font-medium truncate">
                  {t.brand.company}
                </div>
                <div className="font-display text-base sm:text-lg text-bark-900 italic truncate">
                  {t.brand.badge}
                </div>
              </div>
            </div>
            <LanguageSwitcher
              lang={lang}
              onChange={onLangChange}
              labels={t.common.lang}
            />
          </div>
          <div className="mt-5 sm:mt-6">
            <ProgressBar step={step} t={t} />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-10 py-6 sm:py-10 pb-24 lg:pb-12">
        <div className="grid gap-6 lg:gap-10 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(340px,400px)]">
          <section className="rise-in min-w-0">{children}</section>
          <div className="rise-in" style={{ animationDelay: "120ms" }}>
            {chatSlot}
          </div>
        </div>

        <footer className="mt-16 pt-8 border-t border-moss-100">
          <div className="flex items-center justify-between gap-4 flex-wrap text-[11px] text-moss-700/55">
            <span>
              {t.brand.company} ·{" "}
              <span className="font-display italic text-moss-700/70">
                {t.brand.badge}
              </span>
            </span>
            <span className="font-mono">Deltanova autonomous-ops · America/Los_Angeles</span>
          </div>
        </footer>
      </div>
    </main>
  );
}
