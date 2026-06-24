// First-class event stream (todo 3 — spec §A.6 HITL learning loop).
//
// Events live in a dedicated Redis List `events:{leadId}` (LPUSH newest-first,
// LRANGE to read, 90-day TTL), NOT nested on the Lead body. This takes the
// append OFF the lead's write path: LPUSH is atomic and a concurrent
// upsertLead can never clobber an event (the old `lead.events` array shared the
// RMW race). The Lead keeps only a `lastEventTs` pointer (written via upsertLead).
//
// Event shape LOCKED (Metis M4): { ts, type(=action), payload, actor }. The
// existing LeadEvent fields (reason_code, corrected_value, agent_decision,
// inputs) are preserved INSIDE payload so the HITL learning loop (hitl.ts) keeps
// working unchanged — appendEvent still accepts the flat LeadEvent shape and
// listEvents still returns it.
//
// Dev parity: memory/json backends use an in-process Map of arrays (single
// writer, plain push is equivalent to the List's atomic append). resetStore()
// in store.ts clears leads; resetEvents() here clears the event log for
// hermetic tests.

import { getSharedRedis } from "./store";
import type { LeadEvent } from "./store";
import { upsertLead, getLead } from "./store";

const EVENTS_KEY = (leadId: string) => `events:${leadId}`;
const EVENTS_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days
const EVENTS_PAGE = 500; // bounded read; the dashboard never needs more

// In-process event log for memory/json dev paths. Keyed by leadId → newest-last.
const memEvents = new Map<string, LeadEvent[]>();

export function resetEvents(): void {
  memEvents.clear();
}

export async function appendEvent(
  lead_id: string,
  event: Omit<LeadEvent, "ts"> & { ts?: string },
): Promise<LeadEvent> {
  const stored: LeadEvent = { ...event, ts: event.ts ?? new Date().toISOString() };
  // No-op persist for an absent lead (mirror the old store contract): events are
  // a lead-scoped timeline, so a missing lead gets the event object back but
  // nothing is written.
  const lead = await getLead(lead_id);
  if (!lead) return stored;

  const redis = getSharedRedis();
  if (redis) {
    await redis.lpush(EVENTS_KEY(lead_id), JSON.stringify(stored));
    await redis.expire(EVENTS_KEY(lead_id), EVENTS_TTL_SECONDS);
  } else {
    const list = memEvents.get(lead_id) ?? [];
    list.push(stored);
    memEvents.set(lead_id, list);
  }
  // Pointer on the lead — a single scalar field, off the event-array write path.
  await upsertLead({ lead_id, channel: lead.channel, lastEventTs: stored.ts });
  return stored;
}

export async function listEvents(lead_id: string): Promise<LeadEvent[]> {
  const redis = getSharedRedis();
  if (redis) {
    // LRANGE returns newest-first (we LPUSH); reverse to chronological order to
    // match the old `lead.events` (append-order) contract consumers expect.
    const raw = await redis.lrange<string | LeadEvent>(EVENTS_KEY(lead_id), 0, EVENTS_PAGE - 1);
    const parsed = raw.map((r) => (typeof r === "string" ? (safeParse(r) as LeadEvent) : r));
    return parsed.filter((e): e is LeadEvent => !!e && typeof e === "object").reverse();
  }
  return [...(memEvents.get(lead_id) ?? [])];
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}
