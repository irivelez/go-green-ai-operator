import { NextRequest, NextResponse } from "next/server";
import { handleReject, OwnerActionSchema } from "@/src/hitl";
import { isAuthorizedOwnerRequest } from "@/src/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorizedOwnerRequest(req.headers.get("cookie")))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const json = await req.json().catch(() => ({}));
  const parsed = OwnerActionSchema.safeParse(json ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const result = await handleReject(id, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json({ lead: result.lead });
}
