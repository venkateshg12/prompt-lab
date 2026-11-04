export const QUEUE_NAMES = {
    EMAIL: 'email-queue',
    DEAD_LETTER: 'dead-letter-queue',
    MAINTENANCE: 'maintenance-queue',
    // Phase 17: RUN_CELL: 'run-cell-queue', RUN_FINALIZE: 'run-finalize-queue'
} as const;

export const JOB_NAMES = {
    EMAIL: {
        VERIFY_EMAIL: 'send_verify_email',
        PASSWORD_RESET: 'send_password_reset',
        ORG_INVITE: 'send_org_invite',
        // Phase 17: RUN_FINISHED
    },
    MAINTENANCE: {
        PURGE_EXPIRED: 'purge-expired',
        // Phase 17: SWEEP_STALE_RUNS
    },
} as const;
