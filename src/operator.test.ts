// Operator conversation proof — no keys needed (template reply path).
// Drives the serverless brain through every branch the dashboard exercises.

import { resetStore } from "./store";
import { runOperator } from "./operator";

resetStore([]);

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

async function main() {
  console.log("\n=== Conversation 1: A-lead intake → price → book ===");
  const r1 = await runOperator({
    lead_id: "C1", channel: "telegram", name: "Dana",
    text: "Hi! I'd like biweekly maintenance for my place at 742 Valencia St, San Francisco 94110",
    has_photo: true,
  });
  ok("offered slots", r1.decision.intent === "offer_slots", r1.decision.stage);
  ok("priced a real band", !!r1.decision.price_range && r1.decision.price_range.high > r1.decision.price_range.low, JSON.stringify(r1.decision.price_range));
  ok("reply mentions a range", /\$\d+/.test(r1.reply));

  const r2 = await runOperator({ lead_id: "C1", channel: "telegram", text: "the first one works" });
  ok("booked → work order", r2.decision.stage === "Work Order Created", r2.decision.intent);
  ok("booked slot recorded", !!r2.decision.booked_slot);

  console.log("\n=== Conversation 2: HOA → escalation ===");
  const r3 = await runOperator({ lead_id: "C2", channel: "email", name: "Tom", text: "Our HOA needs weekly service for the common areas at 1200 Gough St 94109" });
  ok("escalated", r3.decision.escalated && r3.decision.stage === "Needs Human Review", r3.decision.escalation_reasons.join(","));

  console.log("\n=== Conversation 3: out of area → not a fit ===");
  const r4 = await runOperator({ lead_id: "C3", channel: "form", text: "monthly service for 120 Hillside Blvd, Daly City 94015" });
  ok("declined out-of-area", r4.decision.stage === "Not a Fit", r4.decision.intent);

  console.log("\n=== Conversation 4: incomplete → collect info ===");
  const r5 = await runOperator({ lead_id: "C4", channel: "telegram", name: "Olivia", text: "hi do you do garden maintenance?" });
  ok("asks for missing info", r5.decision.intent === "collect_info", r5.decision.missing.join(","));
  ok("reply is the warm intake", /Go Green Landscape/.test(r5.reply));

  console.log("\n=== Conversation 5: Spanish A-lead ===");
  const r6 = await runOperator({ lead_id: "C5", channel: "whatsapp", name: "Carlos", text: "Hola, necesito mantenimiento quincenal para 4127 18th St, San Francisco 94114", has_photo: true });
  ok("responds in Spanish", /Gracias|disponibilidad|jardín|recomendamos/i.test(r6.reply), r6.decision.language);
  ok("priced + offered", r6.decision.intent === "offer_slots" && !!r6.decision.price_range);

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
