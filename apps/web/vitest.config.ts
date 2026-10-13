import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/**/*.int.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // How much of the logic shared with the browser the tests run: measured in CI, which fails when it goes down
    coverage: {
      enabled: !!process.env.CI,
      provider: "v8",
      include: ["src/lib/shared/**"],
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "coverage/unit",
      thresholds: { statements: 97, branches: 95, functions: 98, lines: 97 },
    },
  },
});
