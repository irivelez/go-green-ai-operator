import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { runOperator } from "@/src/operator";
import { newWebLeadId } from "@/src/id";
import { withBody } from "@/app/api/_helpers";

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
  const body = await withBody(req, {
    schema: Body,
    emptyBody: null,
    invalid: (issues) => ({ error: "invalid body", issues }),
  });
  if (!body.ok) return body.response;
  const b = body.data;
  const lead_id = b.lead_id ?? newWebLeadId();
  const result = await runOperator({
    lead_id,
    channel: b.channel ?? "form",
    name: b.name,
    text: b.text,
    has_photo: b.has_photo,
  });
  return NextResponse.json(result);
}
