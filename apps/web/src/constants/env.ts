import { AppError } from "@/utils/appError";

/*
  Next.js inlines NEXT_PUBLIC_* by replacing the literal text `process.env.NEXT_PUBLIC_X` at build
  time. A dynamic `process.env[key]` is never replaced and is undefined in the browser — so callers
  pass the literal expression and this only checks it.
 */
const required = (name: string, value: string | undefined) => {
    if (!value) {
        throw new AppError(`Missing environment variable ${name}`);
    }
    return value;
};

export const IS_DEV = process.env.NODE_ENV === "development";
export const API_URL = required("NEXT_PUBLIC_API_URL", process.env.NEXT_PUBLIC_API_URL);
export const GOOGLE_CLIENT_ID = required("NEXT_PUBLIC_GOOGLE_CLIENT_ID", process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID);
