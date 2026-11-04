import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRunSchema, fieldRulesSchema } from "@repo/types";
import { aggregateVariant, summaryMarkdown, type ResultLite } from "@repo/scoring";
import { prisma } from "../db/prisma";
import { runWithRequestContext } from "../utils/requestContext";
import { complete } from "../ai/complete";
import { replayProvider } from "../ai/providers/replay";
import { createRun, planRun } from "../runner/createRun";
import { executeCell, type CellOutcome } from "../runner/executeCell";
import { persistCell } from "../runner/persistCell";
import { toResultLine, type ResultForExport } from "../runner/resultLine";
import { toModelConfig } from "../runner/cellContext";
import { errorCode } from "../jobs/processors/runCell.processor";
import { closePubSub } from "../utils/events/pubsub";
import { closeAll } from "./closeAll";
import { flag, ownerOf, resolveOrgId } from "./resolveOrg";

/*
  pnpm --filter api bench -- --task job-postings --split dev \
    --prompts v1-zero-shot@1,v4-structured@1 --models nvidia:openai/gpt-oss-20b \
    [--repeats 1] [--concurrency 4] [--replay] [--save] [--out runs/2026-11-05-dev.jsonl] [--org <id> | --email <you>]

  The same core as the worker: planRun (validation, snapshots, prices) → executeCell → persistCell. A cell
  that fails is an `error` result, never a retry loop: the CLI is for looking at results, not for riding out
  an outage. Without --save nothing is written to the database and the run id is cli-<uuid>.
 */
const pool = async <T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) => {
    let next = 0;
    await Promise.all(
        Array.from({ length: Math.max(1, concurrency) }, async () => {
            while (next < items.length) await fn(items[next++]!);
        })
    );
};

const main = async () => {
    const args = process.argv.slice(2);
    const taskSlug = flag(args, "--task");
    const promptRefs = (flag(args, "--prompts") ?? "").split(",").filter(Boolean);
    const modelKeys = (flag(args, "--models") ?? "").split(",").filter(Boolean);
    if (!taskSlug || promptRefs.length === 0 || modelKeys.length === 0) {
        throw new Error("Usage: bench --task <slug> --prompts key@version,… --models <key>,… [--split dev|test] [--repeats n] [--concurrency n] [--replay] [--save] [--out file]");
    }
    const split = (flag(args, "--split") ?? "dev") as "dev" | "test";
    const repeats = Number(flag(args, "--repeats") ?? 1);
    const concurrency = Number(flag(args, "--concurrency") ?? 4);
    const replay = args.includes("--replay");
    const save = args.includes("--save");
    const out = flag(args, "--out");
    const orgId = await resolveOrgId({ orgId: flag(args, "--org"), email: flag(args, "--email") });

    await runWithRequestContext({ orgId, requestId: `cli-${randomUUID()}` }, async () => {
        const task = await prisma.task.findFirst({ where: { slug: taskSlug } });
        if (!task) throw new Error(`No task "${taskSlug}" in this workspace (run import-cases first)`);
        const prompts = await Promise.all(
            promptRefs.map(async (ref) => {
                const [key, version] = ref.split("@");
                const p = await prisma.promptVersion.findFirst({ where: { taskId: task.id, key, version: Number(version) } });
                if (!p) throw new Error(`No prompt version ${ref}`);
                return p;
            })
        );
        const body = createRunSchema.parse({ taskId: task.id, promptVersionIds: prompts.map((p) => p.id), modelKeys, split, repeats });

        // --replay answers from recorded files, so no provider key is needed; --save writes a real Run.
        const requireEnabled = !replay;
        const plan = await planRun(orgId, body, { requireEnabled });
        const saved = save ? await createRun(orgId, await ownerOf(orgId), body, { enqueue: false, requireEnabled }) : null;
        const runId = saved?.id ?? `cli-${randomUUID()}`;
        const fields = fieldRulesSchema.parse(task.fields);
        const examples = await prisma.example.findMany({ where: { taskId: task.id, split }, orderBy: { ref: "asc" } });

        type Cell = { prompt: (typeof prompts)[number]; model: (typeof plan.models)[number]; example: (typeof examples)[number]; repeat: number };
        const cells: Cell[] = examples.flatMap((example) =>
            Array.from({ length: repeats }, (_, repeat) => prompts.flatMap((prompt) => plan.models.map((model) => ({ prompt, model, example, repeat })))).flat()
        );

        const lines: ReturnType<typeof toResultLine>[] = [];
        const variantRows = new Map<string, { prompt: string; model: string; rows: ResultLite[] }>();
        await pool(cells, concurrency, async ({ prompt, model, example, repeat }) => {
            const config = toModelConfig(model);
            let outcome: CellOutcome;
            try {
                outcome = await executeCell(
                    {
                        model: config,
                        modelStructured: model.structured,
                        price: plan.pricesSnapshot[model.key]!,
                        snapshot: plan.snapshots[prompt.id]!,
                        fields,
                        input: example.input,
                        expected: example.expected as Record<string, unknown>,
                    },
                    { complete, apiKey: replay ? "replay" : undefined, adapter: replay ? replayProvider : undefined }
                );
            } catch (error) {
                outcome = { status: "error", error: errorCode(error) };
            }
            if (saved) {
                const variant = saved.variants.find((v) => v.promptVersionId === prompt.id && v.modelId === model.id)!;
                await persistCell({ orgId, runId, variantId: variant.id, exampleId: example.id, repeat }, outcome);
            }
            lines.push(
                toResultLine({
                    runId, split, promptKey: prompt.key, promptVersion: prompt.version, modelKey: model.key,
                    exampleRef: example.ref, exampleTags: example.tags.filter((t) => t !== "_unsplit"), repeatIndex: repeat,
                    status: outcome.status, rawOutput: outcome.rawOutput, validJson: outcome.validJson, schemaValid: outcome.schemaValid,
                    exactMatch: outcome.exactMatch, overallScore: outcome.overallScore, fieldScores: outcome.fieldScores,
                    fieldDetails: outcome.fieldDetails, inputTokens: outcome.inputTokens, outputTokens: outcome.outputTokens,
                    costUsdMicros: outcome.costUsdMicros, latencyMs: outcome.latencyMs, error: outcome.error,
                    testReused: saved?.testReused ?? false, completedAt: new Date(),
                } satisfies ResultForExport)
            );
            const k = `${prompt.key}@${prompt.version} × ${model.key}`;
            const entry = variantRows.get(k) ?? { prompt: `${prompt.key}@${prompt.version}`, model: model.key, rows: [] };
            entry.rows.push({
                exampleId: example.ref, repeat, status: outcome.status, overallScore: outcome.overallScore, validJson: outcome.validJson,
                schemaValid: outcome.schemaValid, exactMatch: outcome.exactMatch, fieldScores: outcome.fieldScores,
                fieldDetails: outcome.fieldDetails as ResultLite["fieldDetails"], parsedJson: outcome.parsedJson,
                outputTokens: outcome.outputTokens, costUsdMicros: outcome.costUsdMicros, latencyMs: outcome.latencyMs,
            });
            variantRows.set(k, entry);
        });

        // The results table, from the same aggregate the API uses (so the terminal and the README can't disagree).
        console.log(summaryMarkdown([...variantRows.values()].map((v) => ({ prompt: v.prompt, model: v.model, summary: aggregateVariant(v.rows, fields) }))));
        const priceDates = plan.models.map((m) => `${m.key}: ${m.priceCheckedOn.toISOString().slice(0, 10)}`).join(", ");
        console.log(`\nPrices checked on: ${priceDates}${saved?.testReused ? " | testReused: this test set was already used by an earlier run" : ""}`);
        console.log(`${saved ? "saved run" : "run"} ${runId}: ${cells.length} cells${saved?.testReused ? " (testReused)" : ""}`);
        if (out) {
            await mkdir(path.dirname(path.resolve(out)), { recursive: true });
            await writeFile(out, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
            console.log(`wrote ${lines.length} result lines to ${out}`);
        }
    });
};

main()
    .catch((e) => {
        console.error(e.message ?? e);
        process.exitCode = 1;
    })
    .finally(async () => {
        await closePubSub();
        await closeAll();
    });
