// Runs EVERY src/*.test.ts via tsx and fails if any suite fails.
// The full gate — `npm test` only runs core+operator. Cross-platform (no shell,
// no PATH/npx-stub issues): invokes tsx's cli.mjs directly with the node binary.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tsxCli = join(root, "node_modules", "tsx", "dist", "cli.mjs");
const suites = readdirSync(join(root, "src"))
  .filter((f) => f.endsWith(".test.ts"))
  .sort();

let fail = 0;
for (const f of suites) {
  const r = spawnSync(process.execPath, [tsxCli, join("src", f)], { cwd: root, stdio: "inherit" });
  if (r.status !== 0) {
    fail++;
    console.error(`\nFAIL ${f}`);
  }
}
console.log(`\n${suites.length - fail}/${suites.length} suites passed`);
process.exit(fail === 0 ? 0 : 1);
