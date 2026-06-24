// Pure auth decision for the interim dashboard lock (go-live G4). The owner surfaces
// — the ops dashboard `/`, `/api/leads/*`, `/api/operator` — carry customer PII and
// HITL power but have NO real auth yet (full owner-session login is deferred; see
// notes/registries.md + AGENTS.md §1). This is HTTP Basic-auth against a shared
// OWNER_DASHBOARD_USER/PASS, wired in middleware.ts.
//
// When credentials are unset: ALLOW in local dev (the zero-key dev ethos) but FAIL
// CLOSED on Vercel — never silently expose customer PII because a deployer forgot to
// set them. The public funnel (/agent, /api/funnel/*) and the Stripe webhook are NOT
// gated (they must stay open); the middleware matcher excludes them.

export type AuthDecision = "allow" | "challenge" | "misconfigured";

export interface AuthConfig {
  authHeader: string | null;
  user: string | undefined;
  pass: string | undefined;
  isVercel: boolean;
}

export function dashboardAuthDecision({ authHeader, user, pass, isVercel }: AuthConfig): AuthDecision {
  if (!user || !pass) return isVercel ? "misconfigured" : "allow";
  if (!authHeader || !authHeader.startsWith("Basic ")) return "challenge";
  let decoded = "";
  try {
    decoded = atob(authHeader.slice("Basic ".length).trim());
  } catch {
    return "challenge";
  }
  const sep = decoded.indexOf(":");
  if (sep < 0) return "challenge";
  // Split on the FIRST colon only — passwords may contain colons.
  const u = decoded.slice(0, sep);
  const p = decoded.slice(sep + 1);
  return u === user && p === pass ? "allow" : "challenge";
}
