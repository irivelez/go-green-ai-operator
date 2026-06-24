import { NextRequest, NextResponse } from "next/server";
import { listEvents } from "@/src/store";
import { isAuthorizedOwnerRequest } from "@/src/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorizedOwnerRequest(req.headers.get("cookie")))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  return NextResponse.json({ events: await listEvents(id) });
}
