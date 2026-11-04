import { catchError } from "../utils/errors";
import appAssert from "../utils/errors/appAssert";
import { FORBIDDEN } from "../constants/https";
import { appErrorCode } from "../constants/appErrorCode";
import { can, type Permission } from "../constants/permissions";

const requireOrgRole = (permission: Permission) =>
    catchError(async (req, _res, next) => {
        appAssert(
            can(req.orgRole, permission),
            FORBIDDEN,
            "Your role in this organisation cannot perform this action",
            appErrorCode.Forbidden
        );
        next();
    });

export default requireOrgRole;
