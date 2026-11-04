import { Router } from "express";
import authenticate from "../middleware/authenticate";
import { protectedApiLimiter, inviteSourceLimiter, inviteTargetLimiter, invitePreviewLimiter } from "../config/rateLimiter";
import requireOrgRole from "../middleware/requireOrgRole";
import {
    createInviteHandler,
    listPendingInvitesHandler,
    revokeInviteHandler,
    getInvitePreviewHandler,
    acceptInviteHandler,
} from "../controllers/invite.controller";

/** Workspace-scoped router mounted at /orgs/:orgId/invites, behind org.route's `one` router. */
export const orgInviteRouter = Router({ mergeParams: true });

orgInviteRouter.post(
    "/",
    requireOrgRole("members.manage"),
    inviteSourceLimiter,
    inviteTargetLimiter,
    createInviteHandler
);
orgInviteRouter.get("/", requireOrgRole("members.manage"), listPendingInvitesHandler);
orgInviteRouter.delete("/:id", requireOrgRole("members.manage"), revokeInviteHandler);

/**
 * Global invitation router mounted at /invites. The token is in the body, never the path.
 * Accepting works without resolveOrg since the user is not yet a member.
 */
export const publicInviteRouter = Router();
publicInviteRouter.post("/preview", invitePreviewLimiter, getInvitePreviewHandler);
publicInviteRouter.post("/accept", authenticate, protectedApiLimiter, acceptInviteHandler);
