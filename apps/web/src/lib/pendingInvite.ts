/*
  The invitation link is /invites#token=…  A URL fragment is never sent to any server, so the token
  can't reach an access log, a proxy log or a Referer header. It is kept in localStorage (a new account's
  verification link opens in another tab, which has no sessionStorage) for an hour, so it survives
  sign-in and email verification, and is removed once accepted. Every access is wrapped: storage can be
  unavailable (private window, blocked site data) and the page still works from the fragment.
 */
const PENDING_KEY = "pending-invite";
const PENDING_TTL_MS = 60 * 60 * 1000;

export const readPendingToken = (): string | null => {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token?: string; at?: number };
    if (!parsed.token || !parsed.at || Date.now() - parsed.at > PENDING_TTL_MS) return null;
    return parsed.token;
  } catch {
    return null;
  }
};

export const storePendingToken = (token: string) => {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ token, at: Date.now() }));
  } catch {
    // storage unavailable
  }
};

export const clearPendingInvite = () => {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // ignore
  }
};
