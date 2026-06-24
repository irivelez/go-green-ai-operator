// Proof driver — photo count + byte cap at ingest (todo 6).
// photoCaps() reads env live, so a test can tighten caps before a call without
// re-importing the module. Run: npx tsx src/photo-cap.test.ts

import { admitPhotos, photoByteSize, resetPhotoCaps, photoCaps } from "./photo-cap";

let pass = 0,
  fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

// Build a base64 data URI whose decoded payload is ~`bytes` long.
function photoOfBytes(bytes: number): string {
  const b64len = Math.ceil((bytes * 4) / 3);
  return `data:image/jpeg;base64,${"A".repeat(b64len)}`;
}

async function main() {
  const caps = photoCaps();

  console.log("\n=== Photo 1: byte-size estimate is correct ===");
  {
    const p = photoOfBytes(3000);
    const size = photoByteSize(p);
    ok("decoded size within ±4 bytes of 3000", Math.abs(size - 3000) <= 4, String(size));
  }

  console.log("\n=== Photo 2: count cap — extra photo rejected at ingest ===");
  {
    resetPhotoCaps();
    const small = photoOfBytes(1000);
    const r1 = await admitPhotos("capper@example.com", [small, small, small]);
    ok("exactly maxPhotos accepted", r1.accepted.length === caps.maxPhotos, `accepted=${r1.accepted.length}`);
    ok("the extra photo rejected", r1.rejected === 3 - caps.maxPhotos, `rejected=${r1.rejected}`);
    ok("rejection surfaces a message", typeof r1.message === "string");
  }

  console.log("\n=== Photo 3: per-photo byte cap — oversize rejected ===");
  {
    resetPhotoCaps();
    const huge = photoOfBytes(caps.maxBytesPerPhoto + 1024);
    const r = await admitPhotos("big@example.com", [huge]);
    ok("oversize photo rejected", r.accepted.length === 0 && r.rejected === 1, JSON.stringify(r));
  }

  console.log("\n=== Photo 4: per-session byte cap — total over budget rejected ===");
  {
    // Tighten caps via env so the session-byte cap is the binding constraint:
    // count cap 5 (not the limiter), per-photo 9MB, session 10MB → 3×4MB = 12MB,
    // the 3rd photo blows the session budget while each fits the per-photo cap.
    process.env.PHOTO_MAX_COUNT = "5";
    process.env.PHOTO_MAX_BYTES = String(9 * 1024 * 1024);
    process.env.PHOTO_MAX_SESSION_BYTES = String(10 * 1024 * 1024);
    resetPhotoCaps();
    const each = photoOfBytes(4 * 1024 * 1024);
    const r = await admitPhotos("session@example.com", [each, each, each]);
    ok("first two photos accepted (8MB ≤ 10MB)", r.accepted.length === 2, `accepted=${r.accepted.length}`);
    ok("third photo rejected on session byte cap", r.rejected === 1, `rejected=${r.rejected}`);
    delete process.env.PHOTO_MAX_COUNT;
    delete process.env.PHOTO_MAX_BYTES;
    delete process.env.PHOTO_MAX_SESSION_BYTES;
  }

  console.log("\n=== Photo 5: 50-photo hostile upload → only maxPhotos stored ===");
  {
    resetPhotoCaps();
    const small = photoOfBytes(500);
    const flood = Array.from({ length: 50 }, () => small);
    const r = await admitPhotos("hostile@example.com", flood);
    ok("only maxPhotos admitted from a 50-photo flood", r.accepted.length === caps.maxPhotos, `accepted=${r.accepted.length}`);
    ok("the rest rejected", r.rejected === 50 - caps.maxPhotos, `rejected=${r.rejected}`);
  }

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail === 0 ? 0 : 1);
}
void main();
