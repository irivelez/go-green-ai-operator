// Shared client types. `Lead` is DERIVED from the server (src/lead-dto.ts) so it
// can't drift from the store shape; the rest are dashboard-specific view models.

import type { LeadDTO } from "@/src/lead-dto";

export type LeadStatus =
  | "New Lead"
  | "Waiting for Info"
  | "Info Received"
  | "AI Qualified"
  | "Ready to Schedule"
  | "Scheduled"
  | "Work Order Created"
  | "Needs Human Review"
  | "Not a Fit"
  | "Lost / No Response";

export type Channel = "telegram" | "email" | "whatsapp" | "form";
export type Language = "en" | "es";
export type Score = "A" | "B" | "C";

export interface PriceRange {
  low: number;
  high: number;
}

// Derived from the store Lead (the single source) — excludes server-internal fields.
export type Lead = LeadDTO;

export interface Kpis {
  total: number;
  byStage: Record<string, number>;
  newToday: number;
  qualifiedA: number;
  readyToSchedule: number;
  scheduled: number;
  workOrders: number;
  needsReview: number;
  notFit: number;
  lost: number;
  autonomyRatePct: number;
  medianFirstResponseSec: number | null;
  potentialMonthlyRevenue: number;
  activeClients: number;
}

export interface Decision {
  intent: string;
  language: Language;
  escalated: boolean;
  escalation_reasons: string[];
  score?: Score;
  missing: string[];
  price_range?: PriceRange;
  suggested_package?: string;
  slots: string[];
  booked_slot?: string;
  stage: LeadStatus;
  used_llm: boolean;
  trace: string[];
}

export interface LeadsResponse {
  leads: Lead[];
  kpis: Kpis;
}

export interface OperatorResponse {
  reply: string;
  lead: Lead;
  decision: Decision;
}

export const STAGE_ORDER: LeadStatus[] = [
  "New Lead",
  "Waiting for Info",
  "Info Received",
  "AI Qualified",
  "Ready to Schedule",
  "Scheduled",
  "Work Order Created",
  "Needs Human Review",
  "Not a Fit",
  "Lost / No Response",
];
