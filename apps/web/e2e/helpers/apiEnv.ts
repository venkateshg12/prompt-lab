/* The E2E API environment: its own database, local stubs, no real email, no paid provider. Shared by playwright.config.ts and specs that run CLI scripts. */
const WEB_URL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";

export const apiEnv: Record<string, string> = {
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
