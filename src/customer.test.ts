// Proof driver — email-PK Customer store (todo 2).
// Hermetic: resetCustomers() at the top of every scenario.
// Run: npx tsx src/customer.test.ts

import {
  materializeCustomer,
  lookupCustomerByEmail,
  canonicalEmail,
  resetCustomers,
} from "./customer";

let pass = 0,
  fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

async function main() {
  console.log("\n=== Customer 1: materialize → lookup round-trip ===");
  {
    resetCustomers();
    await materializeCustomer("dana@example.com", {
      address: "742 Valencia St, SF 94110",
      sqft: 2500,
      slope: "flat",
      status: "active",
    });
    const c = await lookupCustomerByEmail("dana@example.com");
    ok("customer found", !!c, JSON.stringify(c));
    ok("address persisted", c?.address === "742 Valencia St, SF 94110", c?.address);
    ok("sqft persisted as number", c?.sqft === 2500, String(c?.sqft));
    ok("slope persisted", c?.slope === "flat", c?.slope);
  }

  console.log("\n=== Customer 2: email canonicalization collapses to one key ===");
  {
    resetCustomers();
    await materializeCustomer("A@Gmail.com ", { address: "1 First St", status: "active" });
    const viaCanonical = await lookupCustomerByEmail("a@gmail.com");
    const viaDots = await lookupCustomerByEmail("a.@gmail.com");
    ok("'A@Gmail.com ' canonicalizes to a@gmail.com", canonicalEmail("A@Gmail.com ") === "a@gmail.com");
    ok("trailing-space + case collapse to one record", viaCanonical?.address === "1 First St", JSON.stringify(viaCanonical));
    ok("gmail dot variant maps to the same record", viaDots?.address === "1 First St", JSON.stringify(viaDots));
  }

  console.log("\n=== Customer 3: gmail +tag stripped, other-domain dots significant ===");
  {
    ok("gmail +tag stripped", canonicalEmail("dana+ads@gmail.com") === "dana@gmail.com");
    ok("gmail dots stripped", canonicalEmail("d.a.n.a@gmail.com") === "dana@gmail.com");
    ok("non-gmail +tag stripped, dots kept", canonicalEmail("a.b+x@fastmail.com") === "a.b@fastmail.com");
  }

  console.log("\n=== Customer 4: overwrite address in place (flat model, AG5) ===");
  {
    resetCustomers();
    await materializeCustomer("mover@example.com", { address: "old addr", status: "active" });
    await materializeCustomer("mover@example.com", { address: "new addr" });
    const c = await lookupCustomerByEmail("mover@example.com");
    ok("address overwritten in place", c?.address === "new addr", c?.address);
  }

  console.log("\n=== Customer 5: unknown email → undefined ===");
  {
    resetCustomers();
    const c = await lookupCustomerByEmail("nobody@x.com");
    ok("lookup of unknown email returns undefined", c === undefined, String(c));
  }

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail === 0 ? 0 : 1);
}
void main();
