import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runOperator } from "@/src/operator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  lead_id: z.string().optional(),
  channel: z.enum(["telegram", "email", "whatsapp", "form"]).optional(),
  name: z.string().optional(),
  text: z.string().min(1),
  has_photo: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  const b = parsed.data;
  const lead_id = b.lead_id ?? `web-${Date.now().toString(36)}`;
  const result = await runOperator({
    lead_id,
    channel: b.channel ?? "form",
    name: b.name,
    text: b.text,
    has_photo: b.has_photo,
  });
  return NextResponse.json(result);
}
