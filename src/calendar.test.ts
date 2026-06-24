// Crew calendar handoff test — validates key-guard + payload builder for Google Calendar push.
// Spec: §A.5 — crew endpoint via Google Calendar event (Composio GOOGLECALENDAR_CREATE_EVENT).
// Hermetic: no real Composio calls. Run: npx tsx src/calendar.test.ts

import { createCrewEvent, buildCrewEventPayload, exportTodaysVisits } from "./calendar";
import { resetStore, upsertLead, actionSeen } from "./store";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

const baseInput = {
  lead_id: "L1",
  address: "742 Valencia St, San Francisco, CA 94110",
  sqft: 2400,
  slope_tier: "moderate" as const,
  tier_name: "Signature Care",
  start_iso: "2026-06-15T15:00:00-07:00",
  end_iso: "2026-06-15T17:00:00-07:00",
  access_notes: "Side gate code 4242",
  paid: true,
};

async function main() {
  console.log("\n=== buildCrewEventPayload — shape ===");
  {
    const p = buildCrewEventPayload(baseInput);
    ok("summary contains tier_name", p.summary.includes("Signature Care"), p.summary);
    ok("summary uses short address (first comma segment)",
      p.summary.includes("742 Valencia St") && !p.summary.includes("94110"), p.summary);
    ok("summary begins with brand prefix", p.summary.startsWith("Go Green — "), p.summary);
    ok("description contains sqft", p.description.includes("2400"), p.description);
    ok("description contains slope_tier", p.description.includes("moderate"), p.description);
    ok("description contains tier_name", p.description.includes("Signature Care"));
    ok("description contains full address", p.description.includes("742 Valencia St, San Francisco, CA 94110"));
    ok("description contains access_notes", p.description.includes("Side gate code 4242"));
    ok("description marks PAID when paid=true", p.description.includes("PAID") && !p.description.includes("UNPAID"));
    ok("start.dateTime matches input", p.start.dateTime === "2026-06-15T15:00:00-07:00");
    ok("end.dateTime matches input", p.end.dateTime === "2026-06-15T17:00:00-07:00");
    ok("start.timeZone is America/Los_Angeles", p.start.timeZone === "America/Los_Angeles");
    ok("end.timeZone is America/Los_Angeles", p.end.timeZone === "America/Los_Angeles");
    ok("location is full address", p.location === "742 Valencia St, San Francisco, CA 94110");
  }

  console.log("\n=== buildCrewEventPayload — unpaid path ===");
  {
    const p = buildCrewEventPayload({ ...baseInput, paid: false });
    ok("description marks UNPAID when paid=false", p.description.includes("UNPAID"), p.description);
  }

  console.log("\n=== buildCrewEventPayload — no access_notes ===");
  {
    const { access_notes: _omit, ...rest } = baseInput;
    void _omit;
    const p = buildCrewEventPayload(rest);
    ok("description still contains required fields without access_notes",
      p.description.includes("2400") && p.description.includes("moderate") && p.description.includes("Signature Care"));
    ok("description never includes literal 'undefined'", !p.description.includes("undefined"), p.description);
  }

  console.log("\n=== createCrewEvent — key-guard: no COMPOSIO_API_KEY ===");
  {
    delete process.env.COMPOSIO_API_KEY;
    process.env.GOOGLE_CALENDAR_ID = "cal_test_id";
    let threw = false;
    let res: { ok: boolean; reason?: string; eventId?: string } = { ok: true };
    try {
      res = await createCrewEvent(baseInput);
    } catch {
      threw = true;
    }
    ok("never throws when COMPOSIO_API_KEY missing", !threw);
    ok("returns ok:false when COMPOSIO_API_KEY missing", res.ok === false);
    ok("reason:unconfigured when COMPOSIO_API_KEY missing", res.reason === "unconfigured", res.reason);
  }

  console.log("\n=== createCrewEvent — key-guard: no GOOGLE_CALENDAR_ID ===");
  {
    process.env.COMPOSIO_API_KEY = "stub-key";
    delete process.env.GOOGLE_CALENDAR_ID;
    let threw = false;
    let res: { ok: boolean; reason?: string; eventId?: string } = { ok: true };
    try {
      res = await createCrewEvent(baseInput);
    } catch {
      threw = true;
    }
    ok("never throws when GOOGLE_CALENDAR_ID missing", !threw);
    ok("returns ok:false when GOOGLE_CALENDAR_ID missing", res.ok === false);
    ok("reason:unconfigured when GOOGLE_CALENDAR_ID missing", res.reason === "unconfigured", res.reason);
  }

  console.log("\n=== createCrewEvent — key-guard: both missing ===");
  {
    delete process.env.COMPOSIO_API_KEY;
    delete process.env.GOOGLE_CALENDAR_ID;
    const res = await createCrewEvent(baseInput);
    ok("returns ok:false+unconfigured when both missing", res.ok === false && res.reason === "unconfigured");
  }

  console.log("\n=== exportTodaysVisits — one-way export, idempotent, gated ===");
  {
    // Gate DISABLED (CREW_CALENDAR_ENABLED!=1) → createCrewEvent returns
    // {disabled}; export treats that as a clean no-op: NOT counted exported, NOT
    // skipped-to-report, and crucially NOT marked seen — so a future cron retries
    // once the gate flips (Oracle S1: marking-before-success permanently skipped).
    delete process.env.CREW_CALENDAR_ENABLED;
    process.env.COMPOSIO_API_KEY = "stub";
    process.env.GOOGLE_CALENDAR_ID = "cal_x";
    resetStore([]);
    const today = new Date();
    today.setHours(15, 0, 0, 0);
    const visitIso = today.toISOString();
    await upsertLead({
      lead_id: "GX1",
      channel: "form",
      status: "BOOKED",
      visit_at: visitIso,
      address: "1 Test St, SF",
      work_order: { slotId: `${visitIso}-T1`, window: `${visitIso}–${visitIso}` },
    });
    // A non-today BOOKED visit must be excluded.
    await upsertLead({
      lead_id: "GX2",
      channel: "form",
      status: "BOOKED",
      visit_at: new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString(),
      address: "2 Future St, SF",
    });
    const r1 = await exportTodaysVisits();
    ok("gate-disabled export is a clean no-op (0 exported, 0 skipped)", r1.exported === 0 && r1.skipped === 0, JSON.stringify(r1));
    // S1: a gated/failed export did NOT mark the visit seen, so a future run
    // (once the gate flips) still attempts it — it is NOT permanently skipped.
    const r2 = await exportTodaysVisits();
    ok("gated visit NOT permanently marked seen (retryable next run)", r2.exported === 0 && r2.skipped === 0, JSON.stringify(r2));
  }

  console.log("\n=== S4: read-only pre-check skips an already-exported visit (no duplicate event) ===");
  {
    // Simulate a visit that was already exported in a prior run by pre-seeding the
    // gcal_export action ledger. The pre-check (actionAlreadySeen) must skip it
    // BEFORE calling createCrewEvent — else a re-run would create a DUPLICATE event.
    process.env.CREW_CALENDAR_ENABLED = "1";
    process.env.COMPOSIO_API_KEY = "stub";
    process.env.GOOGLE_CALENDAR_ID = "cal_x";
    resetStore([]);
    const today = new Date();
    today.setHours(15, 0, 0, 0);
    const visitIso = today.toISOString();
    const slotId = `${visitIso}-T1`;
    await upsertLead({
      lead_id: "GX3",
      channel: "form",
      status: "BOOKED",
      visit_at: visitIso,
      address: "3 Test St, SF",
      work_order: { slotId, window: `${visitIso}–${visitIso}` },
    });
    // Mark it already-exported (a prior successful run).
    await actionSeen("GX3", "gcal_export", slotId);
    const r = await exportTodaysVisits();
    ok("already-exported visit is skipped before any create (no duplicate)", r.exported === 0 && r.skipped === 1, JSON.stringify(r));
    delete process.env.CREW_CALENDAR_ENABLED;
    delete process.env.COMPOSIO_API_KEY;
    delete process.env.GOOGLE_CALENDAR_ID;
  }

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
