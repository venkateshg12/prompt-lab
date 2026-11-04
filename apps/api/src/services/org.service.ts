import type { OrgRole, UpdateOrgSchema } from "@repo/types";
import { prisma, type DbOrTx, type Prisma } from "../db/prisma";
import { cache } from "../utils/cache";
import { appAssert } from "../utils/errors";
import { FORBIDDEN, NOT_FOUND } from "../constants/https";
import { withTransaction } from "../utils/db";
import type { UserRecord } from "../types/user.types";
import { can } from "../constants/permissions";
import type { OrgRecord } from "../types/org.types";

export const membershipCacheKey = (orgId: unknown, userId: unknown) =>
    `cache:membership:${String(orgId)}:${String(userId)}`;

const MEMBERSHIP_CACHE_TTL_SECONDS = 60;

/** An org as the API returns it: the budget as a plain number of dollars. */
export const toOrgDto = (org: OrgRecord) => ({
    id: org.id,
    name: org.name,
    createdBy: org.createdById,
    monthlyBudgetUsd: Number(org.monthlyBudgetUsdMicros) / 1e6,
    createdAt: org.createdAt,
    updatedAt: org.updatedAt,
});

/** Creates "<name>'s workspace" with the user as owner. Pass the caller's transaction. */
export const createPersonalOrg = async (user: Pick<UserRecord, "id" | "name" | "email">, db: DbOrTx) => {
    const org = await db.org.create({
        data: { name: `${user.name || user.email.split("@")[0]}'s workspace`, createdById: user.id },
    });
    await db.membership.create({ data: { orgId: org.id, userId: user.id, role: "owner" } });
    return org;
};

/** Idempotent: used by Google sign-in, where the user may or may not be new. */
export const ensurePersonalOrg = async (user: Pick<UserRecord, "id" | "name" | "email">) => {
    if (await prisma.membership.findFirst({ where: { userId: user.id }, select: { id: true } })) return;
    await withTransaction((tx) => createPersonalOrg(user, tx));
};

/*
  The caller's role in an org, or a 404. Cached like the session check in authenticate: a confirmed
  membership is remembered for 60 s; removing a member deletes the key. With the cache
  down, every request reads the database — slower, never more permissive.
 */
export const resolveMembership = async (
    userId: string,
    requestedOrgId?: string
): Promise<{ orgId: string; role: OrgRole }> => {
    if (!requestedOrgId) {
        const first = await prisma.membership.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } });
        appAssert(first, NOT_FOUND, "No workspace found for this account");
        return { orgId: first.orgId, role: first.role };
    }

    const key = membershipCacheKey(requestedOrgId, userId);
    const cached = await cache.get(key);
    if (cached) return { orgId: requestedOrgId, role: cached as OrgRole };

    const membership = await prisma.membership.findUnique({
        where: { orgId_userId: { orgId: requestedOrgId, userId } },
    });
    appAssert(membership, NOT_FOUND, "Workspace not found");
    void cache.set(key, membership.role, MEMBERSHIP_CACHE_TTL_SECONDS);
    return { orgId: membership.orgId, role: membership.role };
};

export const getOrgForMember = async (orgId: string) => {
    const org = await prisma.org.findUnique({ where: { id: orgId } });
    return org ? toOrgDto(org) : null;
};

export const listMyOrgs = async (userId: string) => {
    const memberships = await prisma.membership.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
        include: { org: true },
    });

    return memberships.map((m) => ({
        ...toOrgDto(m.org),
        role: m.role,
    }));
};

export const updateOrg = async (orgId: string, userId: string, data: UpdateOrgSchema) => {
    const membership = await prisma.membership.findUnique({ where: { orgId_userId: { orgId, userId } } });
    appAssert(membership, NOT_FOUND, "Workspace not found");
    appAssert(can(membership.role, "org.update"), FORBIDDEN, "Only a workspace admin or owner can update workspace settings");

    const changes: Prisma.OrgUpdateInput = {};
    if (data.name !== undefined) changes.name = data.name;
    if (data.monthlyBudgetUsd !== undefined) {
        appAssert(can(membership.role, "budget.manage"), FORBIDDEN, "Only the workspace owner can change the budget");
        changes.monthlyBudgetUsdMicros = BigInt(Math.round(data.monthlyBudgetUsd * 1_000_000));
    }

    const updated = await prisma.org.update({ where: { id: orgId }, data: changes });
    return toOrgDto(updated);
};
