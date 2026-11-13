// ADAPT of @pt-api/test/setupEnv.ts: no S3 / webhook variables; LLM, runner and demo variables instead.
process.env.NODE_ENV = "test";
process.env.PORT = process.env.PORT || "5001";
process.env.CORS_ORIGIN = "http://localhost:3000";
process.env.CLIENT_URL = "http://localhost:3000";
process.env.JWT_SECRET = "thisisatestjwtsecretthatisatleast32charslong!";
process.env.JWT_REFRESH_SECRET = "thisisatestjwtrefreshsecretthatisalso32charslong!";
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
process.env.LLM_PROVIDER = "fake";
process.env.CACHE_ENABLED = "true";
// NVIDIA_API_KEY / NVIDIA_BASE_URL are set by byok.int.test.ts itself (vi.hoisted): unit tests need NVIDIA unconfigured.
process.env.CELL_BACKOFF_MS = "20";
process.env.RUN_WORKERS_IN_API = "true";
process.env.MODELS_SEED = "test"; // registry with fake:* models only (Phase 14)
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "info";
process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://promptlab:promptlab@127.0.0.1:5432/promptlab_test";
process.env.REDIS_HOST = process.env.REDIS_HOST || "127.0.0.1";
process.env.REDIS_PORT = process.env.REDIS_PORT || "6379";
process.env.CACHE_REDIS_HOST = process.env.CACHE_REDIS_HOST || "127.0.0.1";
process.env.CACHE_REDIS_PORT = process.env.CACHE_REDIS_PORT || "6380";
