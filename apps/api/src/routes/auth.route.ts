import { Router } from "express";
import {
    changePasswordHandler,
    forgotPasswordHandler,
    getProfileData,
    loginHandler,
    logoutHandler,
    refreshHandler,
    registerHandler,
    resendVerificationHandler,
    resetPasswordHandler,
    updateProfileHandler,
    verifyEmailHandler
} from "../controllers/auth.controller";
import { googleAuthHandler } from "../controllers/googleAuth.controller";
import authenticate from "../middleware/authenticate";
import { NODE_ENV } from "../constants/env";
import { devMailbox, type DevMailEntry } from "../utils/email/devMailbox";
import {
    forgotPasswordAccountLimiter,
    forgotPasswordLimiter,
    forgotPasswordSourceLimiter,
    loginAccountLimiter,
    loginLimiter,
    loginSourceLimiter,
    protectedApiLimiter,
    refreshTokenLimiter,
    refreshTokenSourceLimiter,
    registerLimiter,
    registerSourceLimiter,
    resendVerificationAccountLimiter,
    resendVerificationSourceLimiter,
    resetPasswordLimiter,
    verifyEmailLimiter
} from "../config/rateLimiter";

export const authRoutes = Router();

// prefix : /auth
authRoutes.post("/register", registerSourceLimiter, registerLimiter, registerHandler);
// Three axes, cheapest first: this source, this account, then the (source, account) pair.
authRoutes.post("/login", loginSourceLimiter, loginAccountLimiter, loginLimiter, loginHandler);
authRoutes.get("/refresh", refreshTokenSourceLimiter, refreshTokenLimiter, refreshHandler);
authRoutes.get("/logout", logoutHandler);
authRoutes.get("/verify/:token", verifyEmailLimiter, verifyEmailHandler);
authRoutes.post("/verify/resend", resendVerificationSourceLimiter, resendVerificationAccountLimiter, resendVerificationHandler);
authRoutes.post("/password/forgot", forgotPasswordSourceLimiter, forgotPasswordAccountLimiter, forgotPasswordLimiter, forgotPasswordHandler);
// The token travels in the body, not the path, so the access log never records it (Phase 05 §5).
authRoutes.post("/password/reset", resetPasswordLimiter, resetPasswordHandler);
// No email in this body, so the pair-keyed limiter would put every Google sign-in from a source
// into one bucket. The source limiter is the one that means anything here.
authRoutes.post("/google", loginSourceLimiter, googleAuthHandler);
authRoutes.get("/me", authenticate, protectedApiLimiter, getProfileData);
authRoutes.patch("/me", authenticate, protectedApiLimiter, updateProfileHandler);
authRoutes.post("/me/password", authenticate, protectedApiLimiter, changePasswordHandler);

if (NODE_ENV !== "production") {
    // Dev/test only: the last email the in-memory mailbox "sent" (Phase 28 tests and Playwright read links here).
    authRoutes.get("/dev/latest-link", (req, res) => {
        const email = req.query.email as string | undefined;
        const entry = devMailbox
            .slice()
            .reverse()
            .find((m: DevMailEntry) => !email || m.to.toLowerCase() === email.toLowerCase());

        res.json({
            ok: true,
            email: entry || null,
        });
    });
}
