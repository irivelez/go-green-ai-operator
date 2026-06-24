"use client";

import { useMemo } from "react";
import { LayoutGrid } from "lucide-react";
import type { Lead, LeadStatus } from "./types";
import { STAGE_ORDER } from "./types";
import { LeadCard } from "./LeadCard";

const COLUMN_TINTS: Record<LeadStatus, string> = {
  "New Lead": "from-sky-50/60",
  "Waiting for Info": "from-stone-50/60",
  "Info Received": "from-violet-50/50",
  "AI Qualified": "from-moss-50/80",
  "Ready to Schedule": "from-moss-100/70",
  Scheduled: "from-emerald-50/70",
  "Work Order Created": "from-emerald-100/60",
  "Needs Human Review": "from-amber-50/70",
  "Not a Fit": "from-stone-50/40",
  "Lost / No Response": "from-stone-50/40",
};

const COLUMN_DOT: Record<LeadStatus, string> = {
  "New Lead": "bg-sky-400",
  "Waiting for Info": "bg-stone-400",
  "Info Received": "bg-violet-400",
  "AI Qualified": "bg-moss-400",
  "Ready to Schedule": "bg-moss-500",
  Scheduled: "bg-emerald-500",
  "Work Order Created": "bg-emerald-600",
  "Needs Human Review": "bg-amber-500",
  "Not a Fit": "bg-stone-400",
  "Lost / No Response": "bg-stone-300",
};

export function PipelineBoard({ leads }: { leads: Lead[] }) {
  const grouped = useMemo(() => {
    const byStage = new Map<LeadStatus, Lead[]>();
    for (const s of STAGE_ORDER) byStage.set(s, []);
    for (const l of leads) {
      const arr = byStage.get(l.status);
      if (arr) arr.push(l);
      else byStage.set(l.status, [l]);
    }
    // Newest first within each column
    for (const arr of byStage.values()) {
      arr.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    }
    return byStage;
  }, [leads]);

  return (
    <section className="space-y-4">
      <SectionHeader title="Pipeline" subtitle="Lead flow by stage — autonomous unless flagged" count={leads.length} />

      <div className="rail -mx-2 overflow-x-auto px-2 pb-3">
        <div className="flex gap-3 min-w-max">
          {STAGE_ORDER.map((stage) => {
            const items = grouped.get(stage) ?? [];
            return <PipelineColumn key={stage} stage={stage} items={items} />;
          })}
        </div>
      </div>
    </section>
  );
}

function PipelineColumn({ stage, items }: { stage: LeadStatus; items: Lead[] }) {
  const tint = COLUMN_TINTS[stage];
  const dot = COLUMN_DOT[stage];
  const isReview = stage === "Needs Human Review";
  const muted = stage === "Not a Fit" || stage === "Lost / No Response";

  return (
    <div
      className={`w-[280px] shrink-0 rounded-2xl border ${
        isReview ? "border-amber-200" : "border-moss-100"
      } bg-gradient-to-b ${tint} to-transparent`}
    >
      <div className="flex items-center justify-between px-3.5 pt-3.5 pb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
          <h3
            className={`text-[12px] font-semibold tracking-tight truncate ${
              muted ? "text-stone-500" : "text-bark-900"
            }`}
            title={stage}
          >
            {stage}
          </h3>
        </div>
        <span
          className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full border px-1.5 text-[10px] font-bold tabular-nums ${
            isReview
              ? "bg-amber-100 text-amber-900 border-amber-300"
              : items.length > 0
                ? "bg-white text-moss-700 border-moss-200"
                : "bg-transparent text-stone-400 border-stone-200"
          }`}
        >
          {items.length}
        </span>
      </div>

      <div className="px-2 pb-2 space-y-2 max-h-[640px] overflow-y-auto rail">
        {items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-moss-200/70 bg-white/40 px-3 py-5 text-center text-[11px] text-moss-700/60">
            empty
          </div>
        ) : (
          items.map((lead) => <LeadCard key={lead.lead_id} lead={lead} compact />)
        )}
      </div>
    </div>
  );
}

function SectionHeader({ title, subtitle, count }: { title: string; subtitle?: string; count?: number }) {
  return (
    <div className="flex items-end justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white border border-moss-100 shadow-petal text-moss-600">
          <LayoutGrid className="h-4 w-4" strokeWidth={1.8} />
        </div>
        <div>
          <h2 className="font-display text-2xl font-medium text-bark-900 leading-tight">{title}</h2>
          {subtitle && <p className="text-[12px] text-moss-700/70 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {count !== undefined && (
        <span className="text-[11px] text-moss-700/60 tabular-nums">
          {count} {count === 1 ? "lead" : "leads"} in flight
        </span>
      )}
    </div>
  );
}
