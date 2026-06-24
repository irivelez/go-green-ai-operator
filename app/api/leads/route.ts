import { NextRequest, NextResponse } from "next/server";
import { allLeads } from "@/src/store";
import { computeKpis } from "@/src/metrics";
import { isAuthorizedOwnerRequest } from "@/src/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isAuthorizedOwnerRequest(req.headers.get("cookie")))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const leads = await allLeads();
  return NextResponse.json({ leads, kpis: computeKpis(leads) });
}
