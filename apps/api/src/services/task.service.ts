import { prisma, type Prisma } from "../db/prisma";
import { withTransaction } from "../utils/db";
import { cache } from "../utils/cache";
import { recordAudit, type AuditActor } from "./audit.service";
import appAssert from "../utils/errors/appAssert";
import { CONFLICT, NOT_FOUND } from "../constants/https";
import { isUniqueViolation } from "../db/errors";
import { sameJson } from "../utils/stableJson";
import { fieldRulesSchema, type CreateTaskBody, type UpdateTaskBody } from "@repo/types";

const LIST_TTL_SECONDS = 5 * 60;

/** The task list for the current workspace (cached 5 min under the `tasks` domain). */
export const listTasks = async (orgId: string) => {
    const key = await cache.versionedKey(["tasks"], `org:${orgId}:list`);
    return cache.getOrSet(
        key,
        () =>
            prisma.task.findMany({
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                select: { id: true, slug: true, name: true, description: true, version: true, updatedAt: true },
            }),
        LIST_TTL_SECONDS
    );
};

export const getTask = async (id: string) => {
    const task = await prisma.task.findUnique({ where: { id } });
    appAssert(task, NOT_FOUND, "Task not found");
    return { ...task, fields: fieldRulesSchema.parse(task.fields) }; // jsonb is re-validated on read
};

export const createTask = async (orgId: string, body: CreateTaskBody, actor: AuditActor) => {
    try {
        const task = await withTransaction(async (tx) => {
            const created = await tx.task.create({ data: { orgId, ...body, fields: body.fields as Prisma.InputJsonValue } });
            await recordAudit({ orgId, actor, action: "task.create", target: { type: "task", id: created.id } }, tx);
            return created;
        });
        await cache.bump("tasks"); // after the commit
        return task;
    } catch (error) {
        appAssert(!isUniqueViolation(error), CONFLICT, `A task with slug "${body.slug}" already exists`);
        throw error;
    }
};

const DEFINING = ["instructions", "fields"] as const;

/*
  Instructions and fields DEFINE a result (fields say what "correct" means; instructions are rendered
  into every prompt), so changing either bumps `version`. The audit row keeps the old and new values,
  so a run made with an earlier version stays explainable.
 */
export const updateTask = async (orgId: string, id: string, body: UpdateTaskBody, actor: AuditActor) => {
    const result = await withTransaction(async (tx) => {
        const before = await tx.task.findUnique({ where: { id } });
        appAssert(before, NOT_FOUND, "Task not found");
        const defining = DEFINING.filter(
            (k) => body[k] !== undefined && !sameJson(body[k], before[k])
        );
        const task = await tx.task.update({
            where: { id },
            data: {
                ...body,
                fields: body.fields as Prisma.InputJsonValue | undefined,
                ...(defining.length ? { version: { increment: 1 } } : {}),
            },
        });
        await recordAudit(
            {
                orgId,
                actor,
                action: defining.length ? "task.version" : "task.update",
                target: { type: "task", id },
                // Old values kept so a run made with an earlier version stays explainable.
                diff: Object.fromEntries(defining.map((k) => [k, { from: before[k], to: task[k] }])),
            },
            tx
        );
        // Phase 17: runsAffected = count of runs with taskVersion < task.version
        return { task, versionBumped: defining.length > 0 };
    });
    await cache.bump("tasks"); // after the commit
    return result;
};

export const deleteTask = async (id: string) => {
    // Phase 17: refuse with 409 when the task has runs ("archive instead"); cascades examples + prompts.
    const { count } = await prisma.task.deleteMany({ where: { id } });
    appAssert(count === 1, NOT_FOUND, "Task not found");
    await cache.bump("tasks");
};
