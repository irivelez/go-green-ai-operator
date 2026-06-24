"use client";

import { useState } from "react";
import { ShieldAlert, Check, X, Loader2, Inbox } from "lucide-react";
import type { Lead } from "./types";
import { ChannelIcon, ScoreChip, LanguageChip } from "./icons";
import { fmtRange, initials, relTime } from "./format";

// Structured reason codes captured into the events log (spec §A.6).
// Keep this list in sync with the server-side override route allow-list.
const REASON_CODES: { value: string; label: string }[] = [
  { value: "area_wrong", label: "Area wrong" },
  { value: "slope_underestimated", label: "Slope underestimated" },
  { value: "should_have_escalated", label: "Should have escalated" },
  { value: "price_too_low", label: "Price too low" },
  { value: "address_wrong", label: "Address wrong" },
  { value: "other", label: "Other" },
];

export interface ReviewActionPayload {
  reason_code?: string;
  corrected_value?: string;
}

export function ReviewInbox({
  leads,
  onAction,
}: {
  leads: Lead[];
  onAction: (leadId: string, action: "approve" | "reject", payload: ReviewActionPayload) => Promise<void>;
}) {
  const queue = leads.filter((l) => l.status === "Needs Human Review");

  return (
    <section className="rounded-2xl border border-amber-200/70 bg-white shadow-petal overflow-hidden">
      <header className="flex items-center justify-between gap-3 border-b border-amber-100 bg-gradient-to-r from-amber-50 to-amber-50/30 px-4 py-3 sm:px-5">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 text-amber-800 border border-amber-200">
            <ShieldAlert className="h-4 w-4" strokeWidth={1.8} />
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-lg font-medium text-bark-900 leading-tight">Review queue</h2>
            <p className="text-[11px] text-amber-900/70 mt-0.5">Cases the agent escalated — humans take the call</p>
          </div>
        </div>
        <span
          className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full border px-2 text-[11px] font-bold tabular-nums ${
            queue.length > 0
              ? "bg-amber-500 text-amber-50 border-amber-600"
              : "bg-moss-50 text-moss-700 border-moss-200"
          }`}
        >
          {queue.length}
        </span>
      </header>

      <div className="max-h-[420px] overflow-y-auto rail divide-y divide-amber-100/60">
        {queue.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 px-4 text-center">
            <Inbox className="h-6 w-6 text-moss-400" strokeWidth={1.6} />
            <p className="text-sm text-moss-700/70 font-medium">Queue is clear.</p>
            <p className="text-[11px] text-moss-700/50 max-w-[26ch]">
              The operator is handling everything autonomously right now.
            </p>
          </div>
        ) : (
          queue.map((lead) => <ReviewRow key={lead.lead_id} lead={lead} onAction={onAction} />)
        )}
      </div>
    </section>
  );
}

function ReviewRow({
  lead,
  onAction,
}: {
  lead: Lead;
  onAction: (leadId: string, action: "approve" | "reject", payload: ReviewActionPayload) => Promise<void>;
}) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  // Which action's reason panel is open (null = closed). Inline panel, not a portal —
  // keeps the dashboard's flat, single-surface feel consistent with KpiRow / LeadCard.
  const [panel, setPanel] = useState<"approve" | "reject" | null>(null);
  const [reasonCode, setReasonCode] = useState<string>(REASON_CODES[0]!.value);
  const [correctedValue, setCorrectedValue] = useState<string>("");

  const display = lead.name?.trim() || `Lead ${lead.lead_id.slice(-6)}`;
  const range = fmtRange(lead.price_range);

  const openPanel = (action: "approve" | "reject") => {
    if (busy) return;
    setPanel(action);
    setReasonCode(REASON_CODES[0]!.value);
    setCorrectedValue("");
  };

  const cancel = () => {
    setPanel(null);
    setCorrectedValue("");
  };

  const confirm = async () => {
    if (!panel || busy) return;
    setBusy(panel);
    try {
      await onAction(lead.lead_id, panel, {
        reason_code: reasonCode,
        corrected_value: correctedValue.trim() || undefined,
      });
      setPanel(null);
      setCorrectedValue("");
    } finally {
      setBusy(null);
    }
  };

  const isApprovePanel = panel === "approve";

  return (
    <div className="px-4 py-3.5 sm:px-5 hover:bg-amber-50/30 transition-colors">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-900 text-[11px] font-semibold">
          {initials(lead.name, lead.lead_id)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <h3 className="text-sm font-semibold text-bark-900 truncate">{display}</h3>
            <ScoreChip score={lead.lead_score} />
            <LanguageChip lang={lead.language} />
            <span className="inline-flex items-center gap-1 text-[11px] text-moss-700/65">
              <ChannelIcon channel={lead.channel} className="h-3 w-3" />
              <span className="capitalize">{lead.channel}</span>
            </span>
            <span className="text-[11px] text-moss-700/50">· {relTime(lead.created_at)}</span>
          </div>

          {lead.escalation_reason && (
            <p className="mt-1.5 text-[12px] leading-relaxed text-amber-900">
              <span className="text-[10px] uppercase tracking-wider font-semibold opacity-70">Why escalated:</span>{" "}
              {lead.escalation_reason}
            </p>
          )}

          {lead.internal_notes && (
            <p className="mt-1.5 text-[12px] leading-relaxed text-moss-800/85">
              <span className="text-[10px] uppercase tracking-wider font-semibold opacity-60">Notes:</span>{" "}
              {lead.internal_notes}
            </p>
          )}

          {(range || lead.address || lead.zone) && (
            <div className="mt-1.5 flex items-center gap-2 text-[11px] text-moss-700/70">
              {range && <span className="font-medium text-moss-900">{range}</span>}
              {range && (lead.address || lead.zone) && <span className="opacity-50">·</span>}
              {(lead.address || lead.zone) && <span className="truncate">{lead.address || lead.zone}</span>}
            </div>
          )}
        </div>
      </div>

      {panel === null ? (
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => openPanel("reject")}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-full border border-stone-300 bg-white px-3 py-1.5 text-[12px] font-medium text-stone-700 transition hover:bg-stone-50 hover:border-stone-400 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2.2} />
            Reject
          </button>
          <button
            type="button"
            onClick={() => openPanel("approve")}
            disabled={busy !== null}
            data-testid={`approve-${lead.lead_id}`}
            className="inline-flex items-center gap-1.5 rounded-full bg-moss-600 px-3.5 py-1.5 text-[12px] font-semibold text-moss-50 transition hover:bg-moss-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-petal"
          >
            <Check className="h-3.5 w-3.5" strokeWidth={2.4} />
            Approve
          </button>
        </div>
      ) : (
        <div
          data-testid={`reason-panel-${lead.lead_id}`}
          className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3 space-y-2.5"
        >
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-[0.16em] font-semibold text-amber-900/75">
              {isApprovePanel ? "Approve" : "Reject"} — why?
            </span>
            <span className="text-[11px] text-amber-900/60">captured to the learning log</span>
          </div>

          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider font-semibold text-moss-700/70 mb-1">
              Reason
            </span>
            <select
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value)}
              disabled={busy !== null}
              className="w-full rounded-lg border border-amber-200 bg-white px-2.5 py-1.5 text-[12px] text-bark-900 focus:outline-none focus:border-amber-400 disabled:opacity-50"
            >
              {REASON_CODES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider font-semibold text-moss-700/70 mb-1">
              Corrected value <span className="opacity-60 normal-case">(optional)</span>
            </span>
            <input
              type="text"
              value={correctedValue}
              onChange={(e) => setCorrectedValue(e.target.value)}
              disabled={busy !== null}
              placeholder="e.g. 4200 sqft, steep, out of area"
              className="w-full rounded-lg border border-amber-200 bg-white px-2.5 py-1.5 text-[12px] text-bark-900 placeholder:text-moss-700/40 focus:outline-none focus:border-amber-400 disabled:opacity-50"
            />
          </label>

          <div className="flex items-center justify-end gap-2 pt-0.5">
            <button
              type="button"
              onClick={cancel}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-full border border-stone-300 bg-white px-3 py-1.5 text-[12px] font-medium text-stone-700 transition hover:bg-stone-50 hover:border-stone-400 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={busy !== null}
              data-testid={`confirm-${lead.lead_id}`}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition shadow-petal disabled:opacity-50 disabled:cursor-not-allowed ${
                isApprovePanel
                  ? "bg-moss-600 text-moss-50 hover:bg-moss-700"
                  : "bg-stone-700 text-stone-50 hover:bg-stone-800"
              }`}
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : isApprovePanel ? (
                <Check className="h-3.5 w-3.5" strokeWidth={2.4} />
              ) : (
                <X className="h-3.5 w-3.5" strokeWidth={2.2} />
              )}
              Confirm {isApprovePanel ? "approve" : "reject"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
