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
