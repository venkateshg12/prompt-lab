import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const WEB_URL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
const API_URL = process.env.API_BASE_URL || "http://127.0.0.1:5000";

/*
  The suite brings up its own API and web app so `pnpm --filter web e2e` is one command. Only the
  infrastructure (PostgreSQL and both Redis instances) comes from `docker compose up -d`.

  The API runs on the host with its own database (`promptlab_e2e`, created and migrated by the command
  below), never the dev database. GMAIL_* is blanked so no real email can ever be sent: with no refresh
  token, non-production mail goes to the in-memory dev mailbox the specs read links from.
  Later phases add their provider stubs here (Phase 14: the fake provider; Phase 28: NVIDIA stub).
 */
const apiEnv: Record<string, string> = {
  NODE_ENV: "development",
  PORT: "5000",
  CORS_ORIGIN: WEB_URL,
  CLIENT_URL: WEB_URL,
  DATABASE_URL: "postgresql://promptlab:promptlab@127.0.0.1:5432/promptlab_e2e",
  JWT_SECRET: "e2e-jwt-secret-0123456789-0123456789-abcdef",
  JWT_REFRESH_SECRET: "e2e-jwt-refresh-secret-0123456789-abcdef",
  GOOGLE_CLIENT_ID: "e2e-google-client-id",
  REDIS_HOST: "127.0.0.1",
  REDIS_PORT: "6379",
  REDIS_USERNAME: "",
  REDIS_PASSWORD: "",
  CACHE_REDIS_HOST: "127.0.0.1",
  CACHE_REDIS_PORT: "6380",
  CACHE_REDIS_USERNAME: "",
  CACHE_REDIS_PASSWORD: "",
  LOG_LEVEL: "warn",
  GMAIL_CLIENT_ID: "",
  GMAIL_CLIENT_SECRET: "",
  GMAIL_REFRESH_TOKEN: "",
  RUN_WORKERS_IN_API: "true",
  // Providers: the NVIDIA adapter talks to a local, deterministic stub (e2e/stubs/nim-stub.js) with a fake
  // key, so the real queue/worker/scorer run with known answers and no E2E run can reach a paid API.
  NVIDIA_API_KEY: "e2e-key",
  NVIDIA_BASE_URL: "http://127.0.0.1:5997",
  OPENAI_API_KEY: "",
  ANTHROPIC_API_KEY: "",
  GEMINI_API_KEY: "",
  MODELS_SEED: "",
  CELL_BACKOFF_MS: "20",
};

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    baseURL: WEB_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: [
    {
      command: "node e2e/stubs/nim-stub.js",
      cwd: __dirname,
      url: "http://127.0.0.1:5997/__health",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command:
        "pnpm --filter api db:ensure && pnpm --filter api db:migrate && pnpm --filter api db:seed-models && pnpm --filter api exec tsx src/index.ts",
      cwd: path.resolve(__dirname, "../.."),
      url: `${API_URL}/health`,
      env: apiEnv,
      // Set E2E_SERVER_LOGS=1 to see the API's own log lines when a spec fails.
      stdout: process.env.E2E_SERVER_LOGS ? "pipe" : "ignore",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // The production build, not `next dev`: a cold dev compile blows the per-page timeouts, and
      // this is what actually ships. NEXT_PUBLIC_* below are inlined at build time.
      command: "pnpm build && pnpm start",
      cwd: __dirname,
      url: WEB_URL,
      env: {
        NEXT_PUBLIC_API_URL: API_URL.replace("127.0.0.1", "localhost"),
        NEXT_PUBLIC_GOOGLE_CLIENT_ID: "e2e-google-client-id",
      },
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
