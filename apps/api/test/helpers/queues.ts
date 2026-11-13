// ADAPT of @pt-api/test/helpers/queues.ts: waits on runs instead of documents; Prompt Lab's queues.
import { prisma } from "../../src/db/prisma";
import { runAsSystem } from "../../src/utils/requestContext";
import { runCellQueue } from "../../src/jobs/queues/runCell.queue";
import { runFinalizeQueue } from "../../src/jobs/queues/runFinalize.queue";
import { deadLetterQueue } from "../../src/jobs/queues/deadLetter.queue";
import { runJudgeQueue } from "../../src/jobs/queues/runJudge.queue";
import { enqueueCells } from "../../src/runner/createRun";
import type { Queue } from "bullmq";

export { runCellQueue, runFinalizeQueue, deadLetterQueue, runJudgeQueue };

/** Polls Postgres every 100 ms (never a fixed sleep) until the run reaches `status`. */
export const waitForRun = async (runId: string, status: string, options: { timeoutMs?: number; intervalMs?: number } = {}) => {
    const timeoutMs = options.timeoutMs ?? 15_000;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const run = await runAsSystem(() => prisma.run.findUnique({ where: { id: runId } }));
        if (run?.status === status) return run;
        await new Promise((r) => setTimeout(r, options.intervalMs ?? 100));
    }
    const run = await runAsSystem(() => prisma.run.findUnique({ where: { id: runId } }));
    throw new Error(`Timed out after ${timeoutMs}ms waiting for run ${runId} to reach "${status}"; it is "${run?.status}" (${run?.doneCells}/${run?.totalCells})`);
};

/** Adds every cell job of a run AGAIN, with the same deterministic ids (BullMQ must dedupe). */
export const requeueAllCells = async (runId: string) =>
    runAsSystem(async () => {
        const run = await prisma.run.findUniqueOrThrow({ where: { id: runId }, include: { variants: true } });
        const examples = await prisma.example.findMany({ where: { taskId: run.taskId, split: run.split }, select: { id: true } });
        return enqueueCells(run, run.variants.map((v) => v.id), examples.map((e) => e.id));
    });

export const countJobs = async (queue: Queue, namePattern?: RegExp): Promise<number> => {
    const jobs = await queue.getJobs(["waiting", "active", "completed", "failed", "delayed"]);
    return namePattern ? jobs.filter((j) => namePattern.test(j.name)).length : jobs.length;
};

export const clearQueues = async () => {
    await Promise.all([runCellQueue.obliterate({ force: true }), runFinalizeQueue.obliterate({ force: true }), deadLetterQueue.obliterate({ force: true }), runJudgeQueue.obliterate({ force: true })]);
};
