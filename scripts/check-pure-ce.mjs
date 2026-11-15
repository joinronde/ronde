// After a pure Community build (RONDE_PURE_CE=1 pnpm --filter @ronde/web build): no paid code in the output
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const OUT = new URL("../apps/web/.next", import.meta.url).pathname;
const MARK = "Ronde Enterprise Edition";
const found = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    // "cache" and "dev" (next dev) are not part of the build
    if (name === "cache" || (dir === OUT && name === "dev")) continue;
    // pnpm links in the standalone output can point at packages the build did not trace: a link holds no code
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) walk(path);
    else if (/\.(js|mjs|cjs|json|html|rsc|map)$/.test(name) && readFileSync(path, "utf8").includes(MARK)) found.push(path);
  }
}
walk(OUT);
if (found.length) {
  console.error(`Paid code found in a pure Community build:\n  ${found.slice(0, 10).join("\n  ")}`);
  process.exit(1);
}
console.log("Pure Community build: no paid code.");
