import { NextRequest, NextResponse } from "next/server";
import { getLead, upsertLead, type Lead } from "@/src/store";
import { tool_book_evaluation, tool_create_work_order } from "@/src/tools";
import { nextSlots } from "@/src/operator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lead = getLead(id);
  if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });

  const stamp = `[human] approved ${new Date().toISOString()}`;

  // Ready to Schedule + address → the human green-lights the booking; agent completes it.
  if (lead.status === "Ready to Schedule" && lead.address) {
    const slot = nextSlots()[0]!;
    const booked = tool_book_evaluation({ ...lead, address: lead.address } as never, slot);
    if (booked.ok) {
      const wo = tool_create_work_order(id);
      const updated = "lead_id" in wo ? (wo as Lead) : lead;
      return NextResponse.json({ lead: upsertLead({ lead_id: id, channel: updated.channel, internal_notes: `${lead.internal_notes ?? ""}\n${stamp} — booked.` }) });
    }
  }

  // Otherwise: clear the human-review flag and let the agent resume the standard flow.
  const updated = upsertLead({
    lead_id: id, channel: lead.channel,
    status: "Ready to Schedule",
    internal_notes: `${lead.internal_notes ?? ""}\n${stamp} — agent resumes.`,
  });
  return NextResponse.json({ lead: updated });
}
