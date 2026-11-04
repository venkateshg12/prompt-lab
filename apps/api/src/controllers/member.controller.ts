import { catchError } from "../utils/errors";
import { OK } from "../constants/https";
import { ok } from "../utils/api";
import { idSchema, changeMemberRoleSchema } from "@repo/types";
import {
    listMembers,
    changeMemberRole,
    removeMember,
} from "../services/member.service";

export const listMembersHandler = catchError(async (req, res) => {
    const members = await listMembers(req.orgId);
    res.status(OK).json(ok({ members }));
});

export const changeMemberRoleHandler = catchError(async (req, res) => {
    const targetUserId = idSchema("user id").parse(req.params.userId);
    const body = changeMemberRoleSchema.parse(req.body);
    const result = await changeMemberRole(
        req.orgId,
        targetUserId,
        body.role,
        req.userId,
        req.orgRole
    );
    res.status(OK).json(ok(result));
});

export const removeMemberHandler = catchError(async (req, res) => {
    const targetUserId = idSchema("user id").parse(req.params.userId);
    const result = await removeMember(
        req.orgId,
        targetUserId,
        req.userId,
        req.orgRole
    );
    res.status(OK).json(ok(result));
});
