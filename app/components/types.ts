// Shared client types — mirror the API contract exactly.

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

export interface Lead {
  lead_id: string;
  name?: string;
  channel: Channel;
  language?: Language;
  address?: string;
  zone?: string | null;
  property_type?: string;
  desired_frequency?: string;
  photos: string[];
  vision_assessment?: Record<string, unknown>;
  lead_score?: Score;
  risk_level?: string;
  ai_recommendation?: string;
  suggested_package?: string;
  price_range?: PriceRange;
  status: LeadStatus;
  escalation_reason?: string;
  visit_at?: string;
  work_order?: Record<string, unknown>;
  internal_notes?: string;
  created_at: string;
  first_response_at?: string;
}

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
