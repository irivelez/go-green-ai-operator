"use client";

import {
  Sparkles,
  Award,
  CalendarCheck,
  Users,
  AlertTriangle,
  Bot,
  Timer,
  DollarSign,
  type LucideIcon,
} from "lucide-react";
import type { Kpis } from "./types";
import { fmtMoney, fmtSeconds } from "./format";

interface Tile {
  label: string;
  value: string;
  hint?: string;
  Icon: LucideIcon;
  tone: "default" | "good" | "warn" | "highlight";
}

export function KpiRow({ kpis }: { kpis: Kpis | null }) {
  if (!kpis) {
    return (
      <section
        className="grid gap-3 sm:gap-4"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-[112px] rounded-2xl border border-moss-100 bg-white/60 shimmer"
          />
        ))}
      </section>
    );
  }

  const tiles: Tile[] = [
    {
      label: "New today",
      value: String(kpis.newToday),
      hint: "leads since 00:00 PT",
      Icon: Sparkles,
      tone: "default",
    },
    {
      label: "Qualified A-leads",
      value: String(kpis.qualifiedA),
      hint: "premium fit",
      Icon: Award,
      tone: "good",
    },
    {
      label: "Ready to schedule",
      value: String(kpis.readyToSchedule),
      hint: "address + photos in",
      Icon: CalendarCheck,
      tone: "good",
    },
    {
      label: "Active clients",
      value: String(kpis.activeClients),
      hint: "on the books",
      Icon: Users,
      tone: "default",
    },
    {
      label: "Needs review",
      value: String(kpis.needsReview),
      hint: kpis.needsReview > 0 ? "human action required" : "queue clear",
      Icon: AlertTriangle,
      tone: kpis.needsReview > 0 ? "warn" : "default",
    },
    {
      label: "Autonomy rate",
      value: `${Math.round(kpis.autonomyRatePct)}%`,
      hint: "handled w/o human",
      Icon: Bot,
      tone: "highlight",
    },
    {
      label: "Median first reply",
      value: fmtSeconds(kpis.medianFirstResponseSec),
      hint: "from inbound to reply",
      Icon: Timer,
      tone: "default",
    },
    {
      label: "Potential MRR",
      value: fmtMoney(kpis.potentialMonthlyRevenue),
      hint: "from pipeline",
      Icon: DollarSign,
      tone: "highlight",
    },
  ];

  return (
    <section
      className="grid gap-3 sm:gap-4"
      style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}
    >
      {tiles.map((t, i) => (
        <KpiTile key={t.label} tile={t} index={i} />
      ))}
    </section>
  );
}

function KpiTile({ tile, index }: { tile: Tile; index: number }) {
  const tone = tile.tone;
  const iconWrap =
    tone === "good"
      ? "bg-moss-100 text-moss-700 border-moss-200"
      : tone === "warn"
        ? "bg-amber-100 text-amber-800 border-amber-200"
        : tone === "highlight"
          ? "bg-moss-700 text-moss-50 border-moss-800"
          : "bg-moss-50 text-moss-600 border-moss-100";

  const valueColor =
    tone === "warn" ? "text-amber-900" : tone === "highlight" ? "text-moss-900" : "text-bark-900";

  return (
    <div
      className="group relative rise-in rounded-2xl border border-moss-100 bg-white shadow-petal px-4 py-4 sm:px-5 sm:py-5 transition-all duration-300 hover:shadow-petal-lg hover:border-moss-200 hover:-translate-y-0.5"
      style={{ animationDelay: `${80 + index * 40}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1.5 min-w-0">
          <div className="text-[11px] uppercase tracking-[0.14em] text-moss-700/80 font-medium truncate">
            {tile.label}
          </div>
          <div className={`font-display text-3xl sm:text-[2rem] leading-none font-medium ${valueColor}`}>
            {tile.value}
          </div>
          {tile.hint && (
            <div className="text-[11px] text-moss-700/55 mt-1.5">{tile.hint}</div>
          )}
        </div>
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${iconWrap}`}
        >
          <tile.Icon className="h-4 w-4" strokeWidth={1.8} />
        </div>
      </div>
    </div>
  );
}
