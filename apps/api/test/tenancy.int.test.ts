import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma";
import { createActorWithRole, type TestActor } from "./helpers/auth";
import { asSystem, seedCaseStudy, seedModel } from "./helpers/db";
import { fakeLlm, validPostingJson } from "./helpers/fakeLlm";
import { waitForRun } from "./helpers/queues";
import { TENANT_ROUTES } from "./tenancy.routes";

let closeWorkers: () => Promise<void>;
let A: TestActor;
let B: TestActor;
const ids: Record<string, string> = {};

beforeAll(async () => {
    ({ closeWorkers } = await import("../src/worker"));
    await seedModel();
    A = await createActorWithRole("owner");
    B = await createActorWithRole("owner");
    const s = await seedCaseStudy(A, { dev: 2 });
    fakeLlm.alwaysReturn(validPostingJson(0));
    const run = (await A.agent.post(`/orgs/${A.org.id}/runs`).send({ taskId: s.task.id, promptVersionIds: [s.prompts["v1-zero-shot"]], modelKeys: ["fake:text"], split: "dev", repeats: 1 }).expect(201)).body.data;
    await waitForRun(run.id, "completed");
    const variant = await asSystem(() => prisma.runVariant.findFirstOrThrow({ where: { runId: run.id } }));
    Object.assign(ids, { orgId: A.org.id, taskId: s.task.id, exampleId: s.examples[0]!.id, promptId: s.prompts["v1-zero-shot"], runId: run.id, variantId: variant.id });
});
afterAll(async () => closeWorkers());

const fill = (p: string, orgId: string) => p.replace(":orgId", orgId).replace(/:(\w+)/g, (_, k: string) => ids[k] ?? `:${k}`);
const call = (actor: TestActor, r: (typeof TENANT_ROUTES)[number], orgId: string) => {
    const req = (actor.agent as unknown as Record<string, (u: string) => { send: (b: unknown) => Promise<{ status: number }> } & Promise<{ status: number }>>)[r.method]!(fill(r.path, orgId)).set("x-org-id", orgId);
    return "body" in r ? req.send(r.body) : req;
};

describe("workspaces can't see each other: 404, never 403 (no existence leak)", () => {
    it.each(TENANT_ROUTES.map((r) => [`${r.method.toUpperCase()} ${r.path}`, r] as const))("%s with A's workspace id → 404 for B", async (_n, r) => {
        expect((await call(B, r, A.org.id)).status).toBe(404);
    });
    it.each(TENANT_ROUTES.filter((r) => /:(taskId|runId|exampleId|promptId)/.test(r.path)).map((r) => [`${r.method.toUpperCase()} ${r.path}`, r] as const))(
        "%s with B's OWN workspace but A's resource ids → 404 (or a 400 for a body B may not send), never A's data",
        async (_n, r) => {
            const res = (await call(B, r, B.org.id)) as { status: number; body?: unknown };
            expect([400, 404]).toContain(res.status);
            expect(JSON.stringify(res.body ?? "")).not.toContain(ids.runId);
        }
    );
    it("A still sees its own run", async () => {
        expect((await A.agent.get(`/orgs/${A.org.id}/runs/${ids.runId}`)).status).toBe(200);
    });
});
