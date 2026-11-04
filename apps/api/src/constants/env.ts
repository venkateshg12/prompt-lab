const getEnv = (key: string, defaultValue?: string) => {

    const value = process.env[key] || defaultValue;

    if (value === undefined) {
        throw new Error(`Missing Environment varaible ${key}`)
    }

    return value;
}

export const NODE_ENV = getEnv("NODE_ENV");
export const PORT = getEnv("PORT");
export const CORS_ORIGIN = getEnv("CORS_ORIGIN");

/*
  Where the web app lives, for links inside emails. CORS_ORIGIN may list several origins, and
  interpolating that raw list produced links like "https://a.com,https://b.com/auth/verify/..." —
  so links use this single origin, defaulting to the first one allowed.
 */
export const CLIENT_URL = getEnv("CLIENT_URL", CORS_ORIGIN.split(",")[0].trim());
export const LOG_LEVEL = getEnv("LOG_LEVEL", "info");
export const SERVICE_NAME = getEnv("SERVICE_NAME", "api");
// "false" in production, where src/worker.ts runs as its own process.
export const RUN_WORKERS_IN_API = getEnv("RUN_WORKERS_IN_API", "true");
// postgresql://user:password@host:5432/db. Hosted (Neon): add ?sslmode=require.
export const DATABASE_URL = getEnv("DATABASE_URL");
export const JWT_SECRET = getEnv("JWT_SECRET");
export const JWT_REFRESH_SECRET = getEnv("JWT_REFRESH_SECRET");

/*
  HS256 secrets are only as strong as their entropy: a short or guessable one can be brute-forced
  offline from any single token, after which anyone can mint tokens for any user or role. The two
  must also differ, or a refresh token would verify as an access token.
 */
const MIN_JWT_SECRET_LENGTH = 32;

if (JWT_SECRET.length < MIN_JWT_SECRET_LENGTH || JWT_REFRESH_SECRET.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
        `JWT_SECRET and JWT_REFRESH_SECRET must each be at least ${MIN_JWT_SECRET_LENGTH} characters (generate with: openssl rand -hex 32)`
    );
}

if (JWT_SECRET === JWT_REFRESH_SECRET) {
    throw new Error("JWT_SECRET and JWT_REFRESH_SECRET must be different values");
}
export const GOOGLE_CLIENT_ID = getEnv("GOOGLE_CLIENT_ID");
export const DEBUG_IP_ENDPOINT = getEnv("DEBUG_IP_ENDPOINT", "false");
export const TRUSTED_PROXY_CIDRS = getEnv("TRUSTED_PROXY_CIDRS", "");
export const REDIS_HOST = getEnv("REDIS_HOST");
export const REDIS_PORT = getEnv("REDIS_PORT");
// Empty for a local passwordless Redis; set both for a hosted one (e.g. Redis Cloud).
export const REDIS_USERNAME = getEnv("REDIS_USERNAME", "");
export const REDIS_PASSWORD = getEnv("REDIS_PASSWORD", "");

// The response cache runs on its own Redis (see docker-compose.yml): it must be allowed to evict,
// which the queue/rate-limit instance must not.
export const CACHE_REDIS_HOST = getEnv("CACHE_REDIS_HOST", REDIS_HOST);
export const CACHE_REDIS_PORT = getEnv("CACHE_REDIS_PORT", "6380");
export const CACHE_REDIS_USERNAME = getEnv("CACHE_REDIS_USERNAME", REDIS_USERNAME);
export const CACHE_REDIS_PASSWORD = getEnv("CACHE_REDIS_PASSWORD", REDIS_PASSWORD);
// Demo runs (all visitors together) per 24 h. Each run is ≤ 10 calls on the visitor's own key.
export const DEMO_DAILY_CAP = getEnv("DEMO_DAILY_CAP", "500");

// Emergency off-switch: "false" makes every cache read a miss and every write a no-op.
export const CACHE_ENABLED = getEnv("CACHE_ENABLED", "true");

// The BullMQ dashboard exposes job payloads, which include password-reset and verification
// tokens. It stays off unless explicitly switched on, and is Basic-auth protected when on.
export const ENABLE_QUEUE_DASHBOARD = getEnv("ENABLE_QUEUE_DASHBOARD", "false");
export const QUEUE_DASHBOARD_USER = getEnv("QUEUE_DASHBOARD_USER", "");
export const QUEUE_DASHBOARD_PASSWORD = getEnv("QUEUE_DASHBOARD_PASSWORD", "");

/*
  Gmail API sender (see config/gmail.ts). All optional so the server still boots before the one-time
  authorization has produced a refresh token: sendEmail fails with a clean error until they are set.
  GMAIL_SENDER_NAME is the display name shown next to the fixed sender address.
  GMAIL_OAUTH_SETUP exposes the authorization routes in production (they are always on elsewhere);
  switch it on only for the moment you re-authorize, then off again.
 */
export const GMAIL_CLIENT_ID = getEnv("GMAIL_CLIENT_ID", "");
export const GMAIL_CLIENT_SECRET = getEnv("GMAIL_CLIENT_SECRET", "");
export const GMAIL_REDIRECT_URI = getEnv("GMAIL_REDIRECT_URI", "");
export const GMAIL_REFRESH_TOKEN = getEnv("GMAIL_REFRESH_TOKEN", "");
export const GMAIL_SENDER_NAME = getEnv("GMAIL_SENDER_NAME", "");
export const GMAIL_OAUTH_SETUP = getEnv("GMAIL_OAUTH_SETUP", "false");
// Port for the worker's /health server when it runs standalone.
export const WORKER_PORT = getEnv("WORKER_PORT", "8080");

// Model providers (Phase 14). A provider's models are enabled only when its key is set.
export const NVIDIA_API_KEY = getEnv("NVIDIA_API_KEY", "");
export const NVIDIA_BASE_URL = getEnv("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1");
export const OPENAI_API_KEY = getEnv("OPENAI_API_KEY", "");
export const ANTHROPIC_API_KEY = getEnv("ANTHROPIC_API_KEY", "");
export const GEMINI_API_KEY = getEnv("GEMINI_API_KEY", "");
export const LLM_PROVIDER = getEnv("LLM_PROVIDER", "live");
export const REPLAY_DIR = getEnv("REPLAY_DIR", "");
export const FAKE_LLM_SCRIPT = getEnv("FAKE_LLM_SCRIPT", "");
export const FAKE_LLM_FIXTURES = getEnv("FAKE_LLM_FIXTURES", "");
export const MODELS_SEED = getEnv("MODELS_SEED", "");
// Overridable only so tests can point the adapters at a local stub server.
export const ANTHROPIC_BASE_URL = getEnv("ANTHROPIC_BASE_URL", "https://api.anthropic.com");
export const GEMINI_BASE_URL = getEnv("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com");
