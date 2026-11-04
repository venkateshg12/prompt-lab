import crypto from "crypto";
import { ChangePasswordSchema, CredentialSchema, LoginInSchema, UpdateProfileSchema } from "@repo/types";
import { prisma, type Prisma } from "../db/prisma";
import { nullIfNotFound } from "../db/errors";
import { appAssert } from "../utils/errors";
import { BAD_REQUEST, CONFLICT, NOT_FOUND, UNAUTHORIZED } from "../constants/https";
import { appErrorCode } from "../constants/appErrorCode";
import { VerificationLinkType } from "../constants/verificationLinkType";
import { tenMinutesFromNow, thirtyDaysFromNow } from "../utils/date";
import {
    compareValue,
    createVerificationToken,
    hashValue,
    hashVerificationToken,
    refreshTokenSignOptions,
    refreshTokenVerifyOptions,
    signToken,
    verifyToken
} from "../utils/auth";
import { RefreshTokenPayload } from "../types/auth.types";
import { toSafeUser, type UserRecord } from "../types/user.types";
import { cache, sessionCacheKey } from "../utils/cache";
import { withTransaction } from "../utils/db";
import { createPersonalOrg } from "./org.service";
import { EmailProducer } from "../jobs/producers/email.producer";

/*
  How long a just-replaced refresh token is still honoured. The client serialises refreshes within a
  tab, but two tabs share the cookie and can both refresh at the same moment; without a grace window
  the slower one would look like a replayed token and sign the user out everywhere.
 */
const REFRESH_REUSE_GRACE_MS = 30 * 1000;

/*
  Compared against when the email has no account (or no password), so a failed login costs one
  bcrypt comparison either way and response time doesn't reveal which emails are registered.
 */
const dummyPasswordHash = hashValue(crypto.randomBytes(32).toString("hex"));

const GENERIC_RESEND_MESSAGE =
    "If that account exists and is not yet verified, a new verification link has been sent. Please check your spam folder too.";

// Stored normalised, so "Foo@x.com" and "foo@x.com" can't become two accounts. The shared Zod
// schemas normalise lookups the same way.
const normaliseEmail = (email: string) => email.trim().toLowerCase();

const passwordMatches = (user: UserRecord, candidate: string) =>
    user.password ? compareValue(candidate, user.password) : Promise.resolve(false);

/**
 * Deletes the matching sessions and clears their cached "active" state, so an access token for one
 * of them is rejected on its very next request. Every revocation goes through here: deleting session
 * rows directly would leave `authenticate` trusting its cache for up to a minute. Returns how many
 * sessions were revoked.
 */
export const revokeSessions = async (where: Prisma.SessionWhereInput) => {
    const sessions = await prisma.session.findMany({ where, select: { id: true } });
    if (sessions.length === 0) return 0;

    const ids = sessions.map((session) => session.id);
    // By id, not by the original filter: a session created after the find is not part of this revocation.
    await prisma.session.deleteMany({ where: { id: { in: ids } } });
    await cache.del(...ids.map(sessionCacheKey));
    return ids.length;
};

const signAccessToken = (user: UserRecord, sessionId: string) =>
    signToken({
        userId: user.id,
        role: user.role,
        sessionId
    });

const signRefreshToken = (sessionId: string, jti: string) =>
    signToken({ sessionId, jti }, refreshTokenSignOptions);

/**
 * Opens a new session and signs its first token pair. Every sign-in path (password, email
 * verification, Google) goes through here so they all record the refresh-token id that rotation
 * checks against.
 */
export const createSessionAndTokens = async (user: UserRecord, userAgent?: string) => {
    const refreshJti = crypto.randomUUID();
    const session = await prisma.session.create({
        data: {
            userId: user.id,
            userAgent,
            refreshJti,
            expiresAt: thirtyDaysFromNow()
        }
    });

    return {
        accessToken: signAccessToken(user, session.id),
        refreshToken: signRefreshToken(session.id, refreshJti)
    };
};

/*
  Redeems a single-use link: finds it by the digest of the emailed token, then deletes it by id. The
  delete only succeeds for the first of two concurrent clicks, so a link can never be used twice.
 */
const consumeVerificationLink = async (token: string, type: VerificationLinkType) => {
    const link = await prisma.verificationLink.findFirst({
        where: { token: hashVerificationToken(token), type, expiresAt: { gt: new Date() } }
    });
    if (!link) return null;

    const { count } = await prisma.verificationLink.deleteMany({ where: { id: link.id } });
    return count === 1 ? link : null;
};

const issueEmailVerificationLink = async (user: UserRecord) => {
    await prisma.verificationLink.deleteMany({
        where: { userId: user.id, type: VerificationLinkType.EmailVerification }
    });

    const { token, tokenHash } = createVerificationToken();
    await prisma.verificationLink.create({
        data: {
            userId: user.id,
            type: VerificationLinkType.EmailVerification,
            token: tokenHash,
            expiresAt: tenMinutesFromNow()
        }
    });

    await EmailProducer.sendVerifyEmail({ userId: user.id, email: user.email, verificationToken: token });
};


export const createAccount = async (data: CredentialSchema) => {
    const email = normaliseEmail(data.email);

    //verify existing user doesn't exist
    const existingUser = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    appAssert(!existingUser, CONFLICT, "User already exists!");

    const password = await hashValue(data.password);

    // The user, their workspace and the owner membership commit together — an account without a
    // workspace could never do anything. The email is enqueued only after the commit.
    const user = await withTransaction(async (tx) => {
        const created = await tx.user.create({ data: { name: data.name, email, password } });
        await createPersonalOrg(created, tx);
        return created;
    });

    await issueEmailVerificationLink(user);

    // return user
    return { user: toSafeUser(user) };
}


export const loginUser = async ({ email, password, userAgent }: LoginInSchema) => {

    //get the user by email
    const user = await prisma.user.findUnique({ where: { email: normaliseEmail(email) } });

    // validate the password from the request — against a dummy hash when there's nothing to compare,
    // so an unknown email takes as long to reject as a wrong password
    const isValid = user?.password
        ? await passwordMatches(user, password)
        : await compareValue(password, await dummyPasswordHash).then(() => false);

    appAssert(user && isValid, UNAUTHORIZED, "Invalid email or password");

    if (!user.verified) {
        await issueEmailVerificationLink(user);
        appAssert(false, UNAUTHORIZED, "Your email is not verified yet. We've sent you a new verification link, please check your inbox and spam folder.");
    }

    const { accessToken, refreshToken } = await createSessionAndTokens(user, userAgent);

    // return user & tokens
    return { user: toSafeUser(user), accessToken, refreshToken };
}


/**
 * Exchanges a refresh token for a new access token AND a new refresh token. Each refresh token is
 * single-use: presenting one that has already been exchanged means it was copied, so the whole
 * session is revoked — both the thief and the victim are signed out, and the thief's copy is dead.
 */
export const refreshUserAccessToken = async (refreshToken: string) => {
    const now = Date.now();
    const { payload } = verifyToken<RefreshTokenPayload>(refreshToken, refreshTokenVerifyOptions);
    appAssert(payload && payload.jti, UNAUTHORIZED, "Invalid refresh token", appErrorCode.InvalidAccessToken);

    const session = await prisma.session.findUnique({ where: { id: payload.sessionId } });
    appAssert(session && session.expiresAt.getTime() > now, UNAUTHORIZED, "Session Expired!", appErrorCode.InvalidAccessToken);

    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    appAssert(user, UNAUTHORIZED, "User not found", appErrorCode.InvalidAccessToken);

    // Rotate only if the presented token is still the current one. Doing it as a conditional update
    // means two concurrent refreshes can't both rotate and leave one of them holding a dead token.
    const newJti = crypto.randomUUID();
    const { count: rotated } = await prisma.session.updateMany({
        where: { id: session.id, refreshJti: payload.jti },
        data: {
            refreshJti: newJti,
            prevRefreshJti: payload.jti,
            rotatedAt: new Date(now),
            expiresAt: thirtyDaysFromNow()
        }
    });

    let currentJti: string;

    if (rotated === 1) {
        currentJti = newJti;
    } else {
        // Lost the race, or the token is stale. Re-read to see which.
        const latest = await prisma.session.findUnique({ where: { id: session.id } });
        const isRecentlyReplaced =
            latest?.refreshJti &&
            latest.prevRefreshJti === payload.jti &&
            latest.rotatedAt &&
            now - latest.rotatedAt.getTime() < REFRESH_REUSE_GRACE_MS;

        if (!isRecentlyReplaced) {
            await revokeSessions({ id: session.id });
            appAssert(false, UNAUTHORIZED, "Session revoked", appErrorCode.InvalidAccessToken);
        }

        currentJti = latest.refreshJti!;
    }

    return {
        accessToken: signAccessToken(user, session.id),
        newRefreshToken: signRefreshToken(session.id, currentJti)
    };
}

export const verifyEmail = async (token: string, userAgent?: string) => {
    const verificationLink = await consumeVerificationLink(token, VerificationLinkType.EmailVerification);
    appAssert(verificationLink, BAD_REQUEST, "Verification link has expired or is invalid.");

    const user = await nullIfNotFound(
        prisma.user.update({ where: { id: verificationLink.userId }, data: { verified: true } })
    );
    appAssert(user, NOT_FOUND, "User not found! Please register");

    const { accessToken, refreshToken } = await createSessionAndTokens(user, userAgent);

    return { user: toSafeUser(user), accessToken, refreshToken };
}

/*
  Answers the same way whether or not the account exists or is already verified — the old
  "User does not exist" / "already verified" replies let anyone test which emails are registered.
 */
export const resendVerificationEmail = async (email: string) => {
    const user = await prisma.user.findUnique({ where: { email: normaliseEmail(email) } });

    if (user && !user.verified) {
        await issueEmailVerificationLink(user);
    }

    return { message: GENERIC_RESEND_MESSAGE };
}

export const sentResetPasswordEmail = async (email: string) => {
    const genericMessage = "If an account with that email exists, a password reset link has been sent. Please check your spam folder too.";

    // get the user by email
    const user = await prisma.user.findUnique({ where: { email: normaliseEmail(email) } });
    if (!user) {
        return { message: genericMessage };
    }

    // Only the newest reset link is valid; older ones sitting in an inbox are invalidated.
    await prisma.verificationLink.deleteMany({
        where: { userId: user.id, type: VerificationLinkType.PasswordReset }
    });

    const { token, tokenHash } = createVerificationToken();
    await prisma.verificationLink.create({
        data: {
            userId: user.id,
            type: VerificationLinkType.PasswordReset,
            token: tokenHash,
            expiresAt: tenMinutesFromNow()
        }
    });

    await EmailProducer.sendPasswordReset({ userId: user.id, email: user.email, resetToken: token });

    return { message: genericMessage }
}

export const resetPassword = async ({ token, password }: { token: string; password: string }) => {
    const verificationLink = await consumeVerificationLink(token, VerificationLinkType.PasswordReset);
    appAssert(verificationLink, BAD_REQUEST, "Invalid or expired reset link");

    const user = await prisma.user.findUnique({ where: { id: verificationLink.userId } });
    appAssert(user, NOT_FOUND, "User not found");

    await prisma.user.update({ where: { id: user.id }, data: { password: await hashValue(password) } });

    await prisma.verificationLink.deleteMany({
        where: { userId: user.id, type: VerificationLinkType.PasswordReset }
    });

    await revokeSessions({ userId: user.id });

    return { message: "Password reset successful" };
}

export const updateProfileService = async (userId: string, data: UpdateProfileSchema) => {
    const user = await nullIfNotFound(
        prisma.user.update({ where: { id: userId }, data: { name: data.name } })
    );
    appAssert(user, NOT_FOUND, "User not found");

    return toSafeUser(user);
};

export const changePasswordService = async (
    userId: string,
    currentSessionId: string,
    data: ChangePasswordSchema
) => {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    appAssert(user, NOT_FOUND, "User not found");
    appAssert(
        user.authProvider === "local",
        BAD_REQUEST,
        "Password change is not available for accounts signed in with Google"
    );

    const isValid = await passwordMatches(user, data.currentPassword);
    appAssert(isValid, UNAUTHORIZED, "Current password is incorrect");

    await prisma.user.update({
        where: { id: user.id },
        data: { password: await hashValue(data.newPassword) }
    });

    // Sign the user out of every other device/session, keep the current one active
    await revokeSessions({ userId: user.id, id: { not: currentSessionId } });

    return { message: "Password changed successfully. You've been signed out of all other devices." };
}
