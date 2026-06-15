// Slot generation + booking + waitlist gate (BUILD-DECISIONS §D1/§D2).
// Pure date math (no date library). 4 slots/day starting the first Thursday
// on/after fromDate, across a 14-day serve window. Bookings ledger is an
// in-memory Map by default, with optional JSON persistence via SLOTS_DB_PATH so
// it survives `npm run agent`. Idempotent booking via store.ts actionSeen.
//
// Timezone note: slotId dates + ISO strings are built from the LOCAL wall-clock
// of `fromDate` consistently (no offset suffix), so a fixed UTC-midnight input
// yields stable ids regardless of host TZ for the test's reference date.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  FIRST_SERVE_WEEKDAY,
  SERVE_WINDOW_DAYS,
  SLOTS_PER_DAY,
  type SlotOffer,
} from "./contract";
import { getLead, actionSeen } from "./store";

// Daily slot windows (local wall-clock). T1..T4.
const WINDOWS: Array<{ start: [number, number]; end: [number, number] }> = [
  { start: [8, 0], end: [10, 0] },
  { start: [10, 0], end: [12, 0] },
  { start: [13, 0], end: [15, 0] },
  { start: [15, 0], end: [17, 0] },
];

const pad = (n: number): string => n.toString().padStart(2, "0");

// ── bookings ledger ──────────────────────────────────────────────────────────
// slotId → leadId (whoever booked it first).
interface Ledger {
  bookings: Record<string, string>;
}

function loadLedger(): Ledger {
  const path = process.env.SLOTS_DB_PATH;
  if (!path) return memLedger;
  if (!existsSync(path)) return { bookings: {} };
  return JSON.parse(readFileSync(path, "utf8")) as Ledger;
}

function saveLedger(l: Ledger): void {
  const path = process.env.SLOTS_DB_PATH;
  if (!path) {
    memLedger = l;
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(l, null, 2));
}

let memLedger: Ledger = { bookings: {} };

export function resetSlots(): void {
  memLedger = { bookings: {} };
  const path = process.env.SLOTS_DB_PATH;
  if (path && existsSync(path)) saveLedger({ bookings: {} });
}

// ── date helpers ─────────────────────────────────────────────────────────────

// First weekday (e.g. Thu=4) on/after `from`, using the date's local fields,
// normalized to local midnight.
function firstWeekdayOnOrAfter(from: Date, weekday: number): Date {
  // Use UTC fields when the input is a UTC-midnight Date (test passes
  // new Date("...T00:00:00Z")); local + UTC midnight coincide on the date part
  // for that construction, and we read with getUTC* to stay deterministic.
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

// ── public API ───────────────────────────────────────────────────────────────

export function generateSlots(
  fromDate: Date,
  windowDays: number = SERVE_WINDOW_DAYS,
): SlotOffer[] {
  const start = firstWeekdayOnOrAfter(fromDate, FIRST_SERVE_WEEKDAY);
  const windowEnd = new Date(fromDate.getTime());
  windowEnd.setUTCDate(windowEnd.getUTCDate() + windowDays);

  const offers: SlotOffer[] = [];
  const ledger = loadLedger();

  for (let dayOffset = 0; dayOffset < windowDays; dayOffset++) {
    const day = new Date(start.getTime());
    day.setUTCDate(start.getUTCDate() + dayOffset);
    if (day.getTime() >= windowEnd.getTime()) break; // stay strictly inside window

    const ymd = dateStr(day);
    for (let i = 0; i < SLOTS_PER_DAY && i < WINDOWS.length; i++) {
      const w = WINDOWS[i]!;
      const slotId = `${ymd}-T${i + 1}`;
      offers.push({
        slotId,
        date: ymd,
        startTime: isoLocal(ymd, w.start[0], w.start[1]),
        endTime: isoLocal(ymd, w.end[0], w.end[1]),
        crewSize: 2,
        available: ledger.bookings[slotId] === undefined,
      });
    }
  }
  return offers;
}

export function availableSlots(
  _leadId: string,
  fromDate: Date = new Date(),
): SlotOffer[] {
  return generateSlots(fromDate).filter((s) => s.available);
}

export type BookResult =
  | { ok: true; slot: SlotOffer }
  | { ok: false; reason: "taken" | "out_of_window" | "lead_missing" };

export function bookSlot(
  leadId: string,
  slotId: string,
  fromDate: Date = new Date(),
): BookResult {
  if (!getLead(leadId)) return { ok: false, reason: "lead_missing" };

  const slot = generateSlots(fromDate).find((s) => s.slotId === slotId);
  if (!slot) return { ok: false, reason: "out_of_window" };

  const ledger = loadLedger();
  const existing = ledger.bookings[slotId];

  if (existing && existing !== leadId) return { ok: false, reason: "taken" };

  // Idempotent: same (lead, slot) twice → still ok, ledger unchanged.
  if (existing === leadId) {
    actionSeen(leadId, "book_slot", { slotId }); // record (no-op on repeat)
    return { ok: true, slot: { ...slot, available: false } };
  }

  ledger.bookings[slotId] = leadId;
  saveLedger(ledger);
  actionSeen(leadId, "book_slot", { slotId });
  return { ok: true, slot: { ...slot, available: false } };
}

export function noSlotsInWindow(fromDate: Date = new Date()): boolean {
  return availableSlots("__probe__", fromDate).length === 0;
}
