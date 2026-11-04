import type { ApiError } from "@/types";

/*
  The response interceptor in `lib/api.ts` rejects every failed request with a normalised `ApiError`,
  never a raw AxiosError. So the server's explanation lives on `errors[0].message` (also copied onto
  `message`), and `error.response` does not exist. Read it here instead of at each call site.
 */
export const getErrorMessage = (error: unknown, fallback: string): string => {
  if (typeof error !== "object" || error === null) return fallback;
  const { errors, message } = error as Partial<ApiError>;
  return errors?.[0]?.message || message || fallback;
};
