import { defineConfig } from "vitest/config";

// The first test of a file may load the Temporal polyfill and the message catalogs: slow on a busy machine
export default defineConfig({ test: { include: ["tests/**/*.test.ts"], setupFiles: ["tests/setup.ts"], testTimeout: 20_000 } });
