import { NextRequest, NextResponse } from "next/server";
import { listEvents } from "@/src/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json({ events: await listEvents(id) });
}
