// The paid editions' code is reached through one door: apps/web/src/ee-bridge.ts. Any other import of
// @ronde/ee (or of a file under ee/) from Community code fails this check, so a pure Community build
// (RONDE_PURE_CE=1) never ships paid code, and the AGPL code never depends on it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SCAN = ["apps", "packages", "ee-stub"];
const ALLOWED = new Set(["apps/web/src/ee-bridge.ts"]);
const SKIP = new Set(["node_modules", ".next", ".turbo", "generated", "dist", "test-results", "playwright-report"]);
const IMPORT = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']((?:@ronde\/ee)(?:\/[^"']*)?|(?:\.\.\/)+ee\/[^"']*)["']/g;

const offenders = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(name)) {
      const rel = relative(ROOT, path);
      if (ALLOWED.has(rel)) continue;
      for (const m of readFileSync(path, "utf8").matchAll(IMPORT)) if (m[1] !== "@ronde/ee-stub") offenders.push(`${rel}: ${m[1]}`);
    }
  }
}
for (const dir of SCAN) walk(join(ROOT, dir));

if (offenders.length) {
  console.error(`Only apps/web/src/ee-bridge.ts may import the paid editions' code:\n  ${offenders.join("\n  ")}`);
  process.exit(1);
}
console.log("EE boundary: clean.");
