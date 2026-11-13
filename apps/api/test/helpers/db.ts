// ADAPT of @pt-api/test/helpers/db.ts: Prompt Lab's seeds (task, examples, prompts, models) instead of documents.
import { readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "../../src/db/prisma";
import { runAsSystem } from "../../src/utils/requestContext";
import { seedModels } from "../../src/services/model.service";
import type { TestActor } from "./auth";

/** Reads across tenants, for assertions. */
export const asSystem = <T>(fn: () => Promise<T>) => runAsSystem(fn);

const TASK = JSON.parse(readFileSync(path.resolve(__dirname, "../../../../cases/job-postings/task.json"), "utf8"));

/** A valid job-posting answer (the shape every field rule accepts). */
export const answer = (n: number, over: Record<string, unknown> = {}) => ({
    title: "Engineer", company: `Co${n}`, location: "Pune", remote: "onsite", employment_type: "full_time",
    experience_years_min: 2, skills: ["react", "node.js"], stipend_or_salary: null, ...over,
});

/** The fake:* registry rows (MODELS_SEED=test), and optionally an NVIDIA-shaped row for BYOK tests. */
export const seedModel = async (extra?: { key: string; modelId: string }) =>
    asSystem(async () => {
        await seedModels();
        if (extra) {
            await prisma.model.upsert({
                where: { key: extra.key },
                update: { active: true },
                create: { key: extra.key, provider: "nvidia", modelId: extra.modelId, label: extra.modelId, inputUsdMicrosPerMTok: 50_000, outputUsdMicrosPerMTok: 200_000, priceCheckedOn: new Date("2026-11-01"), active: true },
            });
        }
    });

/** The job-postings task through the real routes, with `dev` + `test` examples and the given prompt keys. */
export const seedCaseStudy = async (owner: TestActor, opts: { dev: number; test?: number; prompts?: string[]; tags?: (i: number) => string[] }) => {
    const O = `/orgs/${owner.org.id}`;
    const task = (await owner.agent.post(`${O}/tasks`).send(TASK).expect(201)).body.data.task as { id: string };
    const T = `${O}/tasks/${task.id}`;
    const lines = [
        ...Array.from({ length: opts.dev }, (_, i) => ({ id: `d_${String(i).padStart(3, "0")}`, split: "dev", tags: opts.tags?.(i) ?? [], input: `Posting ${i}`, expected: answer(i) })),
        ...Array.from({ length: opts.test ?? 0 }, (_, i) => ({ id: `t_${String(i).padStart(3, "0")}`, split: "test", tags: opts.tags?.(i) ?? [], input: `Test posting ${i}`, expected: answer(100 + i) })),
    ];
    await owner.agent.post(`${T}/examples/import`).send({ format: "jsonl", content: lines.map((l) => JSON.stringify(l)).join("\n"), dryRun: false }).expect(200);
    const examples = (await owner.agent.get(`${T}/examples?limit=100`).expect(200)).body.data as { id: string; ref: string; split: string }[];
    const prompts: Record<string, string> = {};
    for (const key of opts.prompts ?? ["v1-zero-shot"]) {
        const res = await owner.agent.post(`${T}/prompts`).send({ key, technique: "zero_shot", system: "{{instructions}}\n\nFields:\n{{fields}}", template: "Posting:\n{{input}}" }).expect(201);
        prompts[key] = res.body.data.id;
    }
    return { task, T, examples, prompts, byRef: Object.fromEntries(examples.map((e) => [e.ref, e.id])) as Record<string, string> };
};
