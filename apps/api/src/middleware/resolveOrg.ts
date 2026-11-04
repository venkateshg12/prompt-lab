import { catchError, appAssert } from "../utils/errors";
import { idSchema } from "@repo/types";
import { resolveMembership } from "../services/org.service";
import { setRequestContext } from "../utils/requestContext";
import { BAD_REQUEST } from "../constants/https";

/*
  Runs after authenticate. ADAPT: the workspace id comes from the path (`/orgs/:orgId/...`) first;
  X-Org-Id is accepted for the web client's convenience, but a header that disagrees with the path is a
  client bug. A non-member gets a 404: the workspace "doesn't exist" for them.
 */
const resolveOrg = catchError(async (req, _res, next) => {
    const fromPath = typeof req.params.orgId === "string" ? req.params.orgId : undefined;
    const fromHeader = req.get("x-org-id") || undefined;
    appAssert(
        !fromPath || !fromHeader || fromPath.toLowerCase() === fromHeader.toLowerCase(),
        BAD_REQUEST,
        "X-Org-Id does not match the workspace in the URL"
    );
    const raw = fromPath ?? fromHeader;
    const requested = raw ? idSchema("workspace id").parse(raw) : undefined;

    const { orgId, role } = await resolveMembership(req.userId, requested);
    req.orgId = orgId;
    req.orgRole = role;
    setRequestContext({ orgId, userId: req.userId });
    next();
});

export default resolveOrg;
