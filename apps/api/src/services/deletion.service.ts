import { prisma } from "../db/prisma";
import { cache } from "../utils/cache";
import { appAssert } from "../utils/errors";
import { withTransaction } from "../utils/db";
import { BAD_REQUEST, NOT_FOUND } from "../constants/https";
import { logger } from "../utils/logger";
import { membershipCacheKey } from "./org.service";

export const hardDeleteOrg = async (orgId: string, actorId: string, confirmName: string) => {
    const org = await prisma.org.findUnique({ where: { id: orgId } });
    appAssert(org, NOT_FOUND, "Workspace not found");
    appAssert(confirmName.trim() === org.name, BAD_REQUEST, "Type the workspace name exactly to delete it");
    const members = await prisma.membership.findMany({ where: { orgId }, select: { userId: true } });
    await withTransaction(async (tx) => {
        await tx.auditLog.deleteMany({ where: { orgId } }); // no FK, so not cascaded
        await tx.org.delete({ where: { id: orgId } }); // cascades memberships, invites, tasks → everything
    });
    await cache.del(...members.map((m) => membershipCacheKey(orgId, m.userId)));
    // Phase 17: cancel this workspace's queued cells before deleting (a running run's jobs would 404 harmlessly, but waste calls).
    logger.info({ orgId, actorId }, "workspace deleted");
    return { deleted: true };
};
