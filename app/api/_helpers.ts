// Shared route-body boilerplate: read JSON, validate against a zod schema, and
// emit a 400 on failure. The empty-body fallback and the 400-envelope shape
// DIFFER per route (operator/approve/reject use { error, issues }; override uses
// { ok:false, error, issues }; empty-body tolerance is approve/reject-only), so
// both are PARAMETERS here, not hard-coded — keep each route byte-identical.

import { NextResponse } from "next/server";
import type { z } from "zod";
import { OwnerActionSchema, type OwnerActionBody, type HandlerResult } from "@/src/hitl";

interface WithBodyOptions<T extends z.ZodTypeAny> {
  schema: T;
  // What req.json() falls back to when the body is absent/unparseable.
  // approve/reject pass {} (empty-body tolerant); operator/override pass null.
  emptyBody: unknown;
  // Builds the 400 response body from the validation issues. Lets the override
  // route prepend `ok: false` while the others stay { error, issues }.
  invalid: (issues: z.ZodError["issues"]) => unknown;
  // approve/reject originally validated `json ?? {}`, so a literal-null JSON body
  // (req.json() → null, catch never fires) coalesced to {} and PASSED. operator
  // and override had no such guard. Opt-in to keep that asymmetry byte-faithful.
  coalesceNull?: boolean;
}

type WithBodyResult<T extends z.ZodTypeAny> = { ok: true; data: z.infer<T> } | { ok: false; response: NextResponse };

// Parse + validate a request body, returning either the typed data or a ready
// 400 NextResponse. Callers branch on `ok`.
export async function withBody<T extends z.ZodTypeAny>(
  req: Request,
  { schema, emptyBody, invalid, coalesceNull }: WithBodyOptions<T>,
): Promise<WithBodyResult<T>> {
  const json = await req.json().catch(() => emptyBody);
  const parsed = schema.safeParse(coalesceNull ? (json ?? emptyBody) : json);
  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json(invalid(parsed.error.issues), { status: 400 }),
    };
  }
  return { ok: true, data: parsed.data };
}

// Approve and reject share the exact same shape — empty-body-tolerant
// OwnerActionSchema, a { error, issues } 400, a 404 on not-found, and a
// { lead } success — differing only in the handler. Factor that shape so each
// route is a one-liner; the handler (handleApprove / handleReject) is the only
// thing that varies.
export function ownerActionRoute(handler: (id: string, body: OwnerActionBody) => Promise<HandlerResult>) {
  return async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const body = await withBody(req, {
      schema: OwnerActionSchema,
      emptyBody: {},
      coalesceNull: true,
      invalid: (issues) => ({ error: "invalid body", issues }),
    });
    if (!body.ok) return body.response;
    const result = await handler(id, body.data);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
    return NextResponse.json({ lead: result.lead });
  };
}
