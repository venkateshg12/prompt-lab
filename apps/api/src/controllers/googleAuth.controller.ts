import { LoginTicket, OAuth2Client } from "google-auth-library";
import { z } from "zod";
import { prisma, type Prisma } from "../db/prisma";
import { toSafeUser } from "../types/user.types";
import { catchError, appAssert } from "../utils/errors";
import { INTERNAL_SERVER_ERROR, OK, UNAUTHORIZED } from "../constants/https";
import { GOOGLE_CLIENT_ID } from "../constants/env";
import { setAuthCookies } from "../utils/auth";
import { createSessionAndTokens, revokeSessions } from "../services/auth.service";
import { logger } from "../utils/logger";
import { ok } from "../utils/api";

const client = new OAuth2Client(GOOGLE_CLIENT_ID);

const googleAuthSchema = z.object({ idToken: z.string().min(1) });

export const googleAuthHandler = catchError(async (req, res) => {
    const { idToken } = googleAuthSchema.parse(req.body);
    appAssert(GOOGLE_CLIENT_ID, INTERNAL_SERVER_ERROR, "Google Client ID is not configured on the server");

    let ticket: LoginTicket | undefined;
    try {
        ticket = await client.verifyIdToken({
            idToken: idToken,
            audience: GOOGLE_CLIENT_ID,
        });
    } catch (err: any) {
        logger.warn({ err }, "Google ID token verification failed");
        appAssert(false, UNAUTHORIZED, "Invalid Google ID token");
    }

    const payload = ticket.getPayload();
    appAssert(payload, UNAUTHORIZED, "Invalid token payload");

    const { email: rawEmail, email_verified, name, sub: googleId, picture: avatar } = payload;
    appAssert(rawEmail && email_verified, UNAUTHORIZED, "Unverified Google account or email missing");
    const email = rawEmail.trim().toLowerCase();

    // Find existing user by email
    const existing = await prisma.user.findUnique({ where: { email } });

    let user;
    if (existing) {
        /*
          An unverified local account was never proven to belong to this email's owner — anyone
          can register someone else's address. Google has now proven ownership, so the account is
          taken over by its rightful owner: the unproven password is dropped, and any sessions or
          pending links created under it are revoked. Otherwise whoever pre-registered the address
          would keep a working password on the victim's now-verified account.
         */
        const changes: Prisma.UserUpdateInput = { verified: true };
        if (!existing.verified && existing.authProvider === "local") {
            changes.password = null;
            changes.authProvider = "google";
            await revokeSessions({ userId: existing.id });
            await prisma.verificationLink.deleteMany({ where: { userId: existing.id } });
        }

        // Link Google profile if missing or update details
        if (!existing.googleId) {
            changes.googleId = googleId;
        }

        if (avatar && existing.avatar !== avatar) {
            changes.avatar = avatar;
        }

        user = await prisma.user.update({ where: { id: existing.id }, data: changes });
    } else {
        // Create new user (verified Google account)
        user = await prisma.user.create({
            data: {
                email,
                name: name || email.split("@")[0],
                googleId,
                authProvider: "google",
                avatar,
                verified: true,
            },
        });
    }

    // Phase 10: no personal workspace; the web app sends a user with no memberships to onboarding.

    const { accessToken, refreshToken } = await createSessionAndTokens(user, req.headers["user-agent"]);

    // Set HttpOnly Cookies and Return SuccessResponse
    setAuthCookies({ res, accessToken, refreshToken })
        .status(OK)
        .json(ok({
            user: toSafeUser(user),
            message: "Google login successful!"
        }));
});


/*

Receive ID Token
        │
        ▼
Verify it's really from Google
        │
        ▼
Extract Google user's details
        │
        ▼
Find existing user by email
        │
   ┌────┴────┐
   │         │
Exists?     No?
   │         │
Link info   Create user
   └────┬────┘
        ▼
Create application session
        ▼
Generate JWT access & refresh tokens
        ▼
Set HttpOnly cookies
        ▼
Return authenticated user */