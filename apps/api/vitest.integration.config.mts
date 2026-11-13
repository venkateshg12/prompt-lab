import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.int.test.ts"],
    globalSetup: [path.resolve(import.meta.dirname, "test/globalSetup.ts")],
    setupFiles: [path.resolve(import.meta.dirname, "test/setupEnv.ts")],
    globals: true,
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
