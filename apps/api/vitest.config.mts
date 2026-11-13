import { defineConfig } from "vitest/config";

import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: [path.resolve(import.meta.dirname, "test/setupEnv.ts")],
    include: ["src/**/*.test.ts", "evals/**/*.test.ts"],
    globals: true,
    testTimeout: 10_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
    },
  },
});
