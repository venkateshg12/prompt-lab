import { catchError, appAssert } from "../utils/errors";
import { OK, NOT_FOUND } from "../constants/https";
import { ok } from "../utils/api";
import { deleteOrgSchema, updateOrgSchema } from "@repo/types";
import { getOrgForMember, listMyOrgs, updateOrg } from "../services/org.service";
import { hardDeleteOrg } from "../services/deletion.service";

export const listMyOrgsHandler = catchError(async (req, res) => {
    const orgs = await listMyOrgs(req.userId);
    res.status(OK).json(ok(orgs));
});

export const getOrgHandler = catchError(async (req, res) => {
    const org = await getOrgForMember(req.orgId);
    appAssert(org, NOT_FOUND, "Workspace not found");
    res.status(OK).json(ok({ org, role: req.orgRole }));
});

export const updateOrgHandler = catchError(async (req, res) => {
    const data = updateOrgSchema.parse(req.body);
    const updated = await updateOrg(req.orgId, req.userId, data);
    res.status(OK).json(ok(updated));
});

export const deleteOrgHandler = catchError(async (req, res) => {
    const { confirmName } = deleteOrgSchema.parse(req.body ?? {});
    const result = await hardDeleteOrg(req.orgId, req.userId, confirmName);
    res.status(OK).json(ok(result));
});
