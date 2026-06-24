"use client";

import { useEffect, useMemo, useState } from "react";
import {
  MessagesSquare,
  MessageSquareDashed,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { Lead } from "./types";
import { StageBadge } from "./icons";
import { relTime } from "./format";

const PAGE_SIZE = 50;
const SNIPPET_MAX = 80;

function eventTime(lead: Lead): number {
  const t = new Date(lead.lastEventTs ?? lead.created_at).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function truncate(s: string, max: number): string {
  const clean = s.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1).trimEnd() + "…";
}

function snippetFor(lead: Lead): string | null {
  const notes = lead.internal_notes?.trim();
  if (notes) {
    const lastLine = notes
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .pop();
    if (lastLine) return truncate(lastLine, SNIPPET_MAX);
  }
  const ai = lead.ai_recommendation?.trim();
  if (ai) return truncate(ai, SNIPPET_MAX);
  const esc = lead.escalation_reason?.trim();
  if (esc) return truncate(esc, SNIPPET_MAX);
  return null;
}

function leadIdentifier(lead: Lead): string {
  return lead.customer_email?.trim() || `Lead ${lead.lead_id}`;
}

export function ConversationsView({ leads }: { leads: Lead[] }) {
  const sorted = useMemo(() => {
    const copy = [...leads];
    copy.sort((a, b) => {
      const diff = eventTime(b) - eventTime(a);
      if (diff !== 0) return diff;
      const aC = new Date(a.created_at).getTime();
      const bC = new Date(b.created_at).getTime();
      return (Number.isNaN(bC) ? 0 : bC) - (Number.isNaN(aC) ? 0 : aC);
    });
    return copy;
  }, [leads]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const [page, setPage] = useState(0);

  // Clamp page when leads shrink underneath us.
  useEffect(() => {
    if (page > totalPages - 1) setPage(totalPages - 1);
  }, [page, totalPages]);

  const safePage = Math.min(page, totalPages - 1);
  const pageItems = sorted.slice(
    safePage * PAGE_SIZE,
    (safePage + 1) * PAGE_SIZE,
  );

  const firstIndex = sorted.length === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const lastIndex = Math.min(sorted.length, (safePage + 1) * PAGE_SIZE);

  return (
    <section className="rounded-2xl border border-moss-100 bg-white shadow-petal overflow-hidden">
      <SectionHeader
        title="All conversations"
        subtitle="Every lead the agent has touched · most-recent activity first"
        count={sorted.length}
      />

      {sorted.length === 0 ? (
        <EmptyConversations />
      ) : (
        <>
          <ul className="divide-y divide-moss-100/70">
            {pageItems.map((lead) => (
              <ConversationRow key={lead.lead_id} lead={lead} />
            ))}
          </ul>

          <PaginationBar
            page={safePage}
            totalPages={totalPages}
            firstIndex={firstIndex}
            lastIndex={lastIndex}
            total={sorted.length}
            onPrev={() => setPage((p) => Math.max(0, p - 1))}
            onNext={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
          />
        </>
      )}
    </section>
  );
}

function ConversationRow({ lead }: { lead: Lead }) {
  const identifier = leadIdentifier(lead);
  const snippet = snippetFor(lead);
  const stamp = lead.lastEventTs ?? lead.created_at;

  return (
    <li className="px-4 sm:px-5 py-3.5 hover:bg-moss-50/40 transition-colors">
      <div className="flex items-start gap-3 min-w-0">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-moss-50 border border-moss-100 text-moss-600">
          <MessagesSquare className="h-3.5 w-3.5" strokeWidth={1.7} />
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          {/* Identity row */}
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span
              className="text-sm font-semibold text-bark-900 truncate max-w-[24ch] sm:max-w-[36ch]"
              title={identifier}
            >
              {identifier}
            </span>
            <StageBadge stage={lead.status} size="xs" />
            <span className="font-mono text-[10px] text-moss-700/55 shrink-0">
              {lead.lead_id}
            </span>
            <span className="text-[11px] text-moss-700/55 shrink-0 ml-auto tabular-nums">
              {relTime(stamp)}
            </span>
          </div>

          {/* Snippet row */}
          {snippet ? (
            <p
              className="text-[12px] leading-relaxed text-moss-800/85 break-words"
              title={snippet}
            >
              {snippet}
            </p>
          ) : (
            <p className="text-[12px] text-moss-700/45 italic">—</p>
          )}
        </div>
      </div>
    </li>
  );
}

function PaginationBar({
  page,
  totalPages,
  firstIndex,
  lastIndex,
  total,
  onPrev,
  onNext,
}: {
  page: number;
  totalPages: number;
  firstIndex: number;
  lastIndex: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const atFirst = page <= 0;
  const atLast = page >= totalPages - 1;
  return (
    <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-t border-moss-100/80 bg-moss-50/30 flex-wrap">
      <span className="text-[11px] text-moss-700/70 tabular-nums">
        Showing{" "}
        <span className="font-semibold text-bark-900">
          {firstIndex}–{lastIndex}
        </span>{" "}
        of <span className="font-semibold text-bark-900">{total}</span>
      </span>
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-moss-700/70 tabular-nums mr-1">
          Page <span className="font-semibold text-bark-900">{page + 1}</span>{" "}
          of <span className="font-semibold text-bark-900">{totalPages}</span>
        </span>
        <PagerButton
          label="Previous page"
          icon={ChevronLeft}
          onClick={onPrev}
          disabled={atFirst}
        />
        <PagerButton
          label="Next page"
          icon={ChevronRight}
          onClick={onNext}
          disabled={atLast}
        />
      </div>
    </div>
  );
}

function PagerButton({
  label,
  icon: Icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: typeof ChevronLeft;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-full border transition-all duration-150 ${
        disabled
          ? "border-moss-100 bg-white/40 text-stone-300 cursor-not-allowed"
          : "border-moss-200 bg-white text-moss-700 hover:bg-moss-50 hover:border-moss-300 shadow-petal"
      }`}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
    </button>
  );
}

function EmptyConversations() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 px-6 text-center">
      <MessageSquareDashed
        className="h-6 w-6 text-moss-400"
        strokeWidth={1.6}
      />
      <p className="text-sm text-moss-700/70 font-medium">
        No conversations yet.
      </p>
      <p className="text-[11px] text-moss-700/50 max-w-[44ch] leading-relaxed">
        Send a message from the Operator Console — every lead the agent touches
        shows up here.
      </p>
    </div>
  );
}

function SectionHeader({
  title,
  subtitle,
  count,
}: {
  title: string;
  subtitle?: string;
  count: number;
}) {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-moss-100 bg-gradient-to-r from-moss-50/70 to-transparent px-4 py-3 sm:px-5">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-moss-100 bg-moss-50 text-moss-700">
          <MessagesSquare className="h-4 w-4" strokeWidth={1.8} />
        </div>
        <div className="min-w-0">
          <h2 className="font-display text-lg font-medium text-bark-900 leading-tight truncate">
            {title}
          </h2>
          {subtitle && (
            <p className="text-[11px] mt-0.5 truncate text-moss-700/70">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      <span
        className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full border px-2 text-[11px] font-bold tabular-nums ${
          count > 0
            ? "bg-white text-moss-700 border-moss-200"
            : "bg-transparent text-stone-400 border-stone-200"
        }`}
      >
        {count}
      </span>
    </header>
  );
}
