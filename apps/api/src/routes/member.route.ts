import { Router } from "express";
import requireOrgRole from "../middleware/requireOrgRole";
import {
    listMembersHandler,
    changeMemberRoleHandler,
    removeMemberHandler,
} from "../controllers/member.controller";

// Mounted behind org.route's `one` router: already authenticated, rate-limited and resolved to a workspace.
export const memberRouter = Router({ mergeParams: true });

// Any workspace member can view the member directory
memberRouter.get("/", requireOrgRole("tasks.read"), listMembersHandler);

// Only admins/owners can change member roles
memberRouter.patch("/:userId", requireOrgRole("members.manage"), changeMemberRoleHandler);

// Members can leave themselves; admins/owners can remove members (verified in service)
memberRouter.delete("/:userId", removeMemberHandler);
