import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSupertest } from "./helpers/app";
import { createActorWithRole } from "./helpers/auth";
import { seedCaseStudy, seedModel } from "./helpers/db";
import { fakeLlm } from "./helpers/fakeLlm";
import { waitForRun } from "./helpers/queues";

let closeWorkers: () => Promise<void>;
beforeAll(async () => {
    ({ closeWorkers } = await import("../src/worker"));
    await seedModel();
});
afterAll(async () => closeWorkers());

describe("published pages hide what they should", () => {
    it("a private input has no input and no raw output; no owner email, name or ids anywhere", async () => {
        const owner = await createActorWithRole("owner");
        const s = await seedCaseStudy(owner, { dev: 2 });
        await owner.agent.patch(`${s.T}/examples/${s.byRef["d_001"]}`).send({ publicInput: false }).expect(200);
        // The model echoes the private posting: the raw output must be withheld too.
        fakeLlm.alwaysReturn('{"title":"Posting 1 SECRET"}');
        const run = (await owner.agent.post(`/orgs/${owner.org.id}/runs`).send({ taskId: s.task.id, promptVersionIds: [s.prompts["v1-zero-shot"]], modelKeys: ["fake:text"], split: "dev", repeats: 1, notes: "owner note" }).expect(201)).body.data;
        await waitForRun(run.id, "completed");
        const slug = (await owner.agent.post(`/orgs/${owner.org.id}/runs/${run.id}/publish`).send({}).expect(200)).body.data.slug as string;

        const pub = getSupertest();
        const page = await pub.get(`/public/runs/${slug}`).expect(200);
        const feed = await pub.get(`/public/runs/${slug}/results?limit=100`).expect(200);
        const hidden = (feed.body.data as { exampleRef: string; input: string | null; inputHidden: boolean; rawOutput: string | null }[]).find((r) => r.exampleRef === "d_001")!;
        expect(hidden).toMatchObject({ input: null, inputHidden: true, rawOutput: null });
        // Nothing derived from the private posting: the fake echoes it into every output, so check that item itself.
        expect(JSON.stringify(hidden)).not.toMatch(/Posting 1|SECRET/);
        expect(JSON.stringify(page.body)).not.toMatch(/Posting 1|SECRET/);
        const text = JSON.stringify([page.body, feed.body]);
        for (const secret of [owner.user.email, owner.org.name, owner.user.id, owner.org.id, "owner note"]) expect(text).not.toContain(secret);
        expect(text).toContain("Posting 0"); // a public input is shown
    });
});
