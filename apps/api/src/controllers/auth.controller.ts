import { z } from "zod";
import { CREATED, NOT_FOUND, OK, UNAUTHORIZED } from "../constants/https";
import { changePasswordService, createAccount, loginUser, refreshUserAccessToken, resendVerificationEmail, resetPassword, sentResetPasswordEmail, updateProfileService, revokeSessions, verifyEmail } from "../services/auth.service";
import { catchError, appAssert } from "../utils/errors";
import { changePasswordSchema, emailSchema, loginInSchema, registerSchema, resetPasswordSchema, updateProfileSchema } from "@repo/types";
import { clearAuthCookies, getAccessTokenCookieOptions, getRefreshTokenCookieOptions, setAuthCookies, verifyAccessTokenIgnoringExpiry } from "../utils/auth";
import { prisma } from "../db/prisma";
import { isUuid } from "../db/errors";
import { toSafeUser } from "../types/user.types";
import { ok } from "../utils/api";

export const registerHandler = catchError(
    async (req, res) => {
        // validate request
        const request = registerSchema.parse({
            ...req.body,
            userAgent: req.headers["user-agent"]
        });

        // call a service 
        await createAccount(request);

        // return response
        return res.status(CREATED).json(ok({ title: "Account created Successfully", "message": "We've sent an account activation link to your email address. Please check your inbox, and your spam folder too, to activate your account." }));
    }
)

export const loginHandler = catchError(

    async (req, res) => {
        // validate request
        const request = loginInSchema.parse({
            ...req.body,
            userAgent: req.headers["user-agent"],
        })

        const { user, accessToken, refreshToken } = await loginUser(request);

        setAuthCookies({ res, accessToken, refreshToken })
            .status(OK)
            .json(ok({
                user,
                message: "Login Successful!"
            }))
    }
)

export const logoutHandler = catchError(
    async (req, res) => {
        /*
          Expiry is ignored on purpose: after 15 idle minutes the access token has lapsed, and
          skipping the delete then left the 30-day session — and any copy of its refresh token —
          alive after the user had logged out. The signature is still verified.
         */
        const bearer = req.get("authorization")?.replace(/^Bearer\s+/i, "");
        const accessToken = (req.cookies.accessToken as string | undefined) || (bearer ? bearer : undefined);
        const { payload } = accessToken ? verifyAccessTokenIgnoringExpiry(accessToken) : {};
        if (payload && isUuid(payload.sessionId)) {
            await revokeSessions({ id: payload.sessionId });
        }

        clearAuthCookies(res).status(OK).json(ok({ message: "Logout Successful!" }));
    }
)

export const refreshHandler = catchError(
    async (req, res) => {
        const refreshToken = req.cookies.refreshToken as string | undefined;
        appAssert(refreshToken, UNAUTHORIZED, "Missing refresh Token");

        const { accessToken, newRefreshToken } = await refreshUserAccessToken(refreshToken);

        // Refresh tokens are single-use, so a new one is issued on every refresh.
        return res
            .status(OK)
            .cookie("refreshToken", newRefreshToken, getRefreshTokenCookieOptions())
            .cookie("accessToken", accessToken, getAccessTokenCookieOptions())
            .json(ok({
                message: "Access token refreshed"
            }))
    }
)

export const verifyEmailHandler = catchError(
    async (req, res) => {
        // Express 5 types a wildcard param as string | string[]; a link only ever carries one.
        const token = z.string().min(1).parse(req.params.token);

        const { user, accessToken, refreshToken } = await verifyEmail(token, req.headers["user-agent"]);

        return setAuthCookies({ res, accessToken, refreshToken }).status(OK).json(ok({
            user,
            message: "Email verified successfully!"
        }));
    }
)

export const resendVerificationHandler = catchError(
    async (req, res) => {
        const { email } = emailSchema.parse(req.body);
        const result = await resendVerificationEmail(email);
        return res.status(OK).json(ok(result));
    }
)

export const forgotPasswordHandler = catchError(
    async (req, res) => {
        const request = emailSchema.parse(req.body);

        // call the service
        const sendLinkMessage = await sentResetPasswordEmail(request.email);
        return res.status(OK).json(ok(sendLinkMessage))
    }
)

export const resetPasswordHandler = catchError(
    async (req, res) => {
        const { token, password } = resetPasswordSchema.parse(req.body);
        await resetPassword({ token, password });

        clearAuthCookies(res)
            .status(OK)
            .json(ok("Password reset successful"));
    }
);

export const getProfileData = catchError(
    async (req, res) => {
        const userId = req.userId;
        const user = await prisma.user.findUnique({ where: { id: userId } });
        appAssert(user !== null, NOT_FOUND, "User not found!");
        res.status(OK).json(ok({user: toSafeUser(user)}));
    }
)

export const updateProfileHandler = catchError(
    async (req, res) => {
        const data = updateProfileSchema.parse(req.body);
        const user = await updateProfileService(req.userId, data);
        return res.status(OK).json(ok({ user }));
    }
)

export const changePasswordHandler = catchError(
    async (req, res) => {
        const data = changePasswordSchema.parse(req.body);
        const result = await changePasswordService(req.userId, req.sessionId, data);
        return res.status(OK).json(ok(result));
    }
)