// Unit test for the pure helper that decides whether the AreaConfirmCard hands
// the customer a pre-drawn polygon (high confidence + valid roof bbox) or a
// blank canvas (low confidence / no bbox). Browser-free; runs under tsx.
// Run: npx tsx src/area-card-logic.test.ts

import { pickInitialPath } from "./area-card-logic";

let pass = 0,
  fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

const sfBbox = {
  sw: { lat: 37.7745, lng: -122.4198 },
  ne: { lat: 37.7753, lng: -122.4190 },
};

console.log("\n=== pickInitialPath: high confidence + roof_bbox → pre-drawn 5-point closed ring ===");
{
  const path = pickInitialPath(sfBbox, 0.8, 0.6);
  ok("returns 5 points", path.length === 5, `got ${path.length}`);
  ok(
    "first === last (closed ring)",
    path.length >= 2 &&
      path[0]!.lat === path[path.length - 1]!.lat &&
      path[0]!.lng === path[path.length - 1]!.lng,
  );
  // Sanity: vertices straddle the bbox center.
  const cLat = (sfBbox.sw.lat + sfBbox.ne.lat) / 2;
  const cLng = (sfBbox.sw.lng + sfBbox.ne.lng) / 2;
  const someWest = path.some((p) => p.lng < cLng);
  const someEast = path.some((p) => p.lng > cLng);
  const someSouth = path.some((p) => p.lat < cLat);
  const someNorth = path.some((p) => p.lat > cLat);
  ok("polygon spans bbox center on both axes", someWest && someEast && someSouth && someNorth);
}

console.log("\n=== pickInitialPath: low confidence → empty (customer draws) ===");
{
  const path = pickInitialPath(sfBbox, 0.4, 0.6);
  ok("returns []", path.length === 0, `got ${path.length}`);
}

console.log("\n=== pickInitialPath: no roof_bbox → empty (customer draws) ===");
{
  const path = pickInitialPath(null, 0.9, 0.6);
  ok("returns []", path.length === 0, `got ${path.length}`);
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
process.exit(fail === 0 ? 0 : 1);
