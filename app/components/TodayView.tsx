"use client";

import { useMemo } from "react";
import {
  ShieldAlert,
  CalendarCheck,
  CalendarClock,
  Inbox,
  AlertTriangle,
  Clock,
  Hourglass,
  MapPin,
  CheckCircle2,
  type LucideIcon,
} from "lucide-react";
import type { Lead } from "./types";
import { fmtLA, fmtLAtime, relTime } from "./format";

const LA_DATE_KEY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function laDateKey(iso: string | undefined | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return LA_DATE_KEY.format(d);
}

function todayKeyLA(): string {
  return LA_DATE_KEY.format(new Date());
}

function waitedMinutes(iso: string | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 60000));
}

function fmtWaited(iso: string | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const sec = Math.max(0, (Date.now() - t) / 1000);
  if (sec < 60) return "< 1 min";
  if (sec < 3600) return `${Math.floor(sec / 60)} min`;
  if (sec < 86400) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec - h * 3600) / 60);
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  }
  const d = Math.floor(sec / 86400);
  return d === 1 ? "1 day" : `${d} days`;
}

function workOrderWindow(lead: Lead): string | null {
  const wo = lead.work_order;
  if (!wo || typeof wo !== "object") return null;
  const w = (wo as Record<string, unknown>).window;
  return typeof w === "string" && w.trim().length > 0 ? w : null;
}

function leadIdentifier(lead: Lead): string {
  return lead.customer_email?.trim() || `Lead ${lead.lead_id}`;
}

export function TodayView({ leads }: { leads: Lead[] }) {
  const { escalations, todayBookings, upcomingVisits } = useMemo(() => {
    const today = todayKeyLA();
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    const esc: Lead[] = [];
    const todays: Lead[] = [];
    const upcoming: Lead[] = [];

    for (const lead of leads) {
      if (lead.status === "ESCALATED") {
        esc.push(lead);
        continue;
      }
      if (lead.status === "BOOKED" && lead.visit_at) {
        const dayKey = laDateKey(lead.visit_at);
        const visitTime = new Date(lead.visit_at).getTime();
        if (dayKey === today) {
          todays.push(lead);
        } else if (
          !Number.isNaN(visitTime) &&
          visitTime > now &&
          visitTime - now <= sevenDaysMs
        ) {
          upcoming.push(lead);
        }
      }
    }

    esc.sort((a, b) => {
      const aT = new Date(a.escalated_at ?? a.created_at).getTime();
      const bT = new Date(b.escalated_at ?? b.created_at).getTime();
      return aT - bT;
    });
    todays.sort((a, b) => {
      const aT = new Date(a.visit_at ?? a.created_at).getTime();
      const bT = new Date(b.visit_at ?? b.created_at).getTime();
      return aT - bT;
    });
    upcoming.sort((a, b) => {
      const aT = new Date(a.visit_at ?? a.created_at).getTime();
      const bT = new Date(b.visit_at ?? b.created_at).getTime();
      return aT - bT;
    });

    return {
      escalations: esc,
      todayBookings: todays,
      upcomingVisits: upcoming,
    };
  }, [leads]);

  const dlqCount = 0;

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="rise-in" style={{ animationDelay: "60ms" }}>
        <EscalationsSection leads={escalations} />
      </div>
      <div className="rise-in" style={{ animationDelay: "140ms" }}>
        <TodayBookingsSection leads={todayBookings} />
      </div>
      <div
        className="grid gap-6 sm:gap-8 grid-cols-1 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] rise-in"
        style={{ animationDelay: "220ms" }}
      >
        <UpcomingVisitsSection leads={upcomingVisits} />
        <RemindersDlqStat count={dlqCount} />
      </div>
    </div>
  );
}

function EscalationsSection({ leads }: { leads: Lead[] }) {
  return (
    <section className="rounded-2xl border border-amber-200/70 bg-white shadow-petal overflow-hidden">
      <SectionHeader
        icon={ShieldAlert}
        tone="warn"
        title="Escalations needing reply"
        subtitle="The agent flagged these — owner takes the call"
        count={leads.length}
      />
      {leads.length === 0 ? (
        <EmptyRow
          icon={CheckCircle2}
          title="Nothing waiting on you."
          hint="Every escalated case has been replied to."
        />
      ) : (
        <ul className="divide-y divide-amber-100/60">
          {leads.map((lead) => (
            <EscalationRow key={lead.lead_id} lead={lead} />
          ))}
        </ul>
      )}
    </section>
  );
}

function EscalationRow({ lead }: { lead: Lead }) {
  const since = lead.escalated_at ?? lead.created_at;
  const waited = waitedMinutes(since);
  const stale =
    lead.escalation_acked === false && waited !== null && waited > 30;
  const identifier = leadIdentifier(lead);
  const showName = lead.name && lead.customer_email;

  return (
    <li className="px-4 sm:px-5 py-3.5 hover:bg-amber-50/30 transition-colors">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-900">
          <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className="text-sm font-semibold text-bark-900 truncate max-w-[24ch]"
              title={identifier}
            >
              {identifier}
            </span>
            {showName && (
              <span className="text-[12px] text-moss-700/70 truncate">
                · {lead.name}
              </span>
            )}
            <span className="font-mono text-[10px] text-moss-700/55">
              {lead.lead_id}
            </span>
            {stale && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-400 bg-amber-200/70 px-1.5 h-5 text-[10px] font-bold uppercase tracking-wider text-amber-900">
                <Hourglass className="h-2.5 w-2.5" strokeWidth={2.4} />
                waiting on you
              </span>
            )}
          </div>
          {lead.escalation_reason && (
            <p className="text-[12px] leading-relaxed text-amber-900">
              <span className="text-[10px] uppercase tracking-wider font-semibold opacity-70">
                Why escalated:
              </span>{" "}
              {lead.escalation_reason}
            </p>
          )}
          <div className="flex items-center gap-1.5 text-[11px] text-moss-700/65">
            <Clock className="h-3 w-3" strokeWidth={2} />
            <span>
              waited {fmtWaited(since)}
              <span className="opacity-60"> · {relTime(since)}</span>
            </span>
          </div>
        </div>
      </div>
    </li>
  );
}

function TodayBookingsSection({ leads }: { leads: Lead[] }) {
  return (
    <section className="rounded-2xl border border-emerald-200/70 bg-white shadow-petal overflow-hidden">
      <SectionHeader
        icon={CalendarCheck}
        tone="good"
        title="Today's paid bookings"
        subtitle="Visits scheduled for today · America/Los_Angeles"
        count={leads.length}
      />
      {leads.length === 0 ? (
        <EmptyRow
          icon={CalendarCheck}
          title="No visits booked for today."
          hint="Crews have a quiet day on the calendar."
        />
      ) : (
        <ul className="divide-y divide-emerald-100/60">
          {leads.map((lead) => (
            <BookingRow key={lead.lead_id} lead={lead} />
          ))}
        </ul>
      )}
    </section>
  );
}

function BookingRow({ lead }: { lead: Lead }) {
  const identifier = leadIdentifier(lead);
  const showName = lead.name && lead.customer_email;
  const window = workOrderWindow(lead);
  const timeLabel = window ?? (lead.visit_at ? fmtLAtime(lead.visit_at) : null);

  return (
    <li className="px-4 sm:px-5 py-3.5 hover:bg-emerald-50/20 transition-colors">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-800">
          <CalendarCheck className="h-3.5 w-3.5" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className="text-sm font-semibold text-bark-900 truncate max-w-[24ch]"
              title={identifier}
            >
              {identifier}
            </span>
            {showName && (
              <span className="text-[12px] text-moss-700/70 truncate">
                · {lead.name}
              </span>
            )}
            <span className="font-mono text-[10px] text-moss-700/55">
              {lead.lead_id}
            </span>
          </div>
          {lead.address && (
            <div className="flex items-start gap-1.5 text-[12px] text-moss-800/85">
              <MapPin
                className="h-3.5 w-3.5 mt-[1px] shrink-0 text-moss-500"
                strokeWidth={1.7}
              />
              <span className="truncate" title={lead.address}>
                {lead.address}
              </span>
            </div>
          )}
          {timeLabel && (
            <div className="flex items-center gap-1.5 text-[12px] font-medium text-emerald-900">
              <Clock className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
              <span>{timeLabel}</span>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function UpcomingVisitsSection({ leads }: { leads: Lead[] }) {
  return (
    <section className="rounded-2xl border border-moss-100 bg-white shadow-petal overflow-hidden">
      <SectionHeader
        icon={CalendarClock}
        tone="default"
        title="Upcoming visits"
        subtitle="Next 7 days · America/Los_Angeles"
        count={leads.length}
      />
      {leads.length === 0 ? (
        <EmptyRow
          icon={CalendarClock}
          title="No visits queued."
          hint="Nothing booked in the next 7 days."
        />
      ) : (
        <ul className="divide-y divide-moss-100/70">
          {leads.map((lead) => (
            <UpcomingRow key={lead.lead_id} lead={lead} />
          ))}
        </ul>
      )}
    </section>
  );
}

function UpcomingRow({ lead }: { lead: Lead }) {
  const identifier = leadIdentifier(lead);
  return (
    <li className="px-4 sm:px-5 py-3 hover:bg-moss-50/40 transition-colors">
      <div className="flex items-start gap-2.5 text-[12px]">
        <CalendarClock
          className="h-3.5 w-3.5 mt-[2px] shrink-0 text-moss-500"
          strokeWidth={1.7}
        />
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="font-semibold text-moss-900 tabular-nums">
            {lead.visit_at ? fmtLA(lead.visit_at) : "—"}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            <span
              className="font-medium text-bark-900 truncate max-w-[22ch]"
              title={identifier}
            >
              {identifier}
            </span>
            <span className="font-mono text-[10px] text-moss-700/55 shrink-0">
              {lead.lead_id}
            </span>
          </div>
          {lead.address && (
            <div
              className="text-[11px] text-moss-700/70 truncate"
              title={lead.address}
            >
              {lead.address}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function RemindersDlqStat({ count }: { count: number }) {
  return (
    <section className="rounded-2xl border border-stone-200 bg-white shadow-petal overflow-hidden flex flex-col">
      <SectionHeader
        icon={Inbox}
        tone="neutral"
        title="Reminders & DLQ"
        subtitle="Dead-letter queue · failed reminders"
      />
      <div className="flex flex-1 items-end justify-between gap-4 px-4 sm:px-5 py-5 sm:py-6">
        <div>
          <div className="font-display text-[2.5rem] leading-none font-medium text-bark-900 tabular-nums">
            {count}
          </div>
          <div className="text-[11px] text-stone-700/70 mt-1.5">
            {count === 0 ? "queue clear" : `${count} stuck`}
          </div>
        </div>
        <div className="text-[10px] uppercase tracking-[0.14em] text-stone-500/80 text-right max-w-[14ch] leading-relaxed">
          Phase B wires the live count
        </div>
      </div>
    </section>
  );
}

function SectionHeader({
  icon: Icon,
  tone,
  title,
  subtitle,
  count,
}: {
  icon: LucideIcon;
  tone: "warn" | "good" | "default" | "neutral";
  title: string;
  subtitle?: string;
  count?: number;
}) {
  const wrap =
    tone === "warn"
      ? "border-amber-100 bg-gradient-to-r from-amber-50 to-amber-50/30"
      : tone === "good"
        ? "border-emerald-100 bg-gradient-to-r from-emerald-50 to-emerald-50/30"
        : tone === "neutral"
          ? "border-stone-100 bg-gradient-to-r from-stone-50 to-transparent"
          : "border-moss-100 bg-gradient-to-r from-moss-50/70 to-transparent";
  const iconBox =
    tone === "warn"
      ? "bg-amber-100 text-amber-800 border-amber-200"
      : tone === "good"
        ? "bg-emerald-100 text-emerald-800 border-emerald-200"
        : tone === "neutral"
          ? "bg-stone-100 text-stone-700 border-stone-200"
          : "bg-moss-50 text-moss-700 border-moss-100";
  const subColor =
    tone === "warn"
      ? "text-amber-900/70"
      : tone === "good"
        ? "text-emerald-900/70"
        : tone === "neutral"
          ? "text-stone-700/70"
          : "text-moss-700/70";

  return (
    <header
      className={`flex items-center justify-between gap-3 border-b ${wrap} px-4 py-3 sm:px-5`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-xl border ${iconBox}`}
        >
          <Icon className="h-4 w-4" strokeWidth={1.8} />
        </div>
        <div className="min-w-0">
          <h2 className="font-display text-lg font-medium text-bark-900 leading-tight truncate">
            {title}
          </h2>
          {subtitle && (
            <p className={`text-[11px] mt-0.5 truncate ${subColor}`}>
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {typeof count === "number" && <CountBadge n={count} tone={tone} />}
    </header>
  );
}

function CountBadge({
  n,
  tone,
}: {
  n: number;
  tone: "warn" | "good" | "default" | "neutral";
}) {
  const cls =
    tone === "warn"
      ? n > 0
        ? "bg-amber-500 text-amber-50 border-amber-600"
        : "bg-moss-50 text-moss-700 border-moss-200"
      : tone === "good"
        ? n > 0
          ? "bg-emerald-600 text-emerald-50 border-emerald-700"
          : "bg-moss-50 text-moss-700 border-moss-200"
        : tone === "neutral"
          ? "bg-stone-100 text-stone-700 border-stone-200"
          : n > 0
            ? "bg-white text-moss-700 border-moss-200"
            : "bg-transparent text-stone-400 border-stone-200";
  return (
    <span
      className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full border px-2 text-[11px] font-bold tabular-nums ${cls}`}
    >
      {n}
    </span>
  );
}

function EmptyRow({
  icon: Icon,
  title,
  hint,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 px-4 text-center">
      <Icon className="h-6 w-6 text-moss-400" strokeWidth={1.6} />
      <p className="text-sm text-moss-700/70 font-medium">{title}</p>
      {hint && (
        <p className="text-[11px] text-moss-700/50 max-w-[36ch] leading-relaxed">
          {hint}
        </p>
      )}
    </div>
  );
}
