import { NextResponse } from "next/server";
import { allLeads } from "@/src/store";
import { computeKpis } from "@/src/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const leads = allLeads();
  return NextResponse.json({ leads, kpis: computeKpis(leads) });
}
