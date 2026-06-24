// Seed dataset — a realistic pipeline across every stage (spec §6) so the dashboard
// is alive on first load. Maps the 10 golden scenarios (spec §14) onto real records.
// Used by the in-memory store backend (serverless-safe).

import type { Lead } from "./store";

const t = (iso: string) => iso;

export const SEED_LEADS: Lead[] = [
  // 1) Happy A-lead, booked + work order (medium yard, biweekly, Mission 94110)
  {
    lead_id: "L-1001", name: "Dana Reyes", channel: "telegram", language: "en",
    address: "742 Valencia St, San Francisco, CA 94110", zone: "SF-94110",
    property_type: "residential", desired_frequency: "biweekly",
    photos: ["yard-1001.jpg"],
    vision_assessment: { condition_score: 6, overgrowth: "med", cleanup_required: false, slope_signals: { stairs_visible: false, retaining_wall_visible: false, terraces_visible: false, steepness_hint: "none" }, confidence: 0.86 },
    lead_score: "A", risk_level: "low",
    ai_recommendation: "Biweekly Signature maintenance. Manageable yard, no cleanup needed.",
    suggested_package: "signature", price_range: { low: 155, high: 190 },
    status: "BOOKED",
    work_order_created_at: t("2026-06-14T18:00:00Z"),
    visit_at: t("2026-06-15T15:00:00Z"),
    work_order: { address: "742 Valencia St, San Francisco, CA 94110", zone: "SF-94110", frequency: "biweekly", package: "signature", price_range: { low: 155, high: 190 }, visit_at: "2026-06-15T15:00:00Z", notes: "Standard residential maintenance evaluation." },
    created_at: t("2026-06-12T17:42:10Z"), first_response_at: t("2026-06-12T17:42:48Z"),
  },
  // 2) Spanish A-lead, scheduled (small yard, weekly, Ingleside 94112)
  {
    lead_id: "L-1002", name: "María González", channel: "whatsapp", language: "es",
    address: "55 Ottawa Ave, San Francisco, CA 94112", zone: "SF-94112",
    property_type: "residential", desired_frequency: "weekly",
    photos: ["yard-1002.jpg"],
    vision_assessment: { condition_score: 7, overgrowth: "low", cleanup_required: false, slope_signals: { stairs_visible: false, retaining_wall_visible: false, terraces_visible: false, steepness_hint: "none" }, confidence: 0.9 },
    lead_score: "A", risk_level: "low",
    ai_recommendation: "Semanal Signature. Jardín pequeño y bien cuidado.",
    suggested_package: "signature", price_range: { low: 70, high: 85 },
    status: "BOOKED", visit_at: t("2026-06-14T16:30:00Z"),
    created_at: t("2026-06-12T19:05:00Z"), first_response_at: t("2026-06-12T19:05:41Z"),
  },
  // 3) HOA → human review (escalation)
  {
    lead_id: "L-1003", name: "Tom Becker", channel: "email", language: "en",
    address: "1200 Gough St, San Francisco, CA 94109", zone: "SF-94109",
    property_type: "hoa", desired_frequency: "weekly", photos: [],
    lead_score: "B", risk_level: "high",
    status: "ESCALATED", escalation_reason: "HOA", escalated_at: t("2026-06-12T20:18:00Z"),
    internal_notes: "HOA common-area maintenance, 24-unit building. Needs formal proposal + insurance docs — human takes over.",
    created_at: t("2026-06-12T20:18:00Z"), first_response_at: t("2026-06-12T20:18:35Z"),
  },
  // 4) Neglected yard → cleanup required before recurring (large, biweekly, Inner Richmond 94121)
  {
    lead_id: "L-1004", name: "Priya Shah", channel: "telegram", language: "en",
    address: "330 24th Ave, San Francisco, CA 94121", zone: "SF-94121",
    property_type: "residential", desired_frequency: "biweekly",
    photos: ["yard-1004a.jpg", "yard-1004b.jpg"],
    vision_assessment: { condition_score: 3, overgrowth: "high", cleanup_required: true, slope_signals: { stairs_visible: false, retaining_wall_visible: false, terraces_visible: false, steepness_hint: "none" }, confidence: 0.82 },
    lead_score: "A", risk_level: "low",
    ai_recommendation: "Initial cleanup required BEFORE recurring. Then biweekly Signature. Cleanup quoted separately.",
    suggested_package: "signature", price_range: { low: 290, high: 370 },
    status: "ACTIVE",
    internal_notes: "Heavy overgrowth — one-time cleanup $1,300–$3,000 (separate line), then recurring.",
    created_at: t("2026-06-13T01:12:00Z"), first_response_at: t("2026-06-13T01:12:52Z"),
  },
  // 5) Property manager, multifamily → human review
  {
    lead_id: "L-1005", name: "Sandra Lee", channel: "email", language: "en",
    address: "455 Hyde St, San Francisco, CA 94109", zone: "SF-94109",
    property_type: "property_manager", desired_frequency: "biweekly", photos: ["yard-1005.jpg"],
    lead_score: "B", risk_level: "high",
    status: "ESCALATED", escalation_reason: "property manager", escalated_at: t("2026-06-13T02:40:00Z"),
    internal_notes: "3-building portfolio, wants one contract + monthly reporting. Pricing + contract = human.",
    created_at: t("2026-06-13T02:40:00Z"), first_response_at: t("2026-06-13T02:40:39Z"),
  },
  // 6) Out of area → not a fit (Daly City 94015)
  {
    lead_id: "L-1006", name: "Kevin Wong", channel: "form", language: "en",
    address: "120 Hillside Blvd, Daly City, CA 94015", zone: null,
    property_type: "residential", desired_frequency: "monthly", photos: [],
    lead_score: "C", risk_level: "low",
    ai_recommendation: "Outside SF service area (94015). Polite decline.",
    status: "DEAD",
    internal_notes: "Daly City — outside current SF zip coverage.",
    created_at: t("2026-06-13T03:15:00Z"), first_response_at: t("2026-06-13T03:15:30Z"),
  },
  // 7) Missing address → waiting for info
  {
    lead_id: "L-1007", name: "Olivia Martin", channel: "telegram", language: "en",
    property_type: "residential", desired_frequency: "biweekly", photos: ["yard-1007.jpg"],
    lead_score: "B", risk_level: "low",
    status: "ACTIVE",
    internal_notes: "Has photos + frequency, no address yet. Asked for it.",
    created_at: t("2026-06-13T04:02:00Z"), first_response_at: t("2026-06-13T04:02:33Z"),
  },
  // 8) Spanish, irrigation extra detected → ready to schedule (Castro 94114)
  {
    lead_id: "L-1008", name: "Carlos Núñez", channel: "whatsapp", language: "es",
    address: "4127 18th St, San Francisco, CA 94114", zone: "SF-94114",
    property_type: "residential", desired_frequency: "biweekly", photos: ["yard-1008.jpg"],
    vision_assessment: { condition_score: 5, overgrowth: "med", cleanup_required: false, slope_signals: { stairs_visible: false, retaining_wall_visible: false, terraces_visible: false, steepness_hint: "none" }, confidence: 0.78, detected_extras: ["irrigation"] },
    lead_score: "A", risk_level: "low",
    ai_recommendation: "Quincenal Signature. Posible problema de riego — cotizar por separado (no incluido).",
    suggested_package: "signature", price_range: { low: 155, high: 190 },
    status: "ACTIVE", slots_offered_at: t("2026-06-13T05:25:00Z"),
    internal_notes: "Dry patches suggest irrigation issue — flagged as separate quote, not folded into maintenance.",
    created_at: t("2026-06-13T05:20:00Z"), first_response_at: t("2026-06-13T05:20:44Z"),
  },
  // 9) Good lead went quiet → lost / no response
  {
    lead_id: "L-1009", name: "Ben Carter", channel: "email", language: "en",
    address: "88 Day St, San Francisco, CA 94131", zone: "SF-94131",
    property_type: "residential", desired_frequency: "monthly", photos: [],
    lead_score: "B", risk_level: "low",
    status: "ABANDONED",
    internal_notes: "Followed up 1h/24h/3d/7d — no reply. Kept in memory for reactivation.",
    created_at: t("2026-06-11T18:00:00Z"), first_response_at: t("2026-06-11T18:00:50Z"),
  },
  // 10) Price shopper → not a fit
  {
    lead_id: "L-1010", name: "Greg Tan", channel: "form", language: "en",
    address: "70 Surrey St, San Francisco, CA 94131", zone: "SF-94131",
    property_type: "residential", desired_frequency: "monthly", photos: [],
    lead_score: "C", risk_level: "medium",
    ai_recommendation: "Only wants lowest price; not interested in recurring. Polite decline.",
    status: "DEAD",
    internal_notes: "Compared everything to a $40 gardener, refused photos. Not a premium-maintenance fit.",
    created_at: t("2026-06-12T22:30:00Z"), first_response_at: t("2026-06-12T22:30:29Z"),
  },
  // 11) Fresh inbound → new lead (just a greeting)
  {
    lead_id: "L-1011", name: "Aisha Khan", channel: "telegram", language: "en",
    property_type: "unknown", photos: [],
    status: "ACTIVE",
    internal_notes: "Just said hi — sent the warm intake asking for address, photos, frequency.",
    created_at: t("2026-06-13T06:10:00Z"), first_response_at: t("2026-06-13T06:10:36Z"),
  },
];
