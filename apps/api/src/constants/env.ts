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
