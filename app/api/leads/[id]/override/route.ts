import { NextRequest, NextResponse } from "next/server";
import { handleOverride, type OverrideBody } from "@/src/hitl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as OverrideBody | null;
  if (!body) return NextResponse.json({ ok: false, error: "missing body" }, { status: 400 });
  const result = handleOverride(id, body);
  if (!result.ok) {
    const status = result.error === "not found" ? 404 : 400;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, event: result.event });
}
