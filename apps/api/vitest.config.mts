import { defineConfig } from "vitest/config";

// Unit tests only; Phase 28 adds the integration project (Testcontainers).
export default defineConfig({
    test: {
        include: ["src/**/*.test.ts"],
        env: {
            NODE_ENV: "test",
            PORT: "5000",
            CORS_ORIGIN: "http://localhost:3000",
            DATABASE_URL: "postgresql://promptlab:promptlab@localhost:5432/promptlab",
            JWT_SECRET: "unit-test-jwt-secret-0123456789-0123456789",
            JWT_REFRESH_SECRET: "unit-test-refresh-secret-0123456789-0123456789",
            GOOGLE_CLIENT_ID: "unit-test",
            REDIS_HOST: "127.0.0.1",
            REDIS_PORT: "6379",
        },
    },
});
