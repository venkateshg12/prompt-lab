import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma";
import { ProviderHttpError } from "../src/ai/errors";
import { processRunCell } from "../src/jobs/processors/runCell.processor";
import { persistCell } from "../src/runner/persistCell";
import { runWithRequestContext } from "../src/utils/requestContext";
import { createActorWithRole } from "./helpers/auth";
import { asSystem, seedCaseStudy, seedModel } from "./helpers/db";
import { fakeLlm, pushText, validPostingJson } from "./helpers/fakeLlm";
import { clearQueues, requeueAllCells, waitForRun } from "./helpers/queues";
import type { Job } from "bullmq";

// Workers in-process against the container Redis (RUN_WORKERS_IN_API semantics).
let closeWorkers: () => Promise<void>;
beforeAll(async () => {
    ({ closeWorkers } = await import("../src/worker"));
    await seedModel();
});
afterAll(async () => {
    await closeWorkers();
});
beforeEach(async () => {
    fakeLlm.reset();
    await clearQueues();
});

const startRun = async (owner: Awaited<ReturnType<typeof createActorWithRole>>, taskId: string, promptIds: string[], over: object = {}) =>
    (await owner.agent.post(`/orgs/${owner.org.id}/runs`).send({ taskId, promptVersionIds: promptIds, modelKeys: ["fake:text"], split: "dev", repeats: 1, ...over }).expect(201)).body.data as { id: string };

describe("the runner: exactly once, retries only for transport, never repaired", () => {
    it("counts each cell once when every job is enqueued twice", async () => {
        const owner = await createActorWithRole("owner");
        const { task, prompts } = await seedCaseStudy(owner, { dev: 5 });
        fakeLlm.alwaysReturn(validPostingJson(0));
        const run = await startRun(owner, task.id, [prompts["v1-zero-shot"]!], { repeats: 2 });
        expect(await requeueAllCells(run.id)).toBe(10); // same deterministic ids → BullMQ dedupes
        const done = await waitForRun(run.id, "completed");
        expect(done.doneCells).toBe(10);
        expect(await asSystem(() => prisma.result.count({ where: { runId: run.id } }))).toBe(10);
    });

    it("keeps ONE row when a cell is processed twice outside BullMQ (the unique index is the second lock)", async () => {
        const owner = await createActorWithRole("owner");
        const { task, prompts, examples } = await seedCaseStudy(owner, { dev: 1 });
        fakeLlm.alwaysReturn(validPostingJson(0));
        const run = await startRun(owner, task.id, [prompts["v1-zero-shot"]!]);
        await waitForRun(run.id, "completed");
        const variant = await asSystem(() => prisma.runVariant.findFirstOrThrow({ where: { runId: run.id } }));
        const job = { id: "replayed-cell", data: { orgId: owner.org.id, runId: run.id, variantId: variant.id, exampleId: examples[0]!.id, repeat: 0 }, attemptsMade: 0, opts: {} } as unknown as Job;
        await processRunCell(job).catch(() => undefined);
        await processRunCell(job).catch(() => undefined);
        // Below the processor's own "already recorded" check: the same cell written twice hits the unique index.
        const payload = { orgId: owner.org.id, runId: run.id, variantId: variant.id, exampleId: examples[0]!.id, repeat: 0 };
        expect(await asSystem(() => runWithRequestContext({ requestId: "t", orgId: owner.org.id }, () => persistCell(payload, { status: "scored", rawOutput: "{}" })))).toBe(false);
        expect(await asSystem(() => prisma.result.count({ where: { runId: run.id } }))).toBe(1);
        expect((await asSystem(() => prisma.run.findUniqueOrThrow({ where: { id: run.id } }))).doneCells).toBe(1); // counted once too
    });

    it("measures broken JSON instead of repairing it: validJson false, raw output byte-identical, one call", async () => {
        const owner = await createActorWithRole("owner");
        const { task, prompts } = await seedCaseStudy(owner, { dev: 1 });
        const broken = 'Sure! {"title": "x",';
        pushText(broken);
        const run = await startRun(owner, task.id, [prompts["v1-zero-shot"]!]);
        await waitForRun(run.id, "completed");
        const r = await asSystem(() => prisma.result.findFirstOrThrow({ where: { runId: run.id } }));
        expect(r).toMatchObject({ status: "scored", validJson: false, rawOutput: broken, overallScore: 0 });
        expect(fakeLlm.calls()).toHaveLength(1);
    });

    it("retries 429, 429, then succeeds (attempts 3); a 400 is an error at once (1 call)", async () => {
        const owner = await createActorWithRole("owner");
        const { task, prompts } = await seedCaseStudy(owner, { dev: 1 });
        fakeLlm.push({ kind: "error", error: new ProviderHttpError("fake:text", 429, "slow") }, { kind: "error", error: new ProviderHttpError("fake:text", 429, "slow") }, { kind: "text", text: validPostingJson(0) });
        const ok = await startRun(owner, task.id, [prompts["v1-zero-shot"]!]);
        await waitForRun(ok.id, "completed");
        expect(await asSystem(() => prisma.result.findFirstOrThrow({ where: { runId: ok.id } }))).toMatchObject({ status: "scored", attempts: 3, overallScore: 1 });

        fakeLlm.reset();
        fakeLlm.push({ kind: "error", error: new ProviderHttpError("fake:text", 400, "bad request") });
        const owner2 = await createActorWithRole("owner");
        const s2 = await seedCaseStudy(owner2, { dev: 1 });
        const bad = await startRun(owner2, s2.task.id, [s2.prompts["v1-zero-shot"]!]);
        await waitForRun(bad.id, "completed");
        expect(await asSystem(() => prisma.result.findFirstOrThrow({ where: { runId: bad.id } }))).toMatchObject({ status: "error", attempts: 1 });
        expect(fakeLlm.calls()).toHaveLength(1);
    });

    it("excludes errors from accuracy but lists them: 1 error of 10 → n 9, errors 1", async () => {
        const owner = await createActorWithRole("owner");
        const { task, prompts } = await seedCaseStudy(owner, { dev: 10 });
        fakeLlm.push({ kind: "error", error: new ProviderHttpError("fake:text", 400, "bad") });
        fakeLlm.alwaysReturn(validPostingJson(0));
        const run = await startRun(owner, task.id, [prompts["v1-zero-shot"]!]);
        await waitForRun(run.id, "completed");
        const summary = (await owner.agent.get(`/orgs/${owner.org.id}/runs/${run.id}/summary`).expect(200)).body.data.variants[0].summary;
        expect(summary).toMatchObject({ n: 9, errors: 1, scored: 9 });
    });
});
