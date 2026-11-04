export const QUEUE_NAMES = {
    EMAIL: 'email-queue',
    DEAD_LETTER: 'dead-letter-queue',
    MAINTENANCE: 'maintenance-queue',
    RUN_CELL: 'run-cell-queue',
    RUN_FINALIZE: 'run-finalize-queue',
} as const;

export const JOB_NAMES = {
    EMAIL: {
        VERIFY_EMAIL: 'send_verify_email',
        PASSWORD_RESET: 'send_password_reset',
        ORG_INVITE: 'send_org_invite',
        RUN_FINISHED: 'send_run_finished',
    },
    MAINTENANCE: {
        PURGE_EXPIRED: 'purge-expired',
        SWEEP_STALE_RUNS: 'sweep-stale-runs',
    },
    RUN_CELL: {
        CELL: 'run-cell',
    },
    RUN_FINALIZE: {
        FINALIZE: 'finalize',
    },
} as const;
