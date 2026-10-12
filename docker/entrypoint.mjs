// Start-up of the app container. The runtime image has no shell guarantee: this Node script replaces a
// shell entrypoint, then loads the Next.js server. Migrations run separately, in the "migrate" image.
import { readFileSync } from "node:fs";

// Docker secrets: any <NAME>_FILE variable is read from the given file into <NAME> (one set directly wins).
// Every one: no list to keep in step with the variables the app reads.
for (const [key, file] of Object.entries(process.env)) {
  const m = /^([A-Z][A-Z0-9_]*)_FILE$/.exec(key);
  if (!m || !file || process.env[m[1]]) continue;
  try {
    process.env[m[1]] = readFileSync(file, "utf8").trim();
  } catch {
    console.error(`Cannot read ${key}=${file}`);
    process.exit(1);
  }
}

const missing = ["DATABASE_URL", "AUTH_SECRET"].filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing required variables: ${missing.join(", ")} (or <NAME>_FILE)`);
  process.exit(1);
}

// The app stops itself on SIGTERM (instrumentation.ts): the background jobs running end first, so a deploy never
// leaves one half done to be run again
process.env.NEXT_MANUAL_SIG_HANDLE ??= "true";

await import("./server.js");
