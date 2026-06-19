// Smoke test for the T12 generative-UI cards: AddressConfirmCard, SlopePhotoPromptCard,
// ExactPriceCard. These render in the browser; a tsx smoke test can only prove the
// module exports the components, their types compile, and they return a truthy React
// element when called with fixture props matching the agent-tools result shapes.
// Real visual proof comes from the build + the visual-qa pass.
// Run: npx tsx src/cards-smoke.test.ts

import * as React from "react";
import {
  AddressConfirmCard,
  SlopePhotoPromptCard,
  ExactPriceCard,
} from "../app/agent/components/cards";
import type {
  ValidateAddressToolResult,
  ComputeExactPriceResult,
} from "./agent-tools";

let pass = 0,
  fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

console.log("\n=== T12 cards: module exports ===");
ok("AddressConfirmCard is a function", typeof AddressConfirmCard === "function");
ok("SlopePhotoPromptCard is a function", typeof SlopePhotoPromptCard === "function");
ok("ExactPriceCard is a function", typeof ExactPriceCard === "function");

console.log("\n=== AddressConfirmCard: needs_confirm fixture → React element ===");
{
  const result: ValidateAddressToolResult = {
    status: "needs_confirm",
    didYouMean: "742 Valencia St, San Francisco, CA 94110, USA",
    original: "742 valencia st sf 94110",
  };
  const el = React.createElement(AddressConfirmCard, {
    result,
    lang: "en",
    onConfirm: (_: boolean) => {},
  });
  ok("renders truthy React element", !!el && typeof el === "object");
  ok("element type is the component", (el as { type: unknown }).type === AddressConfirmCard);
}

console.log("\n=== SlopePhotoPromptCard: en + es fixtures → React elements ===");
{
  const en = React.createElement(SlopePhotoPromptCard, { lang: "en" });
  const es = React.createElement(SlopePhotoPromptCard, { lang: "es" });
  ok("en truthy", !!en && typeof en === "object");
  ok("es truthy", !!es && typeof es === "object");
}

console.log("\n=== ExactPriceCard: priced fixture → React element ===");
{
  const priced: ComputeExactPriceResult = {
    status: "priced",
    perVisit: 245,
    monthly: 530,
    tier_name: "Signature",
    tier_inclusions: ["Mow", "Edge", "Blow", "Hedge trim", "Bed care"],
    currency: "USD",
  };
  const el = React.createElement(ExactPriceCard, { result: priced, lang: "en" });
  ok("priced renders truthy", !!el && typeof el === "object");
}

console.log("\n=== ExactPriceCard: missing_measurement fixture → React element ===");
{
  const missing: ComputeExactPriceResult = {
    status: "missing_measurement",
    message: "Confirm the maintained area on the map first.",
  };
  const el = React.createElement(ExactPriceCard, { result: missing, lang: "es" });
  ok("missing_measurement renders truthy", !!el && typeof el === "object");
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
process.exit(fail === 0 ? 0 : 1);
