// Crew handoff via Composio → Google Calendar (GOOGLECALENDAR_CREATE_EVENT).
// Deterministic, fire-and-forget: when a booking is confirmed, the crew calendar
// gets the work-order event. Key-guarded so tests + the zero-key demo stay green:
//   - no COMPOSIO_API_KEY or no GOOGLE_CALENDAR_ID → silent no-op ({ok:false, reason:"unconfigured"}).
//   - any failure is swallowed (logged) — a calendar push must NEVER break booking.
// Spec: §A.5 — crew endpoint via Google Calendar event.

import { Composio } from "@composio/core";
import { getGoogleCalendarId } from "./env";
import { allLeads } from "./store";
import { actionSeen, actionAlreadySeen } from "./store";

let _client: Composio | null = null;
function client(apiKey: string): Composio {
  if (!_client) _client = new Composio({ apiKey });
  return _client;
}

export interface CrewEventInput {
  lead_id: string;
  address: string;
  sqft: number;
  slope_tier: "flat" | "moderate" | "steep";
  tier_name: string;
  start_iso: string;
  end_iso: string;
  access_notes?: string;
  paid: boolean;
}

export interface CrewEventPayload {
  summary: string;
  description: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  location: string;
}

const TZ = "America/Los_Angeles";

function shortAddress(address: string): string {
  const first = address.split(",")[0];
  return (first ?? address).trim();
}

/** Pure: build the Google Calendar event payload from a crew handoff input. */
export function buildCrewEventPayload(input: CrewEventInput): CrewEventPayload {
  const summary = `Go Green — ${input.tier_name} @ ${shortAddress(input.address)}`;
  const descLines = [
    `Address: ${input.address}`,
    `Maintainable area: ${input.sqft} sqft`,
    `Slope: ${input.slope_tier}`,
    `Plan: ${input.tier_name}`,
  ];
  if (input.access_notes && input.access_notes.trim().length > 0) {
    descLines.push(`Access notes: ${input.access_notes}`);
  }
  descLines.push(`Payment: ${input.paid ? "PAID" : "UNPAID"}`);
  return {
    summary,
    description: descLines.join("\n"),
    start: { dateTime: input.start_iso, timeZone: TZ },
    end: { dateTime: input.end_iso, timeZone: TZ },
    location: input.address,
  };
}

/**
 * Push a crew work-order event to Google Calendar via Composio. Never throws.
 * - Missing COMPOSIO_API_KEY or GOOGLE_CALENDAR_ID → {ok:false, reason:"unconfigured"}.
 * - Execute failure → console.error + {ok:false, reason}.
 * - Success → {ok:true, eventId}.
 */
export async function createCrewEvent(
  input: CrewEventInput,
): Promise<{ ok: boolean; eventId?: string; reason?: string }> {
  const apiKey = process.env.COMPOSIO_API_KEY;
  const calendarId = getGoogleCalendarId();
  const userId = process.env.COMPOSIO_USER_ID || "default";
  if (!apiKey || !calendarId) return { ok: false, reason: "unconfigured" };
  // SEC-E: explicit opt-in before customer PII reaches Google Calendar.
  // The /api/leads/[id]/approve and funnel→confirm_booking paths are still
  // unauthenticated (tenant isolation is the documented KNOWN GAP, AGENTS.md
  // §1) — an attacker who guesses a lead id could trigger a calendar write
  // with the customer's name + address. Default OFF mirrors the
  // STRIPE_LIVE_OK pattern: irreversible/external side effects stay gated
  // until owner-auth lands. Remove this gate at the same time as auth.
  if (process.env.CREW_CALENDAR_ENABLED !== "1") {
    return { ok: false, reason: "disabled" };
  }

  const payload = buildCrewEventPayload(input);

  try {
    const res = await client(apiKey).tools.execute("GOOGLECALENDAR_CREATE_EVENT", {
      userId,
      arguments: {
        calendar_id: calendarId,
        summary: payload.summary,
        description: payload.description,
        start: payload.start,
        end: payload.end,
        location: payload.location,
      },
    });
    if (!res.successful) {
      const reason = typeof res.error === "string" ? res.error : "execute_failed";
      console.error("[calendar] GOOGLECALENDAR_CREATE_EVENT failed:", res.error);
      return { ok: false, reason };
    }
    const data = res.data as { id?: string } | undefined;
    return { ok: true, eventId: data?.id };
  } catch (e) {
    const msg = (e as Error).message;
    console.error("[calendar] crew event error:", msg);
    return { ok: false, reason: msg };
  }
}

// One-way daily GCal export (todo 18): mirror today's BOOKED visits to the owner
// calendar. The local slot ledger stays the SOLE source of truth — this is a
// read-only owner-visibility mirror, NOT bidirectional sync (V1.1). Idempotent on
// the visit/slot id so a re-run never double-creates. Gated by CREW_CALENDAR_ENABLED
// (createCrewEvent enforces the gate); a missing key/flag → clean no-op.
export interface GcalExportResult {
  exported: number;
  skipped: number;
}

function isToday(visitIso: string, now: number): boolean {
  const day = (ms: number) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(
      new Date(ms),
    );
  const v = Date.parse(visitIso);
  return Number.isFinite(v) && day(v) === day(now);
}

export async function exportTodaysVisits(now = Date.now()): Promise<GcalExportResult> {
  const result: GcalExportResult = { exported: 0, skipped: 0 };
  const leads = await allLeads();
  for (const lead of leads) {
    if (lead.status !== "BOOKED" || !lead.visit_at || !isToday(lead.visit_at, now)) continue;
    const wo = (lead.work_order ?? {}) as Record<string, unknown>;
    const slotId = typeof wo.slotId === "string" ? wo.slotId : lead.visit_at;
    // Read-only idempotency pre-check (cross-model review S4): skip a visit that
    // was ALREADY exported in a prior run, BEFORE calling createCrewEvent — else a
    // re-run creates a DUPLICATE calendar event. The mark happens after success
    // (S1), so an unexported-or-failed visit still gets attempted here.
    if (await actionAlreadySeen(lead.lead_id, "gcal_export", slotId)) {
      result.skipped++;
      continue;
    }
    const endIso =
      typeof wo.window === "string" && wo.window.includes("–")
        ? wo.window.split("–")[1]!.trim()
        : lead.visit_at;
    const r = await createCrewEvent({
      lead_id: lead.lead_id,
      address: lead.address ?? "",
      sqft: lead.confirmed_sqft ?? lead.estimated_sqft ?? 0,
      slope_tier: lead.slope_tier ?? "flat",
      tier_name: lead.suggested_package ?? "Maintenance",
      start_iso: lead.visit_at,
      end_iso: endIso,
      paid: true,
    });
    if (!r.ok) {
      // Gated off / unconfigured / transient failure → do NOT mark seen, so a
      // future cron retries once keys land (Oracle S1: marking-before-success
      // permanently skipped the visit on a transient no-op). Disabled is a clean
      // no-op, not a skip-to-report.
      if (r.reason !== "disabled" && r.reason !== "unconfigured") result.skipped++;
      continue;
    }
    // Real create succeeded → NOW mark seen so the next cron run no-ops this visit.
    await actionSeen(lead.lead_id, "gcal_export", slotId);
    result.exported++;
  }
  return result;
}
