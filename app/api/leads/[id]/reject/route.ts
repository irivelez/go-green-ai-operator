import { NextRequest, NextResponse } from "next/server";
import { getLead, upsertLead } from "@/src/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lead = getLead(id);
  if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });

  const updated = upsertLead({
    lead_id: id, channel: lead.channel,
    status: "Not a Fit",
    internal_notes: `${lead.internal_notes ?? ""}\n[human] declined ${new Date().toISOString()}.`,
  });
  return NextResponse.json({ lead: updated });
}
