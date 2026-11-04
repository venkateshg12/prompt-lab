import type { User } from "../generated/prisma/client";
import type { OrgRole } from "@repo/types";

declare global {
    namespace Express {
        interface Request {
            userId: string;
            sessionId: string;
            role: User["role"];
            visitorId?: string;
            // Set by resolveOrg.
            orgId: string;
            orgRole: OrgRole;
        }
    }
}
export {};
