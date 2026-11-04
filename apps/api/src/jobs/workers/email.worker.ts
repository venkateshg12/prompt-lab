import { Job, Worker } from "bullmq";
import { JOB_NAMES, QUEUE_NAMES } from "../../constants/queue";
import { processOrgInvite, processPasswordReset, processVerifyEmail } from "../processors/email.processor";
import { OrgInvitePayload, PasswordResetPayload, VerifyEmailPayload } from "../interfaces/jobPayload";
import { redisConnection } from "../redis/connection";
import { onFinalFailure } from "../deadLetter";
import { logger } from "../../utils/logger";

export const emailWorker = new Worker(
    QUEUE_NAMES.EMAIL,
    async (job: Job<any>) => {
        switch (job.name) {
            case JOB_NAMES.EMAIL.VERIFY_EMAIL:
                return await processVerifyEmail(job as Job<VerifyEmailPayload>);
            case JOB_NAMES.EMAIL.PASSWORD_RESET:
                return await processPasswordReset(job as Job<PasswordResetPayload>);
            case JOB_NAMES.EMAIL.ORG_INVITE:
                return await processOrgInvite(job as Job<OrgInvitePayload>);
            // Phase 17: RUN_FINISHED
            default:
                throw new Error(`Unknown job name: ${job.name}`);
        }
    },
    {
        connection: redisConnection,
        concurrency: 5,        // Process up to 5 jobs concurrently
        lockDuration: 30000,   // 30 seconds lock duration
        limiter: {
            max: 2,         // 2 emails per second (safe for Gmail)
            duration: 1000,
        }
    }
);

emailWorker.on('completed', (job) => {
    logger.info({ jobId: job.id, jobName: job.name }, "[EmailWorker] job completed");
});
emailWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, jobName: job?.name, err: err.message }, "[EmailWorker] job failed");
    void onFinalFailure(job, err);
});
emailWorker.on('stalled', (jobId) => {
    logger.warn({ jobId }, "[EmailWorker] job stalled — check CPU load / event loop freeze");
});
emailWorker.on('error', (err) => {
    logger.error({ err: err.message }, "[EmailWorker] connection error");
});
