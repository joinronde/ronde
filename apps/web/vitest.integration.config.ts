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
  },
});
