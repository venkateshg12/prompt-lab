import { appAssert, catchError } from "../utils/errors";
import { CREATED, FORBIDDEN, NOT_FOUND, OK } from "../constants/https";
import { appErrorCode } from "../constants/appErrorCode";
import { ok } from "../utils/api";
import { createRunSchema, idSchema } from "@repo/types";
import { cursorQuerySchema } from "@repo/types";
import { OWNER_RUNS_REQUIRE_ADMIN } from "../constants/env";
import { prisma } from "../db/prisma";
import { assertWithinBudget, createRun, planRun } from "../runner/createRun";
import { cancelRun, getRun, listRuns, toRunDto } from "../services/run.service";
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

// Server-side estimate: the same validation and pricing createRun uses, with no writes.
export const estimateRunHandler = catchError(async (req, res) => {
    const body = createRunSchema.parse(req.body);
    const plan = await planRun(req.orgId, body);
    let withinBudget = true;
    try {
        assertWithinBudget(plan);
    } catch {
        withinBudget = false;
    }
    res.status(OK).json(
        ok({
            totalCells: plan.totalCells,
            examples: plan.examples.length,
            estimatedCostUsdMicros: Number(plan.estimatedCostUsdMicros),
            spentThisMonthUsdMicros: Number(plan.spentThisMonthUsdMicros),
            budgetUsdMicros: Number(plan.budgetUsdMicros),
            withinBudget,
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
    const snapshot = (r: { status: string; doneCells: number; errorCells: number; totalCells: number }) => ({
        runId: id, status: r.status, doneCells: r.doneCells, errorCells: r.errorCells, totalCells: r.totalCells, at: new Date().toISOString(),
    });
    stream.send("progress", snapshot(run));
    unlisteners.push(listen(id, (m) => stream.send("progress", m)));
    // Close the race between "read the run" and "subscribed": re-read once now that we're listening.
    const fresh = await prisma.run.findUnique({ where: { id } });
    if (fresh) stream.send("progress", snapshot(fresh));
});

