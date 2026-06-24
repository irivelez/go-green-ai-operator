# Runbook — Deploy to Vercel (live, tens of concurrent Meta-ad leads)

Take the funnel from "runs locally with zero keys" to a public, real-money deployment where tens of concurrent leads
run the full happy path — chat → validate address → measure → confirm area → price → **pay (live Stripe)** → **book**.

> **Scope of this build (go-live commits G1–G7).** What the code now enforces: a prod store guard, real-domain Stripe
> return + resume, rate-limiting, an interim dashboard lock, and security headers. What is still **deferred** (do NOT
> enable yet): full owner-session auth + per-owner isolation → so `CREW_CALENDAR_ENABLED` stays **off** (crew-calendar
> PII), plus the store same-lead atomic write, a CSP, and a captcha. See `notes/refactor-roadmap.md` (Go-live tracker).

---

## 0. Pre-flight gates (do these BEFORE opening ad spend — not code)

1. **Rate-card sign-off.** Live Stripe charges real customers the numbers in `src/pricing.ts` + `src/contract.ts`
   (`PRICE_BOOK`, area buckets, slope multipliers, frequency multipliers). spec §A.10 lists the rate card as *unratified*.
   **Go Green must confirm these are the agreed prices** before any live charge. This is a business gate, not a deploy step.
2. **Accounts ready:** a Vercel **Pro** plan (the agent route uses `maxDuration=60`, above the 10s free-tier cap); a
   Stripe **live** account; a Google Cloud project with **billing enabled**; a custom **domain** (Stripe + Meta want a
   real domain, and `APP_BASE_URL` must point at it); the Meta ad pointing at `https://<your-domain>/agent`.

---

## 1. Environment variables (set all in Vercel → Project → Settings → Environment Variables, "Production")

| Var | Required | Source / value | Notes |
|---|---|---|---|
| `STORE_BACKEND` | **yes** | `kv` | Anything else throws at boot on Vercel (`src/store.ts` guard). |
| `UPSTASH_REDIS_REST_URL` | **yes** | Upstash (Marketplace auto-injects) | Or the `KV_REST_API_URL` alias. |
| `UPSTASH_REDIS_REST_TOKEN` | **yes** | Upstash (Marketplace auto-injects) | Or `KV_REST_API_TOKEN`. |
| `ANTHROPIC_API_KEY` | **yes** | console.anthropic.com | Route returns 503 in prod without it (no silent fallback). |
| `ANTHROPIC_MODEL` | no | `claude-sonnet-4-5` (default) | Re-run `npm run eval` before changing (flow is prompt-locked). |
| `STRIPE_SECRET_KEY` | **yes** | Stripe (live) `sk_live_…` | A live key without `STRIPE_LIVE_OK=1` is refused at boot. |
| `STRIPE_LIVE_OK` | **yes** | `1` | The explicit "charge real money" switch. |
| `STRIPE_WEBHOOK_SECRET` | **yes** | Stripe webhook `whsec_…` | From the endpoint you register in §3. |
| `APP_BASE_URL` | **yes** | `https://<your-domain>` | Stripe success/cancel return here; leadId is appended for resume. |
| `OWNER_DASHBOARD_USER` | **yes** | you choose | Basic-auth for `/` + `/api/leads*` + `/api/operator`. |
| `OWNER_DASHBOARD_PASS` | **yes** | you choose (strong) | Unset on Vercel ⇒ dashboard returns 503 (fail-closed). |
| `GOOGLE_MAPS_API_KEY` | strongly rec. | Google Cloud (server key) | Address Validation + Elevation + Solar. IP/API restricted. |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | strongly rec. | Google Cloud (browser key) | Maps JS + Drawing/Geometry. **HTTP-referrer restricted to your domain.** |
| `SOCRATA_APP_TOKEN` | recommended | data.sfgov.org → App Tokens (free) | Anonymous DataSF throttles under concurrency. |
| `SERVICE_AREA_ZIPS` | no | code default (SF list) | Override only if the service area changes. |
| `LOT_COVERAGE_RATIO`, `AREA_CONFIDENCE_THRESHOLD` | no | code defaults (0.45 / 0.6) | Pricing calibration. |
| `CREW_CALENDAR_ENABLED` | **leave unset** | — | Deferred: crew-calendar PII until owner-session auth lands. Booking still works without it. |

> Without the Google keys the funnel still runs (address-validate + measure degrade to the customer-draw fallback,
> never throwing) — but accuracy drops, so set them for a real launch.

---

## 2. Provision the store (Upstash KV)

1. Vercel → Project → **Integrations / Storage** → add **Upstash Redis** (Marketplace). It injects
   `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` automatically.
2. Set `STORE_BACKEND=kv`.
3. (Optional) `vercel env pull` locally, then `STORE_BACKEND=kv npm run dev` and confirm a lead created in one request is
   readable in a second — this proves cross-invocation coherence (the whole webhook→booking flow depends on it).

## 3. Stripe (LIVE)

1. Set `STRIPE_SECRET_KEY=sk_live_…` and `STRIPE_LIVE_OK=1`.
2. Stripe Dashboard → **Developers → Webhooks → Add endpoint**: URL `https://<your-domain>/api/stripe/webhook`,
   event **`checkout.session.completed`**. Copy the signing secret (`whsec_…`) → `STRIPE_WEBHOOK_SECRET`.
3. The webhook is signature-verified and idempotent on `(lead_id, sessionId)`; it sets `paid_at`, which is the ONLY
   thing that unlocks `confirm_booking`.

## 4. Google + Socrata keys

1. Google Cloud (billing on): enable Address Validation, Maps Elevation, Solar, Maps JavaScript, Geometry.
2. **Server key** → `GOOGLE_MAPS_API_KEY`, restricted by API (+ ideally IP). **Browser key** →
   `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, **HTTP-referrer-restricted to your domain** (it's public in the page).
3. data.sfgov.org → App Tokens → `SOCRATA_APP_TOKEN`.

## 5. Domain + dashboard lock

1. Add the custom domain in Vercel; set `APP_BASE_URL=https://<your-domain>`.
2. Set `OWNER_DASHBOARD_USER` / `OWNER_DASHBOARD_PASS`. Verify the dashboard prompts for credentials in prod.

---

## 6. Deploy & smoke tests (before connecting the ad)

Push to the deployment branch (or `vercel --prod`). CI runs `lint → typecheck → test:all → build`. Then verify on the
live domain:

1. **One real sale (you).** Run the full funnel, pay with a **real card** (live mode), confirm the Stripe tab returns to
   `/agent?checkout=success&lead=…`, the chat resumes, `confirm_booking` succeeds, and the lead shows paid in the dashboard.
   Refund yourself in Stripe afterwards.
2. **FB/IG in-app browser** (the dominant Meta-ad surface). Open the ad link inside Instagram/Facebook on a phone, run
   the funnel, pay. Confirm the same-tab return resumes to booking (this is what G2's leadId-in-URL + resume protects).
3. **Webhook integrity.** Stripe Dashboard → "Send test event" with a bad signature → expect **400**; a valid
   `checkout.session.completed` → **200**.
4. **Dashboard is locked.** Hit `https://<your-domain>/` with no credentials → **401**; `/agent` → **open**.
5. **Rate limit.** Hammer `/api/funnel/agent` from one IP past ~30/10min → **429**.
6. **(Optional) Load smoke.** `scripts/load-smoke.mjs` at your target concurrency to confirm Google/DataSF/Anthropic
   quotas hold before spending on ads.

## 7. Go live

Point the Meta ad at `https://<your-domain>/agent`. Watch: Stripe payments, Vercel function logs/errors, Upstash
request volume, Google Maps + Anthropic spend. Raise Anthropic's rate limit if you expect >50 concurrent sessions.

## 8. Deferred (track in `notes/refactor-roadmap.md`)

Full owner-session auth + per-owner isolation (then enable `CREW_CALENDAR_ENABLED`); store same-lead atomic write
(Lua/WATCH — low risk while the funnel is sequential per lead); a tested CSP; reCAPTCHA/Turnstile; a per-token spend
budget. None block this launch.
