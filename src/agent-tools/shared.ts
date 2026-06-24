// Shared bits for the per-stage agent-tool modules — moved verbatim from
// src/agent-tools.ts during the mechanical split. ToolContext, the tier/frequency
// enums + order, the paid-state set, and the numeric guard constants live here so
// every stage module imports them without a circular dependency.

import { z } from "zod";
import { type LeadStatus } from "../store";
import { type Tier } from "../contract";

export interface ToolContext {
  leadId: string;
  language: "en" | "es";
}

export const TIER_ORDER: Tier[] = ["essential", "signature", "estate"];
export const TierEnum = z.enum(["essential", "signature", "estate"]);
export const FrequencyEnum = z.enum(["weekly", "biweekly", "monthly"]);

// Lead is "paid" once the Stripe webhook (stripe.ts) advances it past qualification.
export const PAID_STATES = new Set<LeadStatus>([
  "Ready to Schedule",
  "Scheduled",
  "Work Order Created",
]);

// How many PRICE_BOOK inclusions to surface (recommend card + work order).
export const MAX_TIER_INCLUDES = 6;

// Plausibility ceiling for a residential lot in SF — 60000 sqft ≈ 1.4 acres,
// well above any single-family parcel. Above this the polygon is either a
// drawing mistake or an attempt to trick a downstream area×price calc into a
// huge subscription. Below or equal to 0 is a degenerate ring. Either case →
// refuse to persist, ask the customer to redraw. The deterministic engine
// (priceCart / pricePerVisit) never sees the bad number.
export const MAX_RESIDENTIAL_SQFT = 60000;
