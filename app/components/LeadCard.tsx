"use client";

import { MapPin, Repeat, Image as ImageIcon, AlertTriangle, CalendarClock } from "lucide-react";
import type { Lead } from "./types";
import { ChannelIcon, ScoreChip, LanguageChip } from "./icons";
import { fmtRange, fmtLA, initials, relTime } from "./format";

export function LeadCard({
  lead,
  emphasis = false,
  compact = false,
}: {
  lead: Lead;
  emphasis?: boolean;
  compact?: boolean;
}) {
  const isReview = lead.status === "ESCALATED";
  const range = fmtRange(lead.price_range);
  const locationLine = lead.address || lead.zone || null;
  const display = lead.name?.trim() || `Lead ${lead.lead_id.slice(-6)}`;

  const border = isReview
    ? "border-amber-300 bg-amber-50/50"
    : emphasis
      ? "border-moss-200 bg-white"
      : "border-moss-100 bg-white";

  const accent = isReview ? "before:bg-amber-400" : "before:bg-moss-300";

  return (
    <article
      className={`relative overflow-hidden rounded-xl border ${border} shadow-petal transition-all duration-200 hover:shadow-petal-lg hover:-translate-y-[1px] before:absolute before:inset-y-0 before:left-0 before:w-[3px] ${accent}`}
    >
      <div className={compact ? "p-3 pl-4" : "p-3.5 pl-4 sm:p-4 sm:pl-5"}>
        {/* Top row: identity + score */}
        <div className="flex items-start gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-moss-100 text-moss-700 text-[11px] font-semibold tracking-wide">
            {initials(lead.name, lead.lead_id)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <h3 className="text-sm font-semibold text-bark-900 truncate">{display}</h3>
              <ScoreChip score={lead.lead_score} />
              <LanguageChip lang={lead.language} />
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-moss-700/70">
              <ChannelIcon channel={lead.channel} className="h-3 w-3" />
              <span className="capitalize">{lead.channel}</span>
              <span className="opacity-50">·</span>
              <span className="font-mono text-[10px] opacity-70">{lead.lead_id}</span>
              {lead.created_at && (
                <>
                  <span className="opacity-50">·</span>
                  <span>{relTime(lead.created_at)}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Price band */}
        {range && (
          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-display text-lg font-medium text-moss-900">{range}</span>
            {lead.suggested_package && (
              <span className="text-[11px] text-moss-700/70 truncate">
                · {lead.suggested_package}
              </span>
            )}
          </div>
        )}
        {!range && lead.suggested_package && (
          <div className="mt-2 text-xs text-moss-700/80 truncate">
            {lead.suggested_package}
          </div>
        )}

        {/* Meta rows */}
        <div className="mt-2.5 space-y-1 text-[12px] text-moss-800/80">
          {locationLine && (
            <div className="flex items-start gap-1.5">
              <MapPin className="h-3.5 w-3.5 mt-[1px] shrink-0 text-moss-500" strokeWidth={1.7} />
              <span className="truncate" title={locationLine}>
                {locationLine}
              </span>
            </div>
          )}
          {lead.desired_frequency && (
            <div className="flex items-center gap-1.5">
              <Repeat className="h-3.5 w-3.5 shrink-0 text-moss-500" strokeWidth={1.7} />
              <span className="capitalize">{lead.desired_frequency}</span>
              {lead.property_type && (
                <>
                  <span className="opacity-40">·</span>
                  <span className="capitalize text-moss-700/70">{lead.property_type}</span>
                </>
              )}
            </div>
          )}
          {lead.photos.length > 0 && (
            <div className="flex items-center gap-1.5 text-moss-700/70">
              <ImageIcon className="h-3.5 w-3.5 shrink-0 text-moss-500" strokeWidth={1.7} />
              <span>
                {lead.photos.length} photo{lead.photos.length === 1 ? "" : "s"} assessed
              </span>
            </div>
          )}
          {lead.visit_at && (
            <div className="flex items-center gap-1.5 text-emerald-800">
              <CalendarClock className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
              <span className="font-medium">{fmtLA(lead.visit_at)}</span>
            </div>
          )}
        </div>

        {/* Escalation reason — for amber states */}
        {isReview && lead.escalation_reason && (
          <div className="mt-3 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-100/60 px-2.5 py-1.5 text-[11px] text-amber-900 leading-relaxed">
            <AlertTriangle className="h-3.5 w-3.5 mt-[1px] shrink-0" strokeWidth={1.8} />
            <span>{lead.escalation_reason}</span>
          </div>
        )}
      </div>
    </article>
  );
}
