import { createHash } from "node:crypto";
import { prisma } from "../db/prisma";
import { withTransaction } from "../utils/db";
import { sumMicros, toBigMicros } from "../utils/db/money";
import { appAssert, AppError } from "../utils/errors";
import { BAD_REQUEST, NOT_FOUND } from "../constants/https";
import { appErrorCode } from "../constants/appErrorCode";
import { recordAudit } from "../services/audit.service";
import { getTask } from "../services/task.service";
import { freezePromptVersions } from "../services/prompt.service";
import { isEnabled } from "../ai/enabled";
import { buildSnapshots, type VariantSnapshot } from "./snapshot";
import { cellJobId } from "./cellJobId";
import { runCellQueue } from "../jobs/queues/runCell.queue";
import { JOB_NAMES } from "../constants/queue";
import { MAX_CELLS_PER_RUN, type CreateRun } from "@repo/types";
import type { Run, RunVariant } from "../generated/prisma/client";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** The conservative upper bound: chars/4 for the prompt, the full maxTokens for the answer. */
export const estimateCostMicros = (
    snapshots: VariantSnapshot[],
    prices: { inputUsdMicrosPerMTok: number; outputUsdMicrosPerMTok: number }[],
    avgInputChars: number,
    cellsPerVariantModel: number
): bigint => {
    let total = 0n;
    for (const s of snapshots) {
        const promptChars = s.system.length + s.userTemplate.length + s.priorTurns.reduce((n, t) => n + t.content.length, 0) + avgInputChars;
        const inTok = Math.ceil(promptChars / 4);
        for (const p of prices) {
            total += BigInt(Math.ceil((inTok * p.inputUsdMicrosPerMTok + s.maxTokens * p.outputUsdMicrosPerMTok) / 1_000_000)) * BigInt(cellsPerVariantModel);
        }
    }
    return total;
};

const startOfMonthUtc = () => {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
};

/** This month's spent micro-dollars for the workspace (tenant-scoped by the extension). */
export const spentThisMonthMicros = async (): Promise<bigint> => {
    const rows = await prisma.result.findMany({ where: { completedAt: { gte: startOfMonthUtc() }, costUsdMicros: { not: null } }, select: { costUsdMicros: true } });
    return sumMicros(rows.map((r) => r.costUsdMicros));
};

/*
  Validates the grid and prices it, with NO writes. `POST /runs/estimate` returns this; createRun
  builds on it, so the estimate and the real run can never disagree about what is allowed.
 */
export const planRun = async (orgId: string, body: CreateRun, opts: { requireEnabled?: boolean } = {}) => {
    const task = await getTask(body.taskId); // tenant-scoped; 404 for another workspace's task
    const prompts = await prisma.promptVersion.findMany({ where: { id: { in: body.promptVersionIds }, taskId: task.id } });
    appAssert(prompts.length === new Set(body.promptVersionIds).size, NOT_FOUND, "Prompt version not found");

    const models = await prisma.model.findMany({ where: { key: { in: body.modelKeys } } });
    appAssert(models.length === new Set(body.modelKeys).size, NOT_FOUND, "Model not found");
    for (const m of models) {
        appAssert(m.active, BAD_REQUEST, `${m.key} is retired or inactive`, appErrorCode.ModelInactive);
        if (opts.requireEnabled !== false) {
            appAssert(isEnabled(m), BAD_REQUEST, `No API key is configured for ${m.key}`, appErrorCode.ProviderNotConfigured);
        }
    }
    for (const p of prompts) {
        for (const m of models) {
            // The fake provider honours any request; real models must have been probed.
            appAssert(
                !(p.technique === "structured" && m.structured === "untested" && m.provider !== "fake"),
                BAD_REQUEST,
                `Probe ${m.key} before running a structured prompt on it`,
                appErrorCode.ModelUnprobed
            );
        }
    }

    const examples = await prisma.example.findMany({
        where: { taskId: task.id, split: body.split },
        select: { id: true, ref: true, revision: true, input: true },
        orderBy: { ref: "asc" },
    });
    appAssert(examples.length > 0, BAD_REQUEST, `No ${body.split} examples`);
    const totalCells = prompts.length * models.length * examples.length * body.repeats;
    appAssert(totalCells <= MAX_CELLS_PER_RUN, BAD_REQUEST, `Run too large (${totalCells} cells; the limit is ${MAX_CELLS_PER_RUN})`);

    const datasetHash = sha256(examples.map((e) => `${e.ref}:${e.revision}`).join("\n"));
    const pricesSnapshot = Object.fromEntries(
        models.map((m) => [
            m.key,
            {
                inputUsdMicrosPerMTok: m.inputUsdMicrosPerMTok,
                outputUsdMicrosPerMTok: m.outputUsdMicrosPerMTok,
                priceCheckedOn: m.priceCheckedOn.toISOString().slice(0, 10),
                priceNote: m.priceNote,
            },
        ])
    );
    const snapshots = await buildSnapshots(task, prompts, body.temperature);
    const avgInputChars = Math.ceil(examples.reduce((n, e) => n + e.input.length, 0) / examples.length);
    const estimatedCostUsdMicros = estimateCostMicros(Object.values(snapshots), models, avgInputChars, examples.length * body.repeats);

    const org = await prisma.org.findUnique({ where: { id: orgId }, select: { monthlyBudgetUsdMicros: true } });
    appAssert(org, NOT_FOUND, "Workspace not found");
    const spent = await spentThisMonthMicros();
    return { task, prompts, models, examples, totalCells, datasetHash, pricesSnapshot, snapshots, estimatedCostUsdMicros, spentThisMonthUsdMicros: spent, budgetUsdMicros: toBigMicros(org.monthlyBudgetUsdMicros) };
};

export type Plan = Awaited<ReturnType<typeof planRun>>;

/** Upper-bound estimate + this month's spend must fit the workspace budget, BEFORE anything is enqueued. */
export const assertWithinBudget = (plan: Pick<Plan, "estimatedCostUsdMicros" | "spentThisMonthUsdMicros" | "budgetUsdMicros">) => {
    if (plan.spentThisMonthUsdMicros + plan.estimatedCostUsdMicros > plan.budgetUsdMicros) {
        throw new AppError(402, "This run would exceed the workspace's monthly model budget", appErrorCode.BudgetExceeded);
    }
};

/*
  A test run on a dataset that already had a (non-cancelled) test run is "reused": the protocol is test once,
  and the data says when that was broken. A test example moved to dev after a test run counts too.
 */
export const detectTestReuse = async (taskId: string, split: "dev" | "test", datasetHash: string): Promise<boolean> => {
    if (split !== "test") return false;
    const earlier = await prisma.run.findMany({ where: { taskId, split: "test", status: { not: "cancelled" } }, select: { datasetHash: true } });
    if (earlier.length === 0) return false;
    if (earlier.some((r) => r.datasetHash === datasetHash)) return true;
    const moved = await prisma.auditLog.count({ where: { action: "example.split_moved" } });
    return moved > 0;
};

type RunWithVariants = Run & { variants: RunVariant[] };

/** One job per cell, example-outer / variant-inner so early progress covers every model. Idempotent by job id. */
export const enqueueCells = async (
    run: { id: string; orgId: string; repeats: number },
    variantIds: string[],
    exampleIds: string[],
    only?: Set<string> // cells to add: "variantId|exampleId|repeat" (the sweeper passes the missing ones)
) => {
    const jobs: { name: string; data: object; opts: { jobId: string } }[] = [];
    for (const exampleId of exampleIds) {
        for (let repeat = 0; repeat < run.repeats; repeat++) {
            for (const variantId of variantIds) {
                if (only && !only.has(`${variantId}|${exampleId}|${repeat}`)) continue;
                jobs.push({
                    name: JOB_NAMES.RUN_CELL.CELL,
                    data: { orgId: run.orgId, runId: run.id, variantId, exampleId, repeat, traceId: run.id },
                    opts: { jobId: cellJobId(run.id, variantId, exampleId, repeat) },
                });
            }
        }
    }
    for (let i = 0; i < jobs.length; i += 500) await runCellQueue.addBulk(jobs.slice(i, i + 500));
    return jobs.length;
};

export const createRun = async (orgId: string, userId: string, body: CreateRun, opts: { enqueue?: boolean; requireEnabled?: boolean } = {}): Promise<RunWithVariants & { exampleIds: string[] }> => {
    const plan = await planRun(orgId, body, { requireEnabled: opts.requireEnabled });
    assertWithinBudget(plan);

    const run = await withTransaction(async (tx) => {
        await freezePromptVersions(tx, plan.task.id, body.promptVersionIds); // sets frozenAt where null; re-checks dev-only shots
        const testReused = await detectTestReuse(plan.task.id, body.split, plan.datasetHash);
        const created = await tx.run.create({
            data: {
                orgId,
                taskId: plan.task.id,
                taskVersion: plan.task.version,
                split: body.split,
                repeats: body.repeats,
                temperature: body.temperature,
                datasetHash: plan.datasetHash,
                testReused,
                pricesSnapshot: plan.pricesSnapshot,
                promptSnapshots: plan.snapshots as object,
                totalCells: plan.totalCells,
                notes: body.notes,
                startedById: userId,
                variants: { create: plan.prompts.flatMap((p) => plan.models.map((m) => ({ orgId, promptVersionId: p.id, modelId: m.id }))) },
            },
            include: { variants: true },
        });
        await recordAudit({ orgId, actor: { type: "user", id: userId }, action: "run.create", target: { type: "run", id: created.id }, diff: { totalCells: plan.totalCells, split: body.split, testReused } }, tx);
        return created;
    });

    const exampleIds = plan.examples.map((e) => e.id);
    // After the commit; the stale-run sweeper covers a crash right here (deterministic ids make it safe).
    if (opts.enqueue !== false) await enqueueCells(run, run.variants.map((v) => v.id), exampleIds);
    return { ...run, exampleIds };
};
