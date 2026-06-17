import { NextRequest, NextResponse } from "next/server";
import { handleReject, type OwnerActionBody } from "@/src/hitl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as OwnerActionBody;
  const result = handleReject(id, body ?? {});
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json({ lead: result.lead });
}
