import { prisma } from "../db/prisma";
import { cache } from "../utils/cache";
import { membershipCacheKey } from "./org.service";
import { recordAudit } from "./audit.service";
import appAssert from "../utils/errors/appAssert";
import { CONFLICT, FORBIDDEN, NOT_FOUND } from "../constants/https";
import type { OrgRole, MemberSummary } from "@repo/types";

const findMembership = (orgId: string, userId: string) =>
    prisma.membership.findUnique({ where: { orgId_userId: { orgId, userId } } });

export const assertNotLastOwner = async (orgId: string, userId: string) => {
    const owners = await prisma.membership.count({ where: { orgId, role: "owner" } });
    const target = await findMembership(orgId, userId);
    appAssert(target, NOT_FOUND, "Member not found in organisation");
    appAssert(!(target.role === "owner" && owners <= 1), CONFLICT, "An organisation needs at least one owner");
};

export const revokeMembership = async (
    orgId: string,
    userId: string,
    change: { role?: OrgRole } | "remove"
) => {
    if (change === "remove") {
        await prisma.membership.deleteMany({ where: { orgId, userId } });
    } else if (change.role) {
        await prisma.membership.updateMany({ where: { orgId, userId }, data: { role: change.role } });
    }
    // Invalidate cached membership immediately so removed/demoted members are locked out on next call
    await cache.del(membershipCacheKey(orgId, userId));
};

export const listMembers = async (orgId: string): Promise<MemberSummary[]> => {
    const memberships = await prisma.membership.findMany({
        where: { orgId },
        orderBy: { createdAt: "asc" },
        include: { user: { select: { id: true, name: true, email: true } } },
    });

    return memberships.map((m) => ({
        userId: m.user.id,
        email: m.user.email,
        name: m.user.name || m.user.email.split("@")[0] || "User",
        role: m.role,
        joinedAt: m.createdAt.toISOString(),
    }));
};

export const changeMemberRole = async (
    orgId: string,
    targetUserId: string,
    newRole: OrgRole,
    actorUserId: string,
    actorRole: OrgRole
) => {
    const target = await findMembership(orgId, targetUserId);
    appAssert(target, NOT_FOUND, "Member not found");

    if (target.role === "owner" && newRole !== "owner") {
        await assertNotLastOwner(orgId, targetUserId);
    }

    if (newRole === "owner" || target.role === "owner") {
        appAssert(actorRole === "owner", FORBIDDEN, "Only an organisation owner can grant or remove the owner role");
    }

    await revokeMembership(orgId, targetUserId, { role: newRole });

    await recordAudit({
        orgId,
        actor: { type: "user", id: actorUserId },
        action: "member.role_changed",
        target: { type: "user", id: targetUserId },
        diff: { fromRole: target.role, toRole: newRole },
    });

    return { userId: targetUserId, role: newRole };
};

export const removeMember = async (
    orgId: string,
    targetUserId: string,
    actorUserId: string,
    actorRole: OrgRole
) => {
    const target = await findMembership(orgId, targetUserId);
    appAssert(target, NOT_FOUND, "Member not found");

    const isSelf = targetUserId === actorUserId;

    if (!isSelf) {
        appAssert(
            actorRole === "owner" || actorRole === "admin",
            FORBIDDEN,
            "Only an organisation admin or owner can remove members"
        );
    }

    if (target.role === "owner") {
        await assertNotLastOwner(orgId, targetUserId);
        if (!isSelf) {
            appAssert(actorRole === "owner", FORBIDDEN, "Only an organisation owner can remove another owner");
        }
    }

    await revokeMembership(orgId, targetUserId, "remove");

    await recordAudit({
        orgId,
        actor: { type: "user", id: actorUserId },
        action: "member.removed",
        target: { type: "user", id: targetUserId },
        diff: { removedRole: target.role, isSelf },
    });

    return { removed: true, userId: targetUserId };
};
