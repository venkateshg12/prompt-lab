import { defineConfig } from "vitest/config";

// Pure unit tests only: no database, no network, no clock. They run from src, never from dist.
export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });
