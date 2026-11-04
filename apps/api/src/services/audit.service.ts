import { prisma, type DbOrTx, type Prisma } from "../db/prisma";
import type { AuditLog } from "../generated/prisma/client";

export type AuditActor = { type: "user" | "api_key" | "system"; id?: string };

export interface AuditEntry {
    orgId: string;
    actor: AuditActor;
    action: string;
    target: { type: string; id: string };
    diff?: Record<string, unknown> | null;
    at?: Date;
}

/**
 * Appends one audit row. Pass the caller's transaction when the audited change happens inside one,
 * so the change and its audit trail commit (or roll back) together.
 */
export const recordAudit = (entry: AuditEntry, db: DbOrTx = prisma) =>
    db.auditLog.create({
        data: {
            orgId: entry.orgId,
            actorType: entry.actor.type,
            actorId: entry.actor.id,
            action: entry.action,
            targetType: entry.target.type,
            targetId: entry.target.id,
            diff: (entry.diff ?? undefined) as Prisma.InputJsonValue | undefined,
            at: entry.at ?? new Date(),
        },
    });

/** The audit row in the API's nested shape (actor and target as objects). */
export const toAuditDto = (row: AuditLog) => ({
    id: row.id,
    orgId: row.orgId,
    actor: { type: row.actorType, id: row.actorId ?? undefined },
    action: row.action,
    target: { type: row.targetType, id: row.targetId },
    diff: row.diff,
    at: row.at,
});
