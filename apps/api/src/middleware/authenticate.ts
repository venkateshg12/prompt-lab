import { appAssert, catchError } from "../utils/errors";
import { UNAUTHORIZED } from "../constants/https";
import { appErrorCode } from "../constants/appErrorCode";
import { verifyToken } from "../utils/auth";
import { prisma } from "../db/prisma";
import { isUuid } from "../db/errors";
import { setRequestContext } from "../utils/requestContext";
import { AccessTokenPayload } from "../types/auth.types";

/*
  A valid signature only proves the token was issued, not that its session is still alive. Without
  the session lookup, logout, password reset, password change and "sign out this device" left the
  access token working for up to its full 15 minutes. The signature is checked first, so forged or
  malformed tokens never reach the database.
 */
const assertSessionActive = async (sessionId: AccessTokenPayload["sessionId"]) => {
    // Phase 07: return early on a cached "1" for cache:session:<id>, and cache it for 60 s after this check.
    // A token minted before ids were UUIDs (or a forged one) can't name a session: 401, not a query.
    const sessionIsActive =
        isUuid(sessionId) &&
        (await prisma.session.count({ where: { id: sessionId, expiresAt: { gt: new Date() } } })) > 0;
    appAssert(sessionIsActive, UNAUTHORIZED, "Session expired", appErrorCode.InvalidAccessToken);
};

const authenticate = catchError(async (req, _res, next) => {
    const bearer = req.get("authorization")?.replace(/^Bearer\s+/i, "");
    const accessToken = (req.cookies.accessToken as string | undefined) || (bearer ? bearer : undefined);
    appAssert(accessToken, UNAUTHORIZED, "Not Authorized", appErrorCode.InvalidAccessToken);

    const { error, payload } = verifyToken(accessToken);

    appAssert(
        payload,
        UNAUTHORIZED,
        error == "jwt expired" ? "Token expired" : "Invalid token",
        error == "jwt expired" ? appErrorCode.TokenExpired : appErrorCode.InvalidAccessToken
    );

    await assertSessionActive(payload.sessionId);

    req.userId = payload.userId;
    req.sessionId = payload.sessionId;
    req.role = payload.role;
    setRequestContext({ userId: payload.userId });
    next();
});

export default authenticate;
