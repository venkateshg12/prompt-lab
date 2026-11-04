import { Job, UnrecoverableError } from "bullmq";
import { z } from "zod";
import { PasswordResetPayload, VerifyEmailPayload } from "../interfaces/jobPayload";
import { getPasswordResetEmail, getVerificationEmail } from "../../utils/email";
import { sendEmail } from "../../services/gmail.service";
import { AppError } from "../../utils/errors";
import { appErrorCode } from "../../constants/appErrorCode";
import { GMAIL_REFRESH_TOKEN, NODE_ENV } from "../../constants/env";
import { BAD_REQUEST, TOO_MANY_REQUESTS } from "../../constants/https";
import { logger } from "../../utils/logger";
import { runWithRequestContext } from "../../utils/requestContext";
import { prisma } from "../../db/prisma";
import { isUuid } from "../../db/errors";

// A job enqueued before ids were UUIDs can't name a row any more: treat it as "no longer exists".
const findUser = (userId: string) =>
    isUuid(userId) ? prisma.user.findUnique({ where: { id: userId } }) : Promise.resolve(null);

const verifyEmailPayloadSchema = z.object({
    userId: z.string().min(1, "User ID is required"),
    email: z.string().email("Invalid email format"),
    verificationToken: z.string().min(1, "Verification token is required"),
});

const passwordResetPayloadSchema = z.object({
    userId: z.string().min(1, "User ID is required"),
    email: z.string().email("Invalid email format"),
    resetToken: z.string().min(1, "Reset token is required"),
});

type EmailContent = { subject: string; text: string; html: string };

/*
  Sends through the Gmail API. Failures a later attempt can fix (Gmail rate limit, Google 5xx, network)
  are rethrown for BullMQ's backoff; failures that need a human (not authorized, invalid grant, a
  rejected recipient) are UnrecoverableError, so the job fails once instead of five times.

  In development without a refresh token, the email is logged instead — the same convenience
  e-commerce's Resend sender had, so sign-up works before the one-time Gmail authorization.
 */
import { devMailbox } from "../../utils/email/devMailbox";

const deliver = async (to: string, content: EmailContent) => {
    if (!GMAIL_REFRESH_TOKEN && NODE_ENV !== "production") {
        const linkMatch = content.text.match(/(https?:\/\/[^\s]+)/);
        const tokenMatch = content.text.match(/(?:auth\/verify|password\/reset|invites)\/([^\s]+)/);
        devMailbox.push({
            to,
            subject: content.subject,
            text: content.text,
            link: linkMatch ? linkMatch[1] : undefined,
            token: tokenMatch ? tokenMatch[1] : undefined,
            createdAt: new Date(),
        });
        if (devMailbox.length > 100) devMailbox.shift();
        logger.warn({ to: "[dev]", subject: content.subject, body: content.text }, "[dev] email not sent (Gmail not authorized)");
        return { messageId: "dev-console" };
    }
    try {
        return await sendEmail({ to, ...content });
    } catch (error) {
        // sendEmail validates its input with Zod: a bad address will be just as bad next time.
        if (error instanceof z.ZodError) throw new UnrecoverableError(`Invalid email: ${error.message}`);
        const retryable =
            error instanceof AppError &&
            error.errorCode === appErrorCode.GmailSendFailed &&
            error.statusCode !== BAD_REQUEST;
        const rateLimited = error instanceof AppError && error.statusCode === TOO_MANY_REQUESTS;
        if (retryable || rateLimited || !(error instanceof AppError)) throw error;
        throw new UnrecoverableError(`${error.errorCode}: ${error.message}`);
    }
};

export async function processVerifyEmail(job: Job<VerifyEmailPayload>) {
    return runWithRequestContext({ requestId: job.id! }, async () => {
        const parsed = verifyEmailPayloadSchema.safeParse(job.data);
        if (!parsed.success) {
            throw new UnrecoverableError(`Malformed job payload: ${parsed.error.message}`);
        }
        const { userId, email, verificationToken } = parsed.data;

        job.log(`[Start] Sending Verification Email to ${email} (User ID: ${userId})`);

        // Check if user exists and if already verified (Idempotency check)
        const user = await findUser(userId);
        if (!user) {
            job.log(`[VerifyEmail] User ${userId} no longer exists. Aborting.`);
            return { status: "skipped", reason: "User not found" };
        }

        if (user.verified) {
            job.log(`[VerifyEmail] User ${userId} is already verified. Skipping email delivery.`);
            return { status: "skipped", reason: "User already verified" };
        }

        job.log(`[Gmail] Delivering verification email to ${email}`);
        const { messageId } = await deliver(email, getVerificationEmail(verificationToken));
        job.log(`[Success] Verification email delivered to ${email}`);
        return { status: "sent", deliveredAt: new Date().toISOString(), messageId };
    });
}

export async function processPasswordReset(job: Job<PasswordResetPayload>) {
    return runWithRequestContext({ requestId: job.id! }, async () => {
        const parsed = passwordResetPayloadSchema.safeParse(job.data);
        if (!parsed.success) {
            throw new UnrecoverableError(`Malformed job payload: ${parsed.error.message}`);
        }
        const { userId, email, resetToken } = parsed.data;

        job.log(`[Start] Sending Password Reset Email to ${email} (User ID: ${userId})`);

        // Check if user exists
        const user = await findUser(userId);
        if (!user) {
            job.log(`[PasswordReset] User ${userId} no longer exists. Aborting.`);
            return { status: "skipped", reason: "User not found" };
        }

        job.log(`[Gmail] Delivering password reset email to ${email}`);
        const { messageId } = await deliver(email, getPasswordResetEmail(resetToken));
        job.log(`[Success] Password reset email delivered to ${email}`);
        return { status: "sent", deliveredAt: new Date().toISOString(), messageId };
    });
}
