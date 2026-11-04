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

export const authRoutes = Router();

// prefix: /auth. Phase 06 puts the source/account/pair limiters in front of each route.
authRoutes.post("/register", registerHandler);
authRoutes.post("/login", loginHandler);
authRoutes.get("/refresh", refreshHandler);
authRoutes.get("/logout", logoutHandler);
authRoutes.get("/verify/:token", verifyEmailHandler);
authRoutes.post("/verify/resend", resendVerificationHandler);
authRoutes.post("/password/forgot", forgotPasswordHandler);
// The token travels in the body, not the path, so the access log never records it (Phase 05 §5).
authRoutes.post("/password/reset", resetPasswordHandler);
authRoutes.post("/google", googleAuthHandler);
authRoutes.get("/me", authenticate, getProfileData);
authRoutes.patch("/me", authenticate, updateProfileHandler);
authRoutes.post("/me/password", authenticate, changePasswordHandler);
