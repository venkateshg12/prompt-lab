import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma";
import { createActorWithRole } from "./helpers/auth";
import { asSystem, seedCaseStudy, seedModel } from "./helpers/db";
import { fakeLlm, validPostingJson } from "./helpers/fakeLlm";
import { waitForRun } from "./helpers/queues";

let closeWorkers: () => Promise<void>;
beforeAll(async () => {
    ({ closeWorkers } = await import("../src/worker"));
    await seedModel();
});
afterAll(async () => closeWorkers());
beforeEach(() => fakeLlm.reset());

describe("the protocol: the test split once, the budget before anything is spent", () => {
    it("a second test-split run is flagged testReused, and its export lines carry it", async () => {
        const owner = await createActorWithRole("owner");
        const s = await seedCaseStudy(owner, { dev: 1, test: 2 });
        fakeLlm.alwaysReturn(validPostingJson(0));
        const body = { taskId: s.task.id, promptVersionIds: [s.prompts["v1-zero-shot"]], modelKeys: ["fake:text"], split: "test", repeats: 1, confirmFinal: true };
        const first = (await owner.agent.post(`/orgs/${owner.org.id}/runs`).send(body).expect(201)).body.data;
        expect(first.testReused).toBe(false);
        await waitForRun(first.id, "completed");
        const second = (await owner.agent.post(`/orgs/${owner.org.id}/runs`).send(body).expect(201)).body.data;
        expect(second.testReused).toBe(true);
        await waitForRun(second.id, "completed");
        const jsonl = (await owner.agent.get(`/orgs/${owner.org.id}/runs/${second.id}/export/results.jsonl`).buffer(true).parse((res, cb) => { let d = ""; res.on("data", (c: Buffer) => (d += c)); res.on("end", () => cb(null, d)); }).expect(200)).body as string;
        const lines = jsonl.trim().split("\n").map((l) => JSON.parse(l) as { testReused: boolean });
        expect(lines).toHaveLength(2);
        expect(lines.every((l) => l.testReused)).toBe(true);
    });

    it("a workspace can't overspend: a budget below the estimate refuses the run (402), creates nothing, calls nothing", async () => {
        const owner = await createActorWithRole("owner");
        const s = await seedCaseStudy(owner, { dev: 3 });
        await owner.agent.patch(`/orgs/${owner.org.id}`).send({ monthlyBudgetUsd: 0 }).expect(200);
        const res = await owner.agent.post(`/orgs/${owner.org.id}/runs`).send({ taskId: s.task.id, promptVersionIds: [s.prompts["v1-zero-shot"]], modelKeys: ["fake:text"], split: "dev", repeats: 1 });
        expect(res.status).toBe(402);
        expect(res.body.errors[0].code).toBe("BUDGET_EXCEEDED");
        expect(await asSystem(() => prisma.run.count({ where: { orgId: owner.org.id } }))).toBe(0);
        expect(fakeLlm.calls()).toHaveLength(0);
    });
});
