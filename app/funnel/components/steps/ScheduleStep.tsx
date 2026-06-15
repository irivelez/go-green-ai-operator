"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Calendar, Users } from "lucide-react";
import type { Dict } from "@/lib/i18n/en";
import type { SlotOffer } from "@/src/contract";

const WINDOW_LABEL_KEYS: ("morning" | "midday" | "afternoon" | "evening")[] = [
  "morning",
  "midday",
  "afternoon",
  "evening",
];

export function ScheduleStep({
  devMock,
  selectedSlotId,
  onBack,
  onSelect,
  onConfirm,
  onNoSlots,
  t,
  lang,
}: {
  devMock?: "low-confidence" | "neglected" | "no-slots" | null;
  selectedSlotId?: string;
  onBack: () => void;
  onSelect: (slotId: string) => void;
  onConfirm: () => void;
  onNoSlots: () => void;
  t: Dict;
  lang: "en" | "es";
}) {
  const tt = t.funnel.schedule;
  const [slots, setSlots] = useState<SlotOffer[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const url =
          devMock === "no-slots"
            ? "/api/funnel/slots?mock=no-slots"
            : "/api/funnel/slots";
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as SlotOffer[];
        if (cancelled) return;
        setSlots(data);
        if (data.length === 0) onNoSlots();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t.common.error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [devMock, onNoSlots, t.common.error]);

  // Group by date.
  const byDate = useMemo(() => {
    const map = new Map<string, SlotOffer[]>();
    for (const s of slots ?? []) {
      const arr = map.get(s.date) ?? [];
      arr.push(s);
      map.set(s.date, arr);
    }
    return Array.from(map.entries()).slice(0, 7);
  }, [slots]);

  function fmtDate(iso: string): string {
    const [y, m, d] = iso.split("-");
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    return new Intl.DateTimeFormat(lang === "es" ? "es-MX" : "en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(date);
  }
  function fmtTime(iso: string): string {
    return new Intl.DateTimeFormat(lang === "es" ? "es-MX" : "en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/Los_Angeles",
    }).format(new Date(iso));
  }

  return (
    <div className="space-y-7 max-w-[820px]">
      <header className="space-y-2">
        <h2 className="font-display text-3xl text-bark-900">{tt.title}</h2>
        <p className="text-[14.5px] text-moss-800/85 leading-relaxed">{tt.subtitle}</p>
      </header>

      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-28 rounded-2xl border border-moss-100 bg-white shimmer"
            />
          ))}
        </div>
      )}

      {!loading && slots && slots.length === 0 && (
        <div className="rounded-3xl border border-amber-200 bg-amber-50 px-5 py-6 text-center">
          <Calendar
            className="h-7 w-7 text-amber-700 mx-auto mb-2"
            strokeWidth={1.6}
          />
          <p className="text-[14px] text-amber-900 font-medium">{tt.noSlots}</p>
        </div>
      )}

      {!loading && slots && slots.length > 0 && (
        <div className="space-y-5">
          {byDate.map(([date, daySlots]) => (
            <section key={date} className="space-y-2">
              <h3 className="text-[12px] uppercase tracking-[0.16em] text-moss-700 font-medium">
                {fmtDate(date)}
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {daySlots.map((s, i) => {
                  const isSelected = selectedSlotId === s.slotId;
                  const labelKey = WINDOW_LABEL_KEYS[i] ?? "midday";
                  return (
                    <button
                      key={s.slotId}
                      type="button"
                      disabled={!s.available}
                      onClick={() => onSelect(s.slotId)}
                      aria-pressed={isSelected}
                      className={[
                        "rounded-2xl border bg-white p-3 text-left transition shadow-petal",
                        isSelected
                          ? "border-moss-600 ring-2 ring-moss-300/40"
                          : "border-moss-100 hover:border-moss-300",
                        !s.available ? "opacity-50 cursor-not-allowed" : "",
                      ].join(" ")}
                    >
                      <div className="text-[10px] uppercase tracking-[0.14em] text-moss-700/70 font-medium">
                        {tt.slotWindows[labelKey]}
                      </div>
                      <div className="mt-1 text-[13px] text-bark-900 font-medium">
                        {fmtTime(s.startTime)} – {fmtTime(s.endTime)}
                      </div>
                      <div className="mt-1 inline-flex items-center gap-1 text-[10.5px] text-moss-700/70">
                        <Users className="h-3 w-3" strokeWidth={2} />
                        {tt.crewSize(s.crewSize)}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
          {error}
        </div>
      )}

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
          onClick={onConfirm}
          disabled={!selectedSlotId}
          className="inline-flex items-center gap-2 rounded-full bg-moss-700 text-moss-50 px-6 py-3 text-[14px] font-medium shadow-petal hover:bg-moss-800 disabled:bg-moss-200 disabled:text-moss-500 transition"
        >
          {tt.cta}
          <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
