import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createActorWithRole } from "./helpers/auth";
import { seedCaseStudy, seedModel } from "./helpers/db";
import { fakeLlm, validPostingJson } from "./helpers/fakeLlm";
import { waitForRun } from "./helpers/queues";

let closeWorkers: () => Promise<void>;
beforeAll(async () => {
    ({ closeWorkers } = await import("../src/worker"));
    await seedModel();
});
afterAll(async () => closeWorkers());

describe("prompt versions: frozen once used, few-shot from dev only", () => {
    it("a version used by a run can't change (409); an edit creates @2", async () => {
        const owner = await createActorWithRole("owner");
        const s = await seedCaseStudy(owner, { dev: 1 });
        const P = `${s.T}/prompts/${s.prompts["v1-zero-shot"]}`;
        fakeLlm.alwaysReturn(validPostingJson(0));
        const run = (await owner.agent.post(`/orgs/${owner.org.id}/runs`).send({ taskId: s.task.id, promptVersionIds: [s.prompts["v1-zero-shot"]], modelKeys: ["fake:text"], split: "dev", repeats: 1 }).expect(201)).body.data;
        await waitForRun(run.id, "completed");
        expect((await owner.agent.patch(P).send({ template: "Changed:\n{{input}}" })).status).toBe(409);
        const v2 = await owner.agent.post(`${P}/versions`).send({ template: "Changed:\n{{input}}" }).expect(201);
        expect(v2.body.data).toMatchObject({ key: "v1-zero-shot", version: 2 });
    });

    it("a test-split example as a few-shot example → 400", async () => {
        const owner = await createActorWithRole("owner");
        const s = await seedCaseStudy(owner, { dev: 1, test: 1 });
        const res = await owner.agent.post(`${s.T}/prompts`).send({ key: "v2-few-shot", technique: "few_shot", system: "{{instructions}}\n{{examples}}", template: "{{input}}", fewShotExampleIds: [s.byRef["t_000"]] });
        expect(res.status).toBe(400);
        const dev = await owner.agent.post(`${s.T}/prompts`).send({ key: "v2-few-shot", technique: "few_shot", system: "{{instructions}}\n{{examples}}", template: "{{input}}", fewShotExampleIds: [s.byRef["d_000"]] });
        expect(dev.status).toBe(201);
    });
});
