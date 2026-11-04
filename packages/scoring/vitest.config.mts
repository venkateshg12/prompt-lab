import { defineConfig } from "vitest/config";

// Pure unit tests only: no database, no network, no clock. They run from src, never from dist.
export default defineConfig({
    test: {
        include: ["src/**/*.test.ts"],
        coverage: {
            provider: "v8",
            include: ["src/**/*.ts"],
            exclude: ["src/**/__tests__/**", "src/index.ts"],
            // The scorer is the most important code in the project: every branch is exercised.
            thresholds: { branches: 100 },
        },
    },
});
