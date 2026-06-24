// Secured daily GCal export cron (todo 18). Its own vercel.json line `0 7 * * *`
// (Momus S7: a dedicated cron is cleaner than the every-minute drain
// self-enqueueing). Secured by CRON_SECRET bearer; runs under withCronLock.

import { NextRequest, NextResponse } from "next/server";
import { withCronLock } from "@/src/cron-lock";
import { exportTodaysVisits } from "@/src/calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const lock = await withCronLock("gcal-export", () => exportTodaysVisits(), 90);
  return NextResponse.json({ ok: true, ran: lock.ran, result: lock.result ?? null });
}
