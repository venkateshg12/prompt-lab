import type { User } from "../generated/prisma/client";

declare global {
    namespace Express {
        interface Request {
            userId: string;
            sessionId: string;
            role: User["role"];
            // Phase 06: visitorId. Phase 10: orgId, orgRole.
        }
    }
}
export {};
