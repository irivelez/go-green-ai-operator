// Secured cron drainer (todo 14). Vercel Cron hits this every minute (Pro) /
// daily (Hobby). Secured by a CRON_SECRET bearer per Vercel docs; runs the queue
// drain under withCronLock so two overlapping invocations can't double-process.

import { NextRequest, NextResponse } from "next/server";
import { withCronLock } from "@/src/cron-lock";
import { drainQueue } from "@/src/queue";
import { registerAllHandlers } from "@/src/job-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // unconfigured → refuse (never run open)
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  registerAllHandlers();
  // TTL = maxDuration (60) + 30s slack; intentionally exceeds the 60s cron tick
  // so a still-running drain holds the lock past the next tick (no overlap).
  const lock = await withCronLock("drain", () => drainQueue(), 90);
  return NextResponse.json({ ok: true, ran: lock.ran, result: lock.result ?? null });
}
