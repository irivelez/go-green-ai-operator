"use client";

import { Leaf, Activity } from "lucide-react";

export function Header({ live, error }: { live: boolean; error?: string | null }) {
  return (
    <header className="bg-moss-mesh border-b border-moss-100">
      <div className="mx-auto max-w-[1480px] px-6 py-10 sm:px-10 sm:py-14">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="flex items-start gap-4 rise-in">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-petal border border-moss-100">
              <Leaf className="h-6 w-6 text-moss-600" strokeWidth={1.6} />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2.5">
                <span className="text-[11px] uppercase tracking-[0.18em] text-moss-600 font-medium">
                  Go Green Landscape
                </span>
                <span className="h-1 w-1 rounded-full bg-moss-300" />
                <span className="text-[11px] uppercase tracking-[0.18em] text-moss-500">Deltanova build</span>
              </div>
              <h1 className="font-display text-3xl sm:text-4xl font-medium text-bark-900 leading-tight">
                Go Green <span className="italic text-moss-700">AI Operator</span>
              </h1>
              <p className="text-sm sm:text-base text-moss-800/80 max-w-2xl leading-relaxed">
                Autonomous intake → qualify → price → book,
                <span className="text-moss-700"> with human-in-the-loop</span> when it matters.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 rise-in" style={{ animationDelay: "120ms" }}>
            {error ? (
              <StatusBadge tone="warn" label="API offline" detail={error} />
            ) : live ? (
              <StatusBadge tone="live" label="Agent online" detail="Listening on Telegram" />
            ) : (
              <StatusBadge tone="idle" label="Booting…" />
            )}
          </div>
        </div>
      </div>
      <div className="hairline" />
    </header>
  );
}

function StatusBadge({ tone, label, detail }: { tone: "live" | "idle" | "warn"; label: string; detail?: string }) {
  const ring =
    tone === "live"
      ? "border-moss-200 bg-white/80 text-moss-800"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50/90 text-amber-900"
        : "border-stone-200 bg-white/80 text-stone-700";
  const dot = tone === "live" ? "bg-moss-500 dot-live" : tone === "warn" ? "bg-amber-500" : "bg-stone-400";
  return (
    <div
      className={`inline-flex items-center gap-2.5 rounded-full border px-3.5 py-2 shadow-petal backdrop-blur-sm ${ring}`}
    >
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      <Activity className="h-3.5 w-3.5 opacity-70" strokeWidth={2} />
      <div className="flex flex-col leading-tight">
        <span className="text-[12px] font-semibold tracking-tight">{label}</span>
        {detail && <span className="text-[10px] opacity-70 -mt-0.5">{detail}</span>}
      </div>
    </div>
  );
}
