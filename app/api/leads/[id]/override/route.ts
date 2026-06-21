import { NextRequest, NextResponse } from "next/server";
import { handleOverride, OverrideSchema } from "@/src/hitl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const json = await req.json().catch(() => null);
  const parsed = OverrideSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const result = await handleOverride(id, parsed.data);
  if (!result.ok) {
    const status = result.error === "not found" ? 404 : 400;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, event: result.event });
}
