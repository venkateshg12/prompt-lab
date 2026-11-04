import { prisma } from "../db/prisma";
import { cache } from "../utils/cache";
import { appAssert } from "../utils/errors";
import { withTransaction } from "../utils/db";
import { BAD_REQUEST, NOT_FOUND } from "../constants/https";
import { logger } from "../utils/logger";
import { runWithRequestContext } from "../utils/requestContext";
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
    // Cancel the workspace's queued/running runs first, so cells that are still queued record `skipped`
    // instead of calling a model for a workspace that is about to disappear.
    await runWithRequestContext({ requestId: "delete-org", orgId }, () =>
        prisma.run.updateMany({ where: { status: { in: ["queued", "running"] } }, data: { status: "cancelled", finishedAt: new Date() } })
    );
    logger.info({ orgId, actorId }, "workspace deleted");
    return { deleted: true };
};
