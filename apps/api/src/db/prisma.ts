import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../generated/prisma/client";
import { DATABASE_URL } from "../constants/env";
import { getRequestContext } from "../utils/requestContext";

/*
  Tables that belong to a tenant. Every query on them is scoped to the org of the current request
  (or job) by the extension below; anything else fails loudly instead of leaking another org's rows.
  Cross-tenant work (sweepers, the platform DLQ, retention) opts out explicitly with runAsSystem().
  User, Session, VerificationLink, Org, Membership and the global Model registry are not tenant-owned.
 */
export const TENANT_MODELS = new Set<string>([
    "Invite",
    "AuditLog",
    "Task",
    "Example",
    "PromptVersion",
    "Run",
    "RunVariant",
    "Result",
]);

// Operations whose `where` is narrowed to the tenant. Since Prisma 5 a unique `where` may carry extra
// filters, so findUnique/update/delete by id become "by id AND in this org".
const WHERE_OPERATIONS = new Set([
    "findUnique",
    "findUniqueOrThrow",
    "findFirst",
    "findFirstOrThrow",
    "findMany",
    "count",
    "aggregate",
    "groupBy",
    "update",
    "updateMany",
    "updateManyAndReturn",
    "delete",
    "deleteMany",
]);

const CREATE_OPERATIONS = new Set(["create", "createMany", "createManyAndReturn"]);

/** The org every tenant query must be scoped to, or null inside runAsSystem(). */
export const tenantOrgId = (operation: string): string | null => {
    const context = getRequestContext();
    if (context?.systemScope) return null; // explicit cross-tenant work
    if (!context?.orgId) {
        throw new Error(`Tenant scope missing for ${operation}: wrap system work in runAsSystem()`);
    }
    return context.orgId.toLowerCase();
};

type Row = Record<string, unknown>;

const scopeWhere = (where: Row | undefined, orgId: string): Row => {
    if (where?.orgId !== undefined && String(where.orgId).toLowerCase() !== orgId) {
        throw new Error("Cross-tenant query refused");
    }
    return { ...where, orgId };
};

const scopeData = (data: Row, orgId: string): Row => {
    if (data.orgId !== undefined && String(data.orgId).toLowerCase() !== orgId) {
        throw new Error("Cross-tenant write refused");
    }
    return { ...data, orgId };
};

const tenantExtension = Prisma.defineExtension({
    name: "tenant-scope",
    query: {
        $allModels: {
            async $allOperations({ model, operation, args, query }) {
                if (!TENANT_MODELS.has(model)) return query(args);

                const orgId = tenantOrgId(`${model}.${operation}`);
                if (!orgId) return query(args);

                const scoped = { ...(args as Row) };
                if (WHERE_OPERATIONS.has(operation)) {
                    scoped.where = scopeWhere(scoped.where as Row | undefined, orgId);
                } else if (CREATE_OPERATIONS.has(operation)) {
                    scoped.data = Array.isArray(scoped.data)
                        ? (scoped.data as Row[]).map((row) => scopeData(row, orgId))
                        : scopeData(scoped.data as Row, orgId);
                } else if (operation === "upsert") {
                    scoped.where = scopeWhere(scoped.where as Row | undefined, orgId);
                    scoped.create = scopeData(scoped.create as Row, orgId);
                }
                return query(scoped as typeof args);
            },
        },
    },
});

const createClient = () =>
    new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) }).$extends(
        tenantExtension
    );

/*
  One client per process. Raw SQL ($queryRaw / $executeRaw) bypasses the tenant extension, so every
  raw statement on a tenant table must filter on org_id itself.
 */
export const prisma = createClient();

export type Db = typeof prisma;
/** The client handed to a `prisma.$transaction(async (tx) => …)` callback; tenant-scoped too. */
export type Tx = Parameters<Parameters<Db["$transaction"]>[0]>[0];
/** Either the client or a transaction: lets a helper join the caller's transaction when given one. */
export type DbOrTx = Db | Tx;

export { Prisma };
