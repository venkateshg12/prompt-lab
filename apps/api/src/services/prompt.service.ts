import { createHash } from "node:crypto";
import { prisma, type DbOrTx, type Tx } from "../db/prisma";
import { isUniqueViolation } from "../db/errors";
import { recordAudit, type AuditActor } from "./audit.service";
import { getTask } from "./task.service";
import { renderPrompt } from "@repo/scoring";
import appAssert from "../utils/errors/appAssert";
import { BAD_REQUEST, CONFLICT, NOT_FOUND } from "../constants/https";
import { cache } from "../utils/cache";
import {
    promptBodySchema,
    type NewVersionBody,
    type PromptBody,
} from "@repo/types";
import type { PromptVersion } from "../generated/prisma/client";

/** sha256(technique ‖ system ‖ template ‖ fewShotExampleIds): computed, never stored. */
export const contentHash = (p: { technique: string; system: string; template: string; fewShotExampleIds: string[] }) =>
    createHash("sha256")
        .update(JSON.stringify([p.technique, p.system, p.template, [...p.fewShotExampleIds].sort()]))
        .digest("hex");

const assertDevShots = async (db: DbOrTx, taskId: string, ids: string[]) => {
    if (ids.length === 0) return;
    const n = await db.example.count({ where: { id: { in: ids }, taskId, split: "dev" } });
    appAssert(n === new Set(ids).size, BAD_REQUEST, "Few-shot examples must be dev examples of this task");
};

export const toPromptDto = (p: PromptVersion) => ({
    id: p.id,
    taskId: p.taskId,
    key: p.key,
    version: p.version,
    versionId: `${p.key}@${p.version}`,
    technique: p.technique,
    system: p.system,
    template: p.template,
    fewShotExampleIds: p.fewShotExampleIds,
    notes: p.notes,
    frozen: p.frozenAt !== null,
    frozenAt: p.frozenAt,
    createdAt: p.createdAt,
});

export const getPrompt = async (taskId: string, id: string) => {
    const p = await prisma.promptVersion.findFirst({ where: { id, taskId } });
    appAssert(p, NOT_FOUND, "Prompt not found");
    return p;
};

/** Latest version per key, with the history of earlier versions. */
export const listPrompts = async (taskId: string) => {
    await getTask(taskId); // 404 for another workspace's task, not an empty list
    const all = await prisma.promptVersion.findMany({ where: { taskId }, orderBy: [{ key: "asc" }, { version: "desc" }] });
    const byKey = new Map<string, PromptVersion[]>();
    for (const p of all) byKey.set(p.key, [...(byKey.get(p.key) ?? []), p]);
    return [...byKey.values()].map((versions) => ({
        ...toPromptDto(versions[0]!),
        history: versions.map((v) => ({ id: v.id, version: v.version, versionId: `${v.key}@${v.version}`, frozenAt: v.frozenAt, createdAt: v.createdAt })),
    }));
};

export const createPrompt = async (orgId: string, taskId: string, body: PromptBody, actor: AuditActor) => {
    await assertDevShots(prisma, taskId, body.fewShotExampleIds);
    const latest = await prisma.promptVersion.findFirst({ where: { taskId, key: body.key }, orderBy: { version: "desc" } });
    appAssert(!latest || contentHash(latest) !== contentHash(body), CONFLICT, "No changes from the latest version");
    try {
        const created = await prisma.promptVersion.create({
            data: { orgId, taskId, ...body, notes: body.notes ?? null, version: (latest?.version ?? 0) + 1 },
        });
        await recordAudit({ orgId, actor, action: "prompt.create", target: { type: "prompt", id: created.id }, diff: { versionId: `${created.key}@${created.version}` } });
        await cache.bump("tasks"); // prompt-version counts feed the task list
        return created;
    } catch (e) {
        appAssert(!isUniqueViolation(e), CONFLICT, "Someone created this version at the same time; reload");
        throw e;
    }
};

export const updateDraft = async (taskId: string, id: string, patch: Partial<PromptBody>) => {
    const p = await getPrompt(taskId, id);
    appAssert(!p.frozenAt, CONFLICT, "This version was used by a run. Create a new version");
    const next = promptBodySchema.parse({ ...p, ...patch, key: p.key }); // re-run the cross-field refinements
    await assertDevShots(prisma, p.taskId, next.fewShotExampleIds);
    // Conditional update: a run may freeze it between our read and this write.
    const { count } = await prisma.promptVersion.updateMany({
        where: { id, frozenAt: null },
        data: {
            technique: next.technique,
            system: next.system,
            template: next.template,
            fewShotExampleIds: next.fewShotExampleIds,
            notes: next.notes ?? null,
        },
    });
    appAssert(count === 1, CONFLICT, "This version was just used by a run. Create a new version");
    return prisma.promptVersion.findUniqueOrThrow({ where: { id } });
};

export const newVersion = async (orgId: string, taskId: string, id: string, patch: NewVersionBody, actor: AuditActor) => {
    const p = await getPrompt(taskId, id);
    return createPrompt(orgId, p.taskId, promptBodySchema.parse({ ...p, ...patch, key: p.key }), actor);
};

export const duplicatePrompt = async (orgId: string, taskId: string, id: string, key: string, actor: AuditActor) => {
    const p = await getPrompt(taskId, id);
    return createPrompt(orgId, p.taskId, promptBodySchema.parse({ ...p, key }), actor);
};

/** Called by Phase 17 inside the run-creation transaction. Idempotent: frozenAt is only set once. */
export const freezePromptVersions = async (tx: Tx, taskId: string, ids: string[]) => {
    const prompts = await tx.promptVersion.findMany({ where: { id: { in: ids }, taskId } });
    appAssert(prompts.length === new Set(ids).size, BAD_REQUEST, "Unknown prompt version");
    for (const p of prompts) await assertDevShots(tx, taskId, p.fewShotExampleIds); // check #2
    await tx.promptVersion.updateMany({ where: { id: { in: ids }, frozenAt: null }, data: { frozenAt: new Date() } });
    return prompts;
};

/** Exactly what the model will see for one example (the same renderer the runner uses). */
export const previewPrompt = async (taskId: string, id: string, target: { exampleId?: string; exampleRef?: string }) => {
    const [task, p] = await Promise.all([getTask(taskId), getPrompt(taskId, id)]);
    const example = await prisma.example.findFirst({
        where: { taskId, ...(target.exampleId ? { id: target.exampleId } : { ref: target.exampleRef }) },
    });
    appAssert(example, NOT_FOUND, "Example not found");
    const shots = await prisma.example.findMany({ where: { id: { in: p.fewShotExampleIds } } });
    const ordered = p.fewShotExampleIds.map((sid) => shots.find((s) => s.id === sid)).filter((s) => s !== undefined);
    return renderPrompt({
        prompt: p,
        task,
        input: example.input,
        fewShots: ordered.map((s) => ({ ref: s.ref, split: s.split, input: s.input, expected: s.expected })),
    });
};
