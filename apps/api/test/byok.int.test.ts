import http from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Set BEFORE src/ is imported (env.ts reads them once): the owner's key is present on purpose.
vi.hoisted(() => {
    process.env.NVIDIA_API_KEY = "test-owner-key-must-never-be-used";
    process.env.NVIDIA_BASE_URL = "http://127.0.0.1:5998";
});

import { captureLogs, leakScan } from "./helpers/leakScan";
import { createActorWithRole } from "./helpers/auth";
import { answer, seedCaseStudy, seedModel } from "./helpers/db";
import { getSupertest } from "./helpers/app";
import { waitForRun } from "./helpers/queues";

const VISITOR_KEY = "nvapi-TEST-visitor-key-0123456789abcdef";
const MODEL = "nvidia:test/stub-model";
const calls = { owner: 0, visitor: 0, other: 0 };
let stub: http.Server;
let closeWorkers: () => Promise<void>;
const logs = captureLogs();

beforeAll(async () => {
    // A local NIM stand-in: answers a perfect posting for either key, and counts whose key it saw.
    stub = http.createServer((req, res) => {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
            const auth = req.headers.authorization ?? "";
            calls[auth === "Bearer test-owner-key-must-never-be-used" ? "owner" : auth === `Bearer ${VISITOR_KEY}` ? "visitor" : "other"]++;
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer(0)) }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 10 } }));
        });
    });
    await new Promise<void>((r) => stub.listen(5998, "127.0.0.1", r));
    ({ closeWorkers } = await import("../src/worker"));
    await seedModel({ key: MODEL, modelId: "test/stub-model" });
});
afterAll(async () => {
    await closeWorkers();
    await new Promise<void>((r) => stub.close(() => r()));
});

describe("bring your own key: never stored, logged or queued; never the owner's key", () => {
    it("publishes a run, then a visitor's key is used for its calls only and leaves no trace anywhere", async () => {
        const owner = await createActorWithRole("owner");
        const s = await seedCaseStudy(owner, { dev: 3 });
        const run = (await owner.agent.post(`/orgs/${owner.org.id}/runs`).send({ taskId: s.task.id, promptVersionIds: [s.prompts["v1-zero-shot"]], modelKeys: [MODEL], split: "dev", repeats: 1 }).expect(201)).body.data;
        await waitForRun(run.id, "completed");
        const slug = (await owner.agent.post(`/orgs/${owner.org.id}/runs/${run.id}/publish`).send({}).expect(200)).body.data.slug as string;
        const ownerCallsAfterRun = calls.owner;
        const body = { slug, promptVersion: "v1-zero-shot@1", modelKey: MODEL, exampleRefs: ["d_000", "d_001"] };

        // No key → 400 before any provider code; the owner's key (set) is not a fallback.
        const missing = await getSupertest().post("/demo/run").send(body);
        expect(missing.status).toBe(400);
        expect(missing.body.errors[0].code).toBe("DEMO_KEY_MISSING");
        expect(calls.owner).toBe(ownerCallsAfterRun);

        const ok = await getSupertest().post("/demo/run").set("X-Provider-Key", VISITOR_KEY).send(body);
        expect(ok.status).toBe(200);
        expect(ok.body.data.results.map((r: { status: string }) => r.status)).toEqual(["scored", "scored"]);
        expect(calls).toMatchObject({ owner: ownerCallsAfterRun, visitor: 2, other: 0 });

        expect(await leakScan(VISITOR_KEY, logs)).toEqual([]);
        expect(logs.length).toBeGreaterThan(0); // the capture works: the scan read real lines
    });
});
