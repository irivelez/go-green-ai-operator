// Eyeball the add-on catalog classification.
// Run: tsx src/contract.print.ts

import {
  PRICE_BOOK,
  FREQUENCY_MULTIPLIER,
  monthlyFromVisit,
  ADD_ON_CATALOG,
  fixedAddOns,
  openEndedAddOnsList,
  CLEANUP_GATING_ADDON_ID,
  SLOTS_PER_DAY,
  SERVE_WINDOW_DAYS,
  FIRST_SERVE_WEEKDAY,
} from "./contract";

const HR = "─".repeat(78);
const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n);

console.log(HR);
console.log("GO GREEN — SHARED CONTRACT (src/contract.ts)");
console.log(HR);

// Tiers
console.log("\n# TIERS (flat per-visit — BUILD-DECISIONS §2)");
for (const t of Object.values(PRICE_BOOK)) {
  console.log(`  ${pad(t.name, 20)} $${t.perVisit}/visit`);
}

// Subscription math (sample)
console.log("\n# SUBSCRIPTION MATH (monthly = perVisit × freq multiplier)");
for (const [f, m] of Object.entries(FREQUENCY_MULTIPLIER)) {
  console.log(`  ${pad(f, 10)} × ${m.toFixed(2).padStart(5)}`);
}
console.log("\n  Sample monthlies:");
const tiers = ["essential", "signature", "estate"] as const;
const freqs = ["weekly", "biweekly", "monthly"] as const;
console.log(`  ${pad("", 14)}${freqs.map((f) => pad(f, 14)).join("")}`);
for (const tier of tiers) {
  const row = freqs.map((f) => pad(`$${monthlyFromVisit(tier, f).toFixed(2)}`, 14)).join("");
  console.log(`  ${pad(tier, 14)}${row}`);
}

// Slot model
console.log("\n# SLOT MODEL (BUILD-DECISIONS §D1/§D2)");
console.log(`  ${SLOTS_PER_DAY} slots/day · first weekday = ${FIRST_SERVE_WEEKDAY} (Thu)`);
console.log(`  Serve window N = ${SERVE_WINDOW_DAYS} days → no slot in window → WAITLIST (no charge)`);

// Add-on catalog
const fixed = fixedAddOns();
const open = openEndedAddOnsList();

console.log(`\n# ADD-ON CATALOG — ${ADD_ON_CATALOG.length} total`);
console.log(`  Fixed (checkout-eligible): ${fixed.length}`);
console.log(`  Open-ended (human quote, NO auto-charge): ${open.length}`);
console.log(`  Cleanup gating add-on (§B2): "${CLEANUP_GATING_ADDON_ID}"`);

// Group by category
const cats = Array.from(new Set(ADD_ON_CATALOG.map((a) => a.category)));
for (const cat of cats) {
  console.log(`\n  ── ${cat} ──`);
  for (const a of ADD_ON_CATALOG.filter((x) => x.category === cat)) {
    const kind = a.kind === "fixed" ? "FIX" : "OPN";
    const price = `$${a.priceStartingAt}`;
    console.log(
      `    [${kind}] ${pad(a.name, 38)} ${pad(price, 7)} ${pad(a.unit, 18)}` +
        (a.openEndedReason ? `  // ${a.openEndedReason}` : ""),
    );
  }
}

// Open-ended explicit roll-up
console.log("\n# OPEN-ENDED (flagged — never auto-charge)");
for (const a of open) {
  console.log(`  - ${pad(a.name, 28)} $${a.priceStartingAt} ${pad(a.unit, 16)}  → ${a.openEndedReason}`);
}

console.log(`\n${HR}`);
console.log("Counts: fixed=" + fixed.length + " open=" + open.length + " total=" + ADD_ON_CATALOG.length);
console.log(HR);
