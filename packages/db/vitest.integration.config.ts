import { defineConfig } from "vitest/config";

// Integration tests run against a real PostgreSQL (DATABASE_URL), each in its own throwaway schema
export default defineConfig({ test: { include: ["tests/**/*.int.test.ts"], testTimeout: 30_000, hookTimeout: 60_000 } });
