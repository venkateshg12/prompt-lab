import { Router } from "express";
import authenticate from "../middleware/authenticate";
import { protectedApiLimiter } from "../config/rateLimiter";
import resolveOrg from "../middleware/resolveOrg";
import requireOrgRole from "../middleware/requireOrgRole";
import {
    listMyOrgsHandler,
    getOrgHandler,
    updateOrgHandler,
    deleteOrgHandler,
} from "../controllers/org.controller";
import { memberRouter } from "./member.route";
import { orgInviteRouter } from "./invite.route";
import { taskRouter } from "./task.route";
import { runRouter } from "./run.route";

export const orgRouter = Router();
orgRouter.use(authenticate, protectedApiLimiter);
orgRouter.get("/", listMyOrgsHandler);

// Every workspace route names its workspace in the path: authenticate (401) → resolveOrg (404 for
// non-members) → requireOrgRole (403).
const one = Router({ mergeParams: true });
one.use(resolveOrg);
one.get("/", requireOrgRole("tasks.read"), getOrgHandler);
one.patch("/", requireOrgRole("org.update"), updateOrgHandler);
one.delete("/", requireOrgRole("org.delete"), deleteOrgHandler);
one.use("/members", memberRouter);
one.use("/invites", orgInviteRouter);
one.use("/tasks", taskRouter);
one.use("/runs", runRouter);
orgRouter.use("/:orgId", one);
