import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// A pure Community build leaves the paid editions' code out: @ronde/ee becomes its AGPL stand-in
const pureCE = process.env.RONDE_PURE_CE === "1";

const nextConfig: NextConfig = {
  output: "standalone",
  // The development badge sits over bottom-left buttons (check-in save) and screenshots
  devIndicators: false,
  // Trace files from the monorepo root so workspace packages end up in the standalone bundle
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // URL prefix when the app is served under a sub-path (e.g. /ronde behind a reverse proxy)
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
  // pg and nodemailer stay plain Node modules loaded at runtime
  // date-holidays reads its data (200 countries) at run time: kept out of the bundle, traced like a dependency
  serverExternalPackages: ["pg", "pg-boss", "nodemailer", "date-holidays", "imapflow", "mailparser", "web-push"],
  // Workspace packages are shipped as TypeScript sources
  transpilePackages: [
    "@ronde/connectors",
    "@ronde/core",
    "@ronde/db",
    "@ronde/editions",
    "@ronde/ee",
    "@ronde/ee-stub",
    "@ronde/i18n",
    "@ronde/jobs",
    "@ronde/module-sdk",
    "@ronde/modules",
    "@ronde/random-core",
    "@ronde/ui",
  ],
  turbopack: pureCE ? { resolveAlias: { "@ronde/ee": "@ronde/ee-stub" } } : undefined,
  poweredByHeader: false,
  // Do not let "next dev" generate AGENTS.md / CLAUDE.md files
  agentRules: false,
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);
