// Dashboard KPIs (spec §17, §20) computed from the live pipeline. Stable against wall-clock
// so the demo numbers are reproducible: "today" = within 24h of the most recent lead.

import type { Lead } from "./store";

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

const VISITS_PER_MONTH: Record<string, number> = { weekly: 4.33, biweekly: 2.17, monthly: 1 };
const NON_TERMINAL_STATUSES = new Set(["ACTIVE", "PAID", "BOOKED"]);

export function computeKpis(leads: Lead[]): Kpis {
  const byStage: Record<string, number> = {};
  for (const l of leads) byStage[l.status] = (byStage[l.status] ?? 0) + 1;

  const latest = leads.reduce((m, l) => Math.max(m, Date.parse(l.created_at)), 0);
  const newToday = leads.filter((l) => latest - Date.parse(l.created_at) <= 24 * 3600 * 1000).length;

  const responseSecs = leads
    .filter((l) => l.first_response_at)
    .map((l) => (Date.parse(l.first_response_at!) - Date.parse(l.created_at)) / 1000)
    .filter((s) => s >= 0)
    .sort((a, b) => a - b);
  const medianFirstResponseSec = responseSecs.length
    ? responseSecs[Math.floor((responseSecs.length - 1) / 2)]!
    : null;

  let potentialMonthlyRevenue = 0;
  for (const l of leads) {
    if (l.price_range && l.desired_frequency && NON_TERMINAL_STATUSES.has(l.status)) {
      const mid = (l.price_range.low + l.price_range.high) / 2;
      potentialMonthlyRevenue += mid * (VISITS_PER_MONTH[l.desired_frequency] ?? 1);
    }
  }

  const needsReview = byStage["ESCALATED"] ?? 0;
  const total = leads.length;

  // V1-dashboard KPIs derived from canonical status + additive timestamp
  // markers: readyToSchedule = ACTIVE+slots_offered_at; BOOKED splits into
  // scheduled vs workOrders by work_order_created_at.
  const readyToSchedule = leads.filter(
    (l) => l.status === "ACTIVE" && l.slots_offered_at != null,
  ).length;
  const scheduled = leads.filter(
    (l) => l.status === "BOOKED" && l.work_order_created_at == null,
  ).length;
  const workOrders = leads.filter(
    (l) => l.status === "BOOKED" && l.work_order_created_at != null,
  ).length;

  return {
    total,
    byStage,
    newToday,
    qualifiedA: leads.filter((l) => l.lead_score === "A").length,
    readyToSchedule,
    scheduled,
    workOrders,
    needsReview,
    notFit: byStage["DEAD"] ?? 0,
    lost: byStage["ABANDONED"] ?? 0,
    autonomyRatePct: total ? Math.round(((total - needsReview) / total) * 100) : 0,
    medianFirstResponseSec,
    potentialMonthlyRevenue: Math.round(potentialMonthlyRevenue),
    activeClients: (byStage["BOOKED"] ?? 0) + (byStage["PAID"] ?? 0),
  };
}
