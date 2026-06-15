"use client";

import { useCallback, useEffect, useState } from "react";
import { Header } from "./components/Header";
import { KpiRow } from "./components/KpiRow";
import { PipelineBoard } from "./components/PipelineBoard";
import { ReviewInbox } from "./components/ReviewInbox";
import { OperatorConsole } from "./components/OperatorConsole";
import type { Lead, Kpis, LeadsResponse } from "./components/types";

export default function Page() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/leads", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as LeadsResponse;
      setLeads(Array.isArray(data.leads) ? data.leads : []);
      setKpis(data.kpis ?? null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch /api/leads");
    } finally {
      setHasLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onReview = useCallback(
    async (leadId: string, action: "approve" | "reject") => {
      try {
        const res = await fetch(`/api/leads/${encodeURIComponent(leadId)}/${action}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : `Failed to ${action} lead`);
      } finally {
        await refresh();
      }
    },
    [refresh],
  );

  return (
    <main className="min-h-screen">
      <Header live={hasLoaded && !error} error={error} />

      <div className="mx-auto max-w-[1480px] px-4 sm:px-6 lg:px-10 pb-20">
        {/* KPI row */}
        <section className="mt-6 sm:mt-8 rise-in">
          <KpiRow kpis={kpis} />
        </section>

        {/* Two-column grid: pipeline + right rail */}
        <div className="mt-8 sm:mt-10 grid gap-6 lg:gap-8 grid-cols-1 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,1fr)]">
          {/* Left: Pipeline */}
          <div className="rise-in" style={{ animationDelay: "120ms" }}>
            {!hasLoaded ? (
              <LoadingBoard />
            ) : leads.length === 0 ? (
              <EmptyBoard error={error} />
            ) : (
              <PipelineBoard leads={leads} />
            )}
          </div>

          {/* Right rail: Console + Review */}
          <div className="space-y-6 rise-in" style={{ animationDelay: "200ms" }}>
            <OperatorConsole onAfterSend={refresh} />
            <ReviewInbox leads={leads} onAction={onReview} />
          </div>
        </div>

        <footer className="mt-16 pt-8 border-t border-moss-100">
          <div className="flex items-center justify-between gap-4 flex-wrap text-[11px] text-moss-700/55">
            <span>
              Go Green Landscape ·{" "}
              <span className="font-display italic text-moss-700/70">premium maintenance, SF Bay</span>
            </span>
            <span className="font-mono">
              Deltanova autonomous-ops · America/Los_Angeles
            </span>
          </div>
        </footer>
      </div>
    </main>
  );
}

function LoadingBoard() {
  return (
    <div className="space-y-4">
      <div className="h-10 w-48 rounded-lg shimmer bg-white/60 border border-moss-100" />
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="w-[280px] h-[420px] shrink-0 rounded-2xl border border-moss-100 bg-white/60 shimmer"
          />
        ))}
      </div>
    </div>
  );
}

function EmptyBoard({ error }: { error: string | null }) {
  return (
    <div className="rounded-2xl border border-dashed border-moss-200 bg-white/60 px-6 py-16 text-center">
      <h2 className="font-display text-xl text-bark-900">
        {error ? "Couldn't reach the operator API" : "No leads yet"}
      </h2>
      <p className="mt-2 text-sm text-moss-700/70 max-w-[44ch] mx-auto leading-relaxed">
        {error
          ? `${error}. Confirm the dev server is running and try sending a message in the console.`
          : "Send a message from the Operator Console to seed the pipeline."}
      </p>
    </div>
  );
}
