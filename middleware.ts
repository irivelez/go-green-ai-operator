// Owner auth gate (todo 4 — spec §A.6).
//
// INVERTED matcher (Oracle Fix8): default-INCLUDE every route, explicit-EXCLUDE
// the public list. An opt-in include list silently fails OPEN when a new owner
// route ships and nobody remembers to add it — so we gate everything and carve
// out the known-public paths instead. New owner routes are protected by default.
//
// PUBLIC (excluded): the customer funnel + webhooks + the login route + cron
// (cron carries its own CRON_SECRET bearer). GATED (everything else): the
// dashboard `/`, `/api/leads/*`, all HITL routes, and `/api/operator` (the
// legacy owner/deterministic operator — Momus N2: guard it).
//
// Runs on the Edge runtime → auth uses Web Crypto (src/auth.ts), never node:crypto.

import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/src/auth";

// Path prefixes that stay public. Matched by startsWith on the pathname.
const PUBLIC_PREFIXES = [
  "/login",
  "/agent",
  // Customer-facing staged funnel + the Stripe success/cancel landing pages. These
  // page routes read NO owner/lead-list data; a freshly-paid customer is redirected
  // here by Stripe's success_url and must NOT hit the owner login wall.
  "/funnel",
  "/api/funnel",
  "/api/stripe/webhook",
  "/api/telegram/webhook",
  "/api/owner/login",
  "/api/cron",
  // Next internals + static assets.
  "/_next",
  "/favicon",
  "/icon",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const secret = process.env.OWNER_SESSION_SECRET;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token, secret ?? "");
  if (session) return NextResponse.next();

  // API routes get a 401 JSON; page routes redirect to the login screen.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Run on everything except static files with an extension and _next internals.
  // The isPublic() check inside does the real exclusion; this matcher is just a
  // perf pre-filter so middleware doesn't run on every asset.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
