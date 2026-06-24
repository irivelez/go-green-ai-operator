import { NextRequest, NextResponse } from "next/server";
import { handleOverride, OverrideSchema } from "@/src/hitl";
import { withBody } from "@/app/api/_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await withBody(req, {
    schema: OverrideSchema,
    emptyBody: null,
    invalid: (issues) => ({ ok: false, error: "invalid body", issues }),
  });
  if (!body.ok) return body.response;
  const result = await handleOverride(id, body.data);
  if (!result.ok) {
    const status = result.error === "not found" ? 404 : 400;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, event: result.event });
}
