// Crew handoff via Composio → Google Calendar (GOOGLECALENDAR_CREATE_EVENT).
// Deterministic, fire-and-forget: when a booking is confirmed, the crew calendar
// gets the work-order event. Key-guarded so tests + the zero-key demo stay green:
//   - no COMPOSIO_API_KEY or no GOOGLE_CALENDAR_ID → silent no-op ({ok:false, reason:"unconfigured"}).
//   - any failure is swallowed (logged) — a calendar push must NEVER break booking.
// Spec: §A.5 — crew endpoint via Google Calendar event.

import { Composio } from "@composio/core";
import { getGoogleCalendarId } from "./env";

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
