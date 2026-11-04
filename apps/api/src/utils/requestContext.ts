import { AsyncLocalStorage } from "node:async_hooks";

type RequestContext = {
    requestId: string;
    orgId?: string;
    userId?: string;
    runId?: string;
    jobId?: string;       // any BullMQ job (Phase 08); run cells set it (Phase 17)
    systemScope?: boolean;
};

const storage = new AsyncLocalStorage<RequestContext>();

/*
  A Prisma query is a lazy thenable: it runs when something awaits it. `runAsSystem(() => prisma.x.find())`
  would hand the Query back, the scope would end, and the query would then run with no tenant context
  and be refused. Resolving any non-Promise thenable here starts it while the scope is still active.
 */
const settleInScope = <T>(value: T): T =>
    typeof (value as { then?: unknown } | null)?.then === "function" && !(value instanceof Promise)
        ? (Promise.resolve(value) as T)
        : value;

export const runWithRequestContext = <T>(context: RequestContext, fn: () => T): T =>
    storage.run(context, () => settleInScope(fn()));

export const runAsSystem = <T>(fn: () => T): T =>
    storage.run({ requestId: getRequestId() ?? "system", systemScope: true }, () => settleInScope(fn()));

export const getRequestContext = (): RequestContext | undefined => storage.getStore();

export const getRequestId = (): string | undefined => storage.getStore()?.requestId;

/*
  `authenticate` (Phase 05) and the tenant middleware (Phase 24) enrich the context after it was
  created, so later log lines carry who was acting. Mutating the store object is safe: it belongs to
  this request's async chain only.
 */
export const setRequestContext = (fields: Partial<RequestContext>) => {
    const store = storage.getStore();
    if (store) Object.assign(store, fields);
};


/*
  For code that already knows the org (a published run's orgId, a CLI flag) and must stay
  tenant-scoped: runs `fn` with that org in the request context, outside system scope.
 */
export const withOrgScope = <T>(orgId: string, fn: () => Promise<T>): Promise<T> =>
    runWithRequestContext({ ...(getRequestContext() ?? { requestId: "scope" }), orgId, systemScope: false }, fn);
