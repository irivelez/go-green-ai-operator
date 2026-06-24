"use client";

import { Mail, MessageCircle, Phone, Send, FileText } from "lucide-react";
import type { Channel, Score, LeadStatus } from "./types";

export function ChannelIcon({
  channel,
  className = "h-3.5 w-3.5",
}: {
  channel: Channel;
  className?: string;
}) {
  switch (channel) {
    case "telegram":
      return <Send className={className} aria-label="Telegram" />;
    case "whatsapp":
      return <Phone className={className} aria-label="WhatsApp" />;
    case "email":
      return <Mail className={className} aria-label="Email" />;
    case "form":
      return <FileText className={className} aria-label="Web form" />;
    default:
      return <MessageCircle className={className} />;
  }
}

const SCORE_STYLES: Record<Score, string> = {
  A: "bg-moss-600 text-moss-50 border-moss-700",
  B: "bg-amber-100 text-amber-900 border-amber-300",
  C: "bg-stone-200 text-stone-700 border-stone-300",
};

export function ScoreChip({ score }: { score?: Score }) {
  if (!score) return null;
  return (
    <span
      className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full border px-1.5 text-[10px] font-bold uppercase tracking-wider ${SCORE_STYLES[score]}`}
      title={`Lead score: ${score}`}
    >
      {score}
    </span>
  );
}

const STAGE_STYLES: Partial<Record<LeadStatus, string>> = {
  ACTIVE: "bg-moss-100 text-moss-800 border-moss-300",
  PAID: "bg-moss-200/70 text-moss-900 border-moss-400",
  BOOKED: "bg-emerald-600 text-emerald-50 border-emerald-700",
  ESCALATED: "bg-amber-100 text-amber-900 border-amber-400",
  PAUSED: "bg-stone-50 text-stone-700 border-stone-200",
  ABANDONED: "bg-stone-100 text-stone-500 border-stone-200",
  DEAD: "bg-stone-100 text-stone-600 border-stone-300",
};

export function StageBadge({
  stage,
  size = "sm",
}: {
  stage: LeadStatus;
  size?: "xs" | "sm";
}) {
  const cls = STAGE_STYLES[stage] ?? "bg-stone-100 text-stone-700 border-stone-200";
  const sz =
    size === "xs"
      ? "h-5 px-1.5 text-[10px]"
      : "h-6 px-2.5 text-[11px]";
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full border ${sz} font-medium tracking-wide ${cls} whitespace-nowrap`}
    >
      {stage}
    </span>
  );
}

export function LanguageChip({ lang }: { lang?: "en" | "es" }) {
  if (!lang) return null;
  return (
    <span
      className="inline-flex h-5 items-center justify-center rounded-full border border-moss-200 bg-moss-50 px-1.5 text-[10px] font-semibold uppercase tracking-wider text-moss-700"
      title={lang === "es" ? "Español" : "English"}
    >
      {lang}
    </span>
  );
}
