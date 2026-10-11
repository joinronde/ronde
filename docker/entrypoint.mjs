// Start-up of the app container. The runtime image has no shell guarantee: this Node script replaces a
// shell entrypoint, then loads the Next.js server. Migrations run separately, in the "migrate" image.
import { readFileSync } from "node:fs";

// Docker secrets: any <NAME>_FILE variable is read from the given file
for (const name of [
  "DATABASE_URL",
  "SMTP_URL",
  "GITLAB_TOKEN",
  "SECRET_KEY",
  "AUTH_SECRET",
  "OIDC_CLIENT_SECRET",
  "GOOGLE_CLIENT_SECRET",
  "GITHUB_CLIENT_SECRET",
  "MICROSOFT_CLIENT_SECRET",
  "RONDE_LICENSE",
  "ANTHROPIC_API_KEY",
  "TRANSCRIPTION_API_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "SLACK_CLIENT_SECRET",
  "SLACK_SIGNING_SECRET",
  "TEAMS_APP_PASSWORD",
]) {
  const file = process.env[`${name}_FILE`];
  if (!file) continue;
  try {
    process.env[name] = readFileSync(file, "utf8").trim();
  } catch {
    console.error(`Cannot read ${name}_FILE=${file}`);
    process.exit(1);
  }
}

const missing = ["DATABASE_URL", "AUTH_SECRET"].filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing required variables: ${missing.join(", ")} (or <NAME>_FILE)`);
  process.exit(1);
}

await import("./server.js");
