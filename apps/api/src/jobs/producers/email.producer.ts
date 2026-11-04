import { createHash } from "node:crypto";
import { JOB_NAMES } from "../../constants/queue";
import { OrgInvitePayload, PasswordResetPayload, VerifyEmailPayload } from "../interfaces/jobPayload";
import { emailQueue } from "../queues/email.queue";

// Job ids are visible in Bull Board and in Redis key names, so they carry a hash of the token, never
// the token. No custom id may contain ":" (BullMQ builds its own keys with it).
const tokenId = (token: string) => createHash("sha256").update(token).digest("hex").slice(0, 32);

export class EmailProducer {
    static async sendVerifyEmail(payload: VerifyEmailPayload) {
        return emailQueue.add(JOB_NAMES.EMAIL.VERIFY_EMAIL, payload, {
            // Deduplicates so the same token isn't queued twice
            jobId: `verify-${payload.userId}-${tokenId(payload.verificationToken)}`,
        });
    }

    // Keep this alias only if existing callers use `sendVerifyMail`
    static async sendVerifyMail(payload: VerifyEmailPayload) {
        return this.sendVerifyEmail(payload);
    }

    static async sendPasswordReset(payload: PasswordResetPayload) {
        return emailQueue.add(JOB_NAMES.EMAIL.PASSWORD_RESET, payload, {
            // Deduplicates so the same reset token isn't queued twice
            jobId: `reset-${payload.userId}-${tokenId(payload.resetToken)}`,
        });
    }

    static async sendOrgInvite(payload: OrgInvitePayload) {
        return emailQueue.add(JOB_NAMES.EMAIL.ORG_INVITE, payload, {
            // Deduplicates so the same invite isn't queued twice
            jobId: `invite-${payload.inviteId}`,
        });
    }
}
