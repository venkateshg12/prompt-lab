import { catchError } from "../utils/errors";
import { CREATED, OK } from "../constants/https";
import { ok } from "../utils/api";
import { inviteSchema, inviteTokenSchema, idSchema } from "@repo/types";
import {
    createInvite,
    listPendingInvites,
    revokeInvite,
    getInvitePreview,
    acceptInvite,
} from "../services/invite.service";

export const createInviteHandler = catchError(async (req, res) => {
    const body = inviteSchema.parse(req.body);
    const invite = await createInvite(
        { orgId: req.orgId, userId: req.userId, role: req.orgRole },
        body
    );
    res.status(CREATED).json(ok({ invite }));
});

export const listPendingInvitesHandler = catchError(async (req, res) => {
    const invites = await listPendingInvites(req.orgId);
    res.status(OK).json(ok({ invites }));
});

export const revokeInviteHandler = catchError(async (req, res) => {
    const inviteId = idSchema("invitation id").parse(req.params.id);
    const result = await revokeInvite(
        req.orgId,
        inviteId,
        req.userId
    );
    res.status(OK).json(ok(result));
});

// The token is read from the POST body only: a path or query string would reach access and proxy logs.
export const getInvitePreviewHandler = catchError(async (req, res) => {
    const { token } = inviteTokenSchema.parse(req.body);
    const preview = await getInvitePreview(token);
    res.status(OK).json(ok(preview));
});

export const acceptInviteHandler = catchError(async (req, res) => {
    const { token } = inviteTokenSchema.parse(req.body);
    const result = await acceptInvite(req.userId, token);
    res.status(OK).json(ok(result));
});
