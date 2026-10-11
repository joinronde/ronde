import { defineConfig } from "vitest/config";

// Integration tests run against a real PostgreSQL (DATABASE_URL), in a throwaway schema
export default defineConfig({ test: { include: ["tests/**/*.int.test.ts"], testTimeout: 60_000, hookTimeout: 60_000 } });
