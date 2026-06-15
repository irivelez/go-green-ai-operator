"use client";

import { useState } from "react";
import { Leaf } from "lucide-react";
import { GenerativeChat } from "./components/GenerativeChat";
import type { Lang } from "./components/cards";

export default function AgentPage() {
  const [language, setLanguage] = useState<Lang>("en");

  return (
    <main className="flex min-h-screen flex-col bg-moss-mesh">
      <header className="flex items-center justify-between gap-3 px-5 py-4 sm:px-8">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white shadow-petal">
            <Leaf className="h-4.5 w-4.5 text-moss-600" strokeWidth={2} />
          </span>
          <div className="leading-tight">
            <div className="text-[10px] uppercase tracking-[0.18em] text-moss-700/70">Go Green Landscape</div>
            <div className="font-display text-[15px] italic text-bark-900">Premium garden care · San Francisco</div>
          </div>
        </div>
        <div className="inline-flex items-center rounded-full border border-moss-200 bg-white p-0.5 shadow-petal">
          {(["en", "es"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLanguage(l)}
              className={[
                "rounded-full px-3 py-1 text-[12px] font-medium uppercase tracking-wide transition",
                language === l ? "bg-moss-700 text-moss-50" : "text-moss-700 hover:bg-moss-50",
              ].join(" ")}
            >
              {l}
            </button>
          ))}
        </div>
      </header>

      <section className="mx-auto flex w-full max-w-3xl flex-1 px-3 pb-5 sm:px-6">
        <div className="flex w-full flex-col overflow-hidden rounded-3xl border border-moss-100 bg-paper shadow-petal-lg">
          <GenerativeChat key={language} language={language} />
        </div>
      </section>
    </main>
  );
}
