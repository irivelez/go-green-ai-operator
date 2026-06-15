// MOCK — replaced in S6 (real scheduler / Airtable availability lookup).
// Generates SLOTS_PER_DAY * SERVE_WINDOW_DAYS slots starting on the next
// FIRST_SERVE_WEEKDAY. Escape hatch: ?mock=no-slots → empty list → waitlist surface.

import { NextRequest, NextResponse } from "next/server";
import {
  FIRST_SERVE_WEEKDAY,
  SERVE_WINDOW_DAYS,
  SLOTS_PER_DAY,
  type SlotOffer,
} from "@/src/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Slot windows in America/Los_Angeles.
const WINDOWS: Array<{ start: [number, number]; end: [number, number] }> = [
  { start: [8, 0], end: [11, 0] },
  { start: [11, 0], end: [14, 0] },
  { start: [14, 0], end: [17, 0] },
  { start: [17, 0], end: [19, 0] },
];

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function nextWeekday(from: Date, weekday: number): Date {
  const d = new Date(from);
  const diff = (weekday - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isoLocal(date: Date, h: number, m: number): string {
  // Treat as America/Los_Angeles wall-clock; we render a -07:00 offset for
  // demo determinism. Real slot times come from the scheduler in S6.
  const y = date.getFullYear();
  const mo = pad(date.getMonth() + 1);
  const da = pad(date.getDate());
  return `${y}-${mo}-${da}T${pad(h)}:${pad(m)}:00-07:00`;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const mock = url.searchParams.get("mock");

  if (mock === "no-slots") {
    const empty: SlotOffer[] = [];
    return NextResponse.json(empty);
  }

  const now = new Date();
  const start = nextWeekday(now, FIRST_SERVE_WEEKDAY);
  const offers: SlotOffer[] = [];

  for (let dayOffset = 0; dayOffset < SERVE_WINDOW_DAYS; dayOffset++) {
    const day = new Date(start);
    day.setDate(start.getDate() + dayOffset);
    const y = day.getFullYear();
    const mo = pad(day.getMonth() + 1);
    const da = pad(day.getDate());
    const dateStr = `${y}-${mo}-${da}`;

    for (let i = 0; i < SLOTS_PER_DAY && i < WINDOWS.length; i++) {
      const w = WINDOWS[i]!;
      offers.push({
        slotId: `${dateStr}-T${i + 1}`,
        date: dateStr,
        startTime: isoLocal(day, w.start[0], w.start[1]),
        endTime: isoLocal(day, w.end[0], w.end[1]),
        crewSize: 2,
        available: true,
      });
    }
  }

  return NextResponse.json(offers);
}
