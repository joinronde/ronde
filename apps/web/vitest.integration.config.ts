import path from "node:path";
import { defineConfig } from "vitest/config";

// Integration tests run against a real PostgreSQL (DATABASE_URL), each file in its own throwaway schema
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    include: ["tests/**/*.int.test.ts"],
    setupFiles: ["tests/setup.ts", "tests/db-schema.ts"],
    testTimeout: 30_000,
    hookTimeout: 90_000,
    // How much of the server code the tests run: measured in CI, which fails when it goes down (raise the
    // thresholds as tests are added; pnpm test:integration --coverage measures it locally)
    coverage: {
      enabled: !!process.env.CI,
      provider: "v8",
      include: ["src/lib/server/**", "src/app/**/route.ts", "src/app/**/actions.ts", "src/app/**/*-actions.ts"],
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "coverage/integration",
      thresholds: { statements: 79, branches: 68, functions: 78, lines: 82 },
    },
  },
});
