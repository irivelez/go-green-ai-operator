// Interim dashboard lock (go-live G4). HTTP Basic-auth over the owner surfaces only:
// the ops dashboard `/`, the leads API (`/api/leads*` — the all-leads PII list +
// approve/reject/override), and `/api/operator`. The PUBLIC funnel (`/agent`,
// `/api/funnel/*`) and the Stripe webhook (`/api/stripe/*`) are deliberately NOT
// matched — they must stay open. Full owner-session auth is deferred; this closes
// the anonymous-PII / state-tamper hole in the meantime. Decision logic +
// fail-closed-on-Vercel rationale live in src/dashboard-auth.ts (unit-tested).

import { NextResponse, type NextRequest } from "next/server";
import { dashboardAuthDecision } from "@/src/dashboard-auth";

export const config = {
  matcher: ["/", "/api/leads", "/api/leads/:path*", "/api/operator", "/api/operator/:path*"],
};

export function middleware(req: NextRequest) {
  const decision = dashboardAuthDecision({
    authHeader: req.headers.get("authorization"),
    user: process.env.OWNER_DASHBOARD_USER,
    pass: process.env.OWNER_DASHBOARD_PASS,
    isVercel: !!process.env.VERCEL,
  });

  if (decision === "allow") return NextResponse.next();

  if (decision === "misconfigured") {
    return new NextResponse(
      "Dashboard auth not configured. Set OWNER_DASHBOARD_USER + OWNER_DASHBOARD_PASS in the Vercel project.",
      { status: 503 },
    );
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Go Green Ops", charset="UTF-8"' },
  });
}
