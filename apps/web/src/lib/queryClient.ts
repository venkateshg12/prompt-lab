import { QueryClient } from "@tanstack/react-query";
import { isServerUnavailable } from "@/lib/serverStatus";
import { useServerStore } from "@/store/server.store";

// About two minutes of patience in total — enough for a slow free-tier cold start with margin.
const MAX_WAKE_RETRIES = 24;

const makeQueryClient = () =>
    new QueryClient({
        defaultOptions: {
            queries: {
                // Only "the server isn't up yet" is worth retrying; a 4xx or a business error would just
                // fail again. While a query retries it stays pending, so the page keeps its skeletons
                // instead of flipping to an error or empty state.
                retry: (failureCount, error) =>
                    failureCount < MAX_WAKE_RETRIES &&
                    isServerUnavailable((error as { status?: unknown } | null)?.status),
                retryDelay: (attempt) => Math.min(2000 * (attempt + 1), 5000),
            },
        },
    });

let browserQueryClient: QueryClient | undefined;

/*
  A new client for every server render (so two users' requests can never share a cache on the
  server) and one for the life of the browser tab. Prompt Lab doesn't fetch on the server — the auth
  cookies belong to the API's domain — but the split is kept so a future prefetch can't leak data.
 */
export const getQueryClient = (): QueryClient => {
    if (typeof window === "undefined") return makeQueryClient();
    if (!browserQueryClient) {
        browserQueryClient = makeQueryClient();
        const client = browserQueryClient;
        // Safety net: a query that ran out of retries before the server finished waking is refetched
        // the moment the server answers, rather than staying failed until the visitor reloads.
        useServerStore.subscribe((state, previous) => {
            if (previous.status === "waking" && state.status === "ready") {
                client.refetchQueries({
                    type: "active",
                    predicate: (query) => query.state.status === "error",
                });
            }
        });
    }
    return browserQueryClient;
};

/**
 * Query keys holding data that belongs to the signed-in user. `profile` is deliberately absent:
 * AuthLoader keeps an observer on it for the whole session, so removing it would send the query
 * straight back out. Logout overwrites it with null instead.
 */
const USER_SCOPED_KEYS = [
    "sessions",
    "org", "members", "invites",                           // Phase 10
    "tasks", "task", "examples", "agreement", "prompts", "prompt-preview",   // Phases 11–13, 19
    "runs", "run", "run-summary", "results", "compare", "judge",   // Phases 17–21, 26
    "published-admin",                                     // Phase 22 (the owner's publish settings)
];
// Not listed on purpose: `profile` (see above), the model registry `models` and public pages
// `public-run`, which are the same for everyone.

// Called wherever the session ends — logout, a failed refresh, a session that no longer resolves.
export const clearUserQueries = () => {
    const client = getQueryClient();
    for (const key of USER_SCOPED_KEYS) {
        client.removeQueries({ queryKey: [key] });
    }
};
