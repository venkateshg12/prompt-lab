import { Router } from "express";
import {
    loginHandler,
    logoutHandler,
    refreshHandler,
    registerHandler,
    resendVerificationHandler,
    verifyEmailHandler
} from "../controllers/auth.controller";

export const authRoutes = Router();

// prefix: /auth. Phase 06 puts the source/account/pair limiters in front of each route.
authRoutes.post("/register", registerHandler);
authRoutes.post("/login", loginHandler);
authRoutes.get("/refresh", refreshHandler);
authRoutes.get("/logout", logoutHandler);
authRoutes.get("/verify/:token", verifyEmailHandler);
authRoutes.post("/verify/resend", resendVerificationHandler);
