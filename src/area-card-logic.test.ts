// Unit test for the pure helper that decides whether the AreaConfirmCard hands
// the customer a pre-drawn polygon (a real DataSF parcel ring → one-tap confirm)
// or a blank canvas (no parcel match → customer draws). Browser-free; runs under tsx.
// Run: npx tsx src/area-card-logic.test.ts

import { pickInitialPath } from "./area-card-logic";

let pass = 0,
  fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

const sfParcelRing = [
  { lat: 37.7745, lng: -122.4198 },
  { lat: 37.7753, lng: -122.4198 },
  { lat: 37.7753, lng: -122.4190 },
  { lat: 37.7745, lng: -122.4190 },
];

console.log("\n=== pickInitialPath: real parcel ring → pre-drawn closed ring ===");
{
  const path = pickInitialPath(sfParcelRing);
  ok("returns >= 4 points (ring + close)", path.length >= 4, `got ${path.length}`);
  ok(
    "first === last (closed ring)",
    path.length >= 2 &&
      path[0]!.lat === path[path.length - 1]!.lat &&
      path[0]!.lng === path[path.length - 1]!.lng,
  );
  ok("preserves the real parcel vertices", path[0]!.lat === 37.7745 && path[0]!.lng === -122.4198);
}

console.log("\n=== pickInitialPath: empty ring → empty (customer draws) ===");
{
  ok("[] → []", pickInitialPath([]).length === 0);
}

console.log("\n=== pickInitialPath: degenerate (<3 points) → empty (customer draws) ===");
{
  const path = pickInitialPath([{ lat: 37.77, lng: -122.42 }, { lat: 37.78, lng: -122.41 }]);
  ok("returns []", path.length === 0, `got ${path.length}`);
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
process.exit(fail === 0 ? 0 : 1);
