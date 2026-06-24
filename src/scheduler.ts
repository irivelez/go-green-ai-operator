// Slot generation + booking + waitlist gate (BUILD-DECISIONS §D1/§D2).
// Pure date math (no date library). 4 slots/day starting the first Thursday
// on/after fromDate, across a 14-day serve window.
//
// ─────────────────────────────────────────────────────────────────────────────
// V1-platform slot ledger (todo 1 — supersedes the in-memory/JSON memLedger):
//   The booking ledger is a Redis HASH `slots:{date}` (field=slotId,
//   value=leadId). The atomic claim is `HSETNX slots:{date} slotId leadId`
//   (returns 1=won, 0=taken → HGET to identify the holder). This is the ONLY
//   shared read path across Vercel pods — the old in-memory memLedger had none,
//   so two pods could double-book the same slot (Oracle Fix1). After a winning
//   claim we `EXPIRE slots:{date} <ttl> NX` so old-date slot Hashes auto-evict
//   instead of leaking forever (Oracle round-2).
//   Dev parity: memory/json paths use an in-process Map (single writer, so a
//   plain check-then-set is equivalent to the Hash's atomic HSETNX).
// ─────────────────────────────────────────────────────────────────────────────

import {
  FIRST_SERVE_WEEKDAY,
  SERVE_WINDOW_DAYS,
  SLOTS_PER_DAY,
  type SlotOffer,
} from "./contract";
import { getLead, actionSeen, getSharedRedis } from "./store";

// Daily slot windows (local wall-clock). T1..T4.
const WINDOWS: Array<{ start: [number, number]; end: [number, number] }> = [
  { start: [8, 0], end: [10, 0] },
  { start: [10, 0], end: [12, 0] },
  { start: [13, 0], end: [15, 0] },
  { start: [15, 0], end: [17, 0] },
];

const pad = (n: number): string => n.toString().padStart(2, "0");

const SLOTS_KEY = (date: string) => `slots:${date}`;
// TTL = serve window + a 7-day grace so a booked date's Hash auto-evicts well
// after the visit. Set once via EXPIRE ... NX (todo 1, Oracle round-2).
const SLOTS_TTL_SECONDS = (SERVE_WINDOW_DAYS + 7) * 24 * 60 * 60;

// ── in-process ledger (memory/json dev path) ─────────────────────────────────
// slotId → leadId (whoever booked it first).
let memBookings = new Map<string, string>();

export function resetSlots(): void {
  memBookings = new Map();
}

// ── date helpers ─────────────────────────────────────────────────────────────

// First weekday (e.g. Thu=4) on/after `from`, using UTC fields for determinism.
function firstWeekdayOnOrAfter(from: Date, weekday: number): Date {
  const d = new Date(from.getTime());
  const cur = d.getUTCDay();
  const diff = (weekday - cur + 7) % 7;
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function dateStr(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function isoLocal(ymd: string, h: number, m: number): string {
  return `${ymd}T${pad(h)}:${pad(m)}:00`;
}

// ── ledger access (Redis Hash or in-process) ─────────────────────────────────

// Read the booked slotIds for a set of dates → Set of taken slotIds. One
// pipeline of HKEYS when on Redis; the in-process Map otherwise.
async function bookedSlotIds(dates: string[]): Promise<Set<string>> {
  const taken = new Set<string>();
  const redis = getSharedRedis();
  if (redis) {
    const pipe = redis.multi();
    for (const d of dates) pipe.hkeys(SLOTS_KEY(d));
    const results = (await pipe.exec()) as Array<string[] | null>;
    results.forEach((ids) => {
      (ids ?? []).forEach((id) => taken.add(id));
    });
  } else {
    for (const id of memBookings.keys()) taken.add(id);
  }
  return taken;
}

// Atomic claim of a single slot. Returns the leadId currently holding it
// (=== leadId on win, a different id when taken).
async function claimSlot(date: string, slotId: string, leadId: string): Promise<string> {
  const redis = getSharedRedis();
  if (redis) {
    const won = await redis.hsetnx(SLOTS_KEY(date), slotId, leadId);
    if (won === 1) {
      // Set the TTL once (NX) so a long-lived date Hash eventually evicts.
      await redis.expire(SLOTS_KEY(date), SLOTS_TTL_SECONDS, "NX");
      return leadId;
    }
    const holder = await redis.hget<string>(SLOTS_KEY(date), slotId);
    return holder ?? leadId;
  }
  // in-process: check-then-set is atomic in a single-writer dev process.
  const existing = memBookings.get(slotId);
  if (existing) return existing;
  memBookings.set(slotId, leadId);
  return leadId;
}

// ── public API ───────────────────────────────────────────────────────────────

export async function generateSlots(
  fromDate: Date,
  windowDays: number = SERVE_WINDOW_DAYS,
): Promise<SlotOffer[]> {
  const start = firstWeekdayOnOrAfter(fromDate, FIRST_SERVE_WEEKDAY);
  const windowEnd = new Date(fromDate.getTime());
  windowEnd.setUTCDate(windowEnd.getUTCDate() + windowDays);

  const days: string[] = [];
  for (let dayOffset = 0; dayOffset < windowDays; dayOffset++) {
    const day = new Date(start.getTime());
    day.setUTCDate(start.getUTCDate() + dayOffset);
    if (day.getTime() >= windowEnd.getTime()) break;
    days.push(dateStr(day));
  }

  const taken = await bookedSlotIds(days);

  const offers: SlotOffer[] = [];
  for (const ymd of days) {
    for (let i = 0; i < SLOTS_PER_DAY && i < WINDOWS.length; i++) {
      const w = WINDOWS[i]!;
      const slotId = `${ymd}-T${i + 1}`;
      offers.push({
        slotId,
        date: ymd,
        startTime: isoLocal(ymd, w.start[0], w.start[1]),
        endTime: isoLocal(ymd, w.end[0], w.end[1]),
        crewSize: 2,
        available: !taken.has(slotId),
      });
    }
  }
  return offers;
}

export async function availableSlots(
  _leadId: string,
  fromDate: Date = new Date(),
): Promise<SlotOffer[]> {
  return (await generateSlots(fromDate)).filter((s) => s.available);
}

export type BookResult =
  | { ok: true; slot: SlotOffer }
  | { ok: false; reason: "taken" | "out_of_window" | "lead_missing" };

export async function bookSlot(
  leadId: string,
  slotId: string,
  fromDate: Date = new Date(),
): Promise<BookResult> {
  if (!(await getLead(leadId))) return { ok: false, reason: "lead_missing" };

  const slot = (await generateSlots(fromDate)).find((s) => s.slotId === slotId);
  if (!slot) return { ok: false, reason: "out_of_window" };

  // Atomic claim — the FIRST write of booking, before any lead upsert (todo 1
  // double-book guard / S8). Whoever wins HSETNX holds the slot; a different
  // holder → taken.
  const holder = await claimSlot(slot.date, slotId, leadId);
  if (holder !== leadId) return { ok: false, reason: "taken" };

  // Idempotent: same (lead, slot) twice → still ok (claim is a no-op on repeat).
  await actionSeen(leadId, "book_slot", { slotId });
  return { ok: true, slot: { ...slot, available: false } };
}

export async function noSlotsInWindow(fromDate: Date = new Date()): Promise<boolean> {
  return (await availableSlots("__probe__", fromDate)).length === 0;
}
