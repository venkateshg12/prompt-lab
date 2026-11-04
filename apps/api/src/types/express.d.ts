import type { User } from "../generated/prisma/client";

declare global {
    namespace Express {
        interface Request {
            userId: string;
            sessionId: string;
            role: User["role"];
            visitorId?: string;
            // Set by resolveOrg (Phase 10); declared now because the invite limiter keys on it.
            orgId: string;
            // Phase 10: orgRole.
        }
    }
}
export {};
