import { appAssert, catchError } from "../utils/errors";
import { CREATED, FORBIDDEN, NOT_FOUND, OK } from "../constants/https";
import { appErrorCode } from "../constants/appErrorCode";
import { ok } from "../utils/api";
import { createRunSchema, idSchema } from "@repo/types";
import { cursorQuerySchema } from "@repo/types";
import { OWNER_RUNS_REQUIRE_ADMIN } from "../constants/env";
import { prisma } from "../db/prisma";
import { createRun, detectTestReuse, planRun } from "../runner/createRun";
import { cancelRun, getRun, listRuns, toRunDto } from "../services/run.service";
import { assertRescorable, getRunSummary, listResults } from "../services/results.service";
import { datasetHashOf } from "../runner/dataset";
import { runTotals } from "../runner/totals";
import { maintenanceQueue } from "../jobs/queues/maintenance.queue";
import { JOB_NAMES } from "../constants/queue";
import { tagSchema } from "@repo/types";
import { z } from "zod";
import { actorOf } from "../utils/actor";
import { openStream } from "../utils/events/sse";
import { assertStreamSlot, releaseStreamSlot } from "../utils/events/streamLimiter";
import { listen } from "../utils/events/pubsub";

const runId = (req: { params: Record<string, unknown> }) => idSchema("run id").parse(req.params.runId);

// Production sets OWNER_RUNS_REQUIRE_ADMIN=true, so a stranger who signs up can't start a paid run on the
// server's keys. The role is read LIVE from the database, not from the access token.
const assertMaySpendServerKeys = async (userId: string) => {
    if (OWNER_RUNS_REQUIRE_ADMIN !== "true") return;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    appAssert(user?.role === "admin", FORBIDDEN, "Runs on the server's model keys are limited to the owner", appErrorCode.OwnerRunsAdminOnly);
};

export const createRunHandler = catchError(async (req, res) => {
    await assertMaySpendServerKeys(req.userId);
    const body = createRunSchema.parse(req.body);
    const run = await createRun(req.orgId, req.userId, body);
    res.status(CREATED).json(ok(toRunDto(run)));
});

// Server-side estimate: the same validation as createRun, no writes. A typical call, not the worst case:
// output tokens ≈ maxTokens × 0.4 (× 0.8 for chain-of-thought, whose reasoning is long). The UI labels it
// an estimate and prints the date of every price; the real cost comes from the stored results.
export const estimateRunHandler = catchError(async (req, res) => {
    const body = createRunSchema.parse({ ...req.body, confirmFinal: true }); // intent is checked by Start, not by the estimate
    const plan = await planRun(req.orgId, body);
    const perExample = plan.examples.length * body.repeats;
    const avgInputChars = Math.ceil(plan.examples.reduce((n, e) => n + e.input.length, 0) / plan.examples.length);
    const variants = plan.prompts.flatMap((p) => {
        const snap = plan.snapshots[p.id]!;
        const fixedChars = snap.system.length + snap.userTemplate.length + snap.priorTurns.reduce((n, t) => n + t.content.length, 0);
        return plan.models.map((m) => {
            const skipped = p.technique === "structured" && m.structured === "unsupported" && m.provider !== "fake";
            const cells = skipped ? 0 : perExample;
            const tokensIn = Math.ceil((fixedChars + avgInputChars) / 4);
            const tokensOut = Math.ceil(snap.maxTokens * (p.technique === "cot" ? 0.8 : 0.4));
            const perCell = Math.round((tokensIn * m.inputUsdMicrosPerMTok + tokensOut * m.outputUsdMicrosPerMTok) / 1_000_000);
            return {
                promptVersion: `${p.key}@${p.version}`, modelKey: m.key, cells, skippedCells: skipped ? perExample : 0,
                estimateUsdMicros: perCell * cells, priceCheckedOn: m.priceCheckedOn.toISOString().slice(0, 10),
            };
        });
    });
    const totalUsdMicros = variants.reduce((s, v) => s + v.estimateUsdMicros, 0);
    const remaining = plan.budgetUsdMicros - plan.spentThisMonthUsdMicros;
    res.status(OK).json(
        ok({
            totalCells: plan.totalCells,
            cells: variants.reduce((s, v) => s + v.cells, 0),
            skippedCells: variants.reduce((s, v) => s + v.skippedCells, 0),
            examples: plan.examples.length,
            variants,
            totalUsdMicros,
            estimatedCostUsdMicros: Number(plan.estimatedCostUsdMicros), // the upper bound the budget gate uses
            budget: { limit: Number(plan.budgetUsdMicros), spent: Number(plan.spentThisMonthUsdMicros), remaining: Number(remaining) },
            withinBudget: plan.spentThisMonthUsdMicros + plan.estimatedCostUsdMicros <= plan.budgetUsdMicros,
            testReused: await detectTestReuse(plan.task.id, body.split, plan.datasetHash),
            datasetHash: plan.datasetHash,
        })
    );
});

export const listRunsHandler = catchError(async (req, res) => {
    const query = cursorQuerySchema.extend({ taskId: idSchema("task id").optional() }).parse(req.query);
    const { items, meta } = await listRuns(query);
    res.status(OK).json(ok(items, meta));
});

export const getRunHandler = catchError(async (req, res) => {
    res.status(OK).json(ok(await getRun(runId(req))));
});

export const runSummaryHandler = catchError(async (req, res) => {
    const tag = req.query.tag === undefined ? undefined : tagSchema.parse(req.query.tag);
    res.status(OK).json(ok(await getRunSummary(req.orgId, runId(req), tag)));
});

export const runResultsHandler = catchError(async (req, res) => {
    const q = cursorQuerySchema
        .extend({
            variant: idSchema("variant id").optional(),
            field: z.string().regex(/^[a-z][a-z0-9_]{0,40}$/).optional(),
            reason: z.enum(["match", "mismatch", "partial", "missing", "wrong_type", "null_expected", "null_predicted", "currency_mismatch", "out_of_tolerance"]).optional(),
            failedOnly: z.enum(["true", "false"]).optional(),
        })
        .parse(req.query);
    const { items, meta } = await listResults(req.orgId, runId(req), { ...q, failedOnly: q.failedOnly === "true" });
    res.status(OK).json(ok(items, meta));
});

// Re-score from the stored raw outputs with the CURRENT rules and labels: no model calls. The job id
// carries the task version and a hash of the labels, so asking twice for the same state is one job.
export const rescoreRunHandler = catchError(async (req, res) => {
    const id = runId(req);
    const run = await assertRescorable(id);
    const taskRow = await prisma.run.findUnique({ where: { id }, select: { taskId: true } });
    const examples = taskRow ? await prisma.example.findMany({ where: { taskId: taskRow.taskId }, select: { ref: true, revision: true } }) : [];
    const jobId = `rescore-${id}-${run.task.version}-${datasetHashOf(examples).slice(0, 8)}`;
    await maintenanceQueue.add(JOB_NAMES.MAINTENANCE.RESCORE_RUN, { orgId: req.orgId, runId: id }, { jobId });
    res.status(OK).json(ok({ enqueued: true, jobId }));
});

export const cancelRunHandler = catchError(async (req, res) => {
    res.status(OK).json(ok(await cancelRun(req.orgId, runId(req), actorOf(req))));
});

// SSE: the current state first, then every progress message for this run.
export const runEventsHandler = catchError(async (req, res) => {
    const id = runId(req);
    const run = await prisma.run.findUnique({ where: { id } }); // tenant-scoped: another workspace's run is a 404
    appAssert(run, NOT_FOUND, "Run not found");
    await assertStreamSlot(req.userId);

    const unlisteners: (() => void)[] = [];
    const stream = openStream(req, res, () => {
        unlisteners.forEach((fn) => fn());
        void releaseStreamSlot(req.userId);
    });
    const snapshot = (r: { status: string; doneCells: number; errorCells: number; totalCells: number }, t: { costUsdMicros: number; skippedCells: number }) => ({
        runId: id, status: r.status, doneCells: r.doneCells, errorCells: r.errorCells, totalCells: r.totalCells, ...t, at: new Date().toISOString(),
    });
    stream.send("progress", snapshot(run, await runTotals(id)));
    unlisteners.push(listen(id, (m) => stream.send("progress", m)));
    // Close the race between "read the run" and "subscribed": re-read once now that we're listening.
    const fresh = await prisma.run.findUnique({ where: { id } });
    if (fresh) stream.send("progress", snapshot(fresh, await runTotals(id)));
});

