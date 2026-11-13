import { aggregateVariant, type ResultLite } from "@repo/scoring";
import { fieldRulesSchema, type DemoOutcome, type DemoRunRequest } from "@repo/types";
import { prisma } from "../db/prisma";
import { appAssert } from "../utils/errors";
import { BAD_REQUEST, NOT_FOUND, SERVICE_UNAVAILABLE, UNAUTHORIZED } from "../constants/https";
import { appErrorCode } from "../constants/appErrorCode";
import { DEMO_DAILY_CAP } from "../constants/env";
import { redisConnection } from "../jobs/redis/connection";
import { logger } from "../utils/logger";
import { getRequestId, runAsSystem, runWithRequestContext } from "../utils/requestContext";
import { complete } from "../ai/complete";
import { ModelRetired, ProviderAuthError, ProviderHttpError, ProviderTimeout } from "../ai/errors";
import { executeCell, type CellOutcome } from "../runner/executeCell";
import { toModelConfig } from "../runner/cellContext";
import type { VariantSnapshot } from "../runner/snapshot";
import type { Price } from "../utils/cost";
import { assertKeyShape } from "../middleware/providerKey";

/*
  The bring-your-own-key demo (adapted from the Playbook's Try-it service). This file makes NO database
  writes (a test greps it) and never enqueues: a job payload in Redis would be a stored key. The work is
  bounded instead: 1 prompt × 1 model × ≤ 10 published, public dev examples, 2 calls at a time, 60 s.
 */
const TIME_BUDGET_MS = 60_000;
const CONCURRENCY = 2;

const FAILURES: Record<DemoOutcome, string> = {
    invalid_key: "The provider rejected this key.",
    rate_limited: "The provider is rate-limiting this key.",
    timeout: "No answer within the time limit.",
    retired: "This model has been retired by the provider.",
    provider_error: "The provider couldn't answer this time.",
};

const statusOf = (e: unknown) => (e instanceof ProviderHttpError ? e.status : undefined);
const classify = (e: unknown): DemoOutcome =>
    e instanceof ModelRetired ? "retired"
    : e instanceof ProviderAuthError ? "invalid_key"
    : statusOf(e) === 429 ? "rate_limited"
    : e instanceof ProviderTimeout || (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError")) ? "timeout"
    : "provider_error";

/* A global counter per UTC day. Fails open like the Playbook's: the visitor's key pays, and the IP limiter still applies. */
const underDailyCap = async () => {
    const key = `demo-${new Date().toISOString().slice(0, 10)}`;
    try {
        const count = await redisConnection.incr(key);
        if (count === 1) await redisConnection.expire(key, 48 * 60 * 60);
        return count <= Number(DEMO_DAILY_CAP);
    } catch {
        return true;
    }
};

const pool = async <T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> => {
    const out: R[] = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
        while (next < items.length) {
            const i = next++;
            out[i] = await fn(items[i]!);
        }
    }));
    return out;
};

/* Slug → (run, org) is the only cross-tenant read; everything after it runs scoped to that run's workspace. */
const publishedRun = async (slug: string) => {
    const hit = await runAsSystem(() => prisma.run.findUnique({ where: { publishedSlug: slug }, select: { id: true, orgId: true, publishedAt: true } }));
    appAssert(hit?.publishedAt, NOT_FOUND, "Demo not found");
    return hit;
};
const asOrg = <T>(orgId: string, fn: () => Promise<T>) => runWithRequestContext({ requestId: getRequestId() ?? "demo", orgId }, fn);

/** What the demo form offers for one published run: its variants, and its public dev examples. */
export const demoOptions = async (slug: string) => {
    const { id, orgId } = await publishedRun(slug);
    return asOrg(orgId, async () => {
        const run = await prisma.run.findUnique({ where: { id }, include: { variants: { include: { promptVersion: true, model: true } } } });
        appAssert(run, NOT_FOUND, "Demo not found");
        const examples = await prisma.example.findMany({
            where: { taskId: run.taskId, split: "dev", publicInput: true },
            orderBy: { ref: "asc" },
            take: 50,
            select: { ref: true, input: true, tags: true },
        });
        return {
            variants: run.variants.filter((v) => v.model.active).map((v) => ({
                promptVersion: `${v.promptVersion.key}@${v.promptVersion.version}`, technique: v.promptVersion.technique,
                modelKey: v.model.key, modelLabel: v.model.label, provider: v.model.provider,
            })),
            examples: examples.map((e) => ({ ref: e.ref, preview: e.input.slice(0, 160), tags: e.tags.filter((t) => t !== "_unsplit") })),
        };
    });
};

export const runDemo = async (input: DemoRunRequest, apiKey: string) => {
    const { id, orgId } = await publishedRun(input.slug);
    return asOrg(orgId, async () => {
        const run = await prisma.run.findUnique({ where: { id }, include: { task: true, variants: { include: { promptVersion: true, model: true } } } });
        appAssert(run, NOT_FOUND, "Demo not found");
        const variant = run.variants.find((v) => `${v.promptVersion.key}@${v.promptVersion.version}` === input.promptVersion && v.model.key === input.modelKey);
        appAssert(variant && variant.model.active, BAD_REQUEST, "Pick a prompt and model from this run");
        assertKeyShape(variant.model.provider, apiKey);
        appAssert(await underDailyCap(), SERVICE_UNAVAILABLE, "The demo is resting until tomorrow.", appErrorCode.DemoDailyCap);

        const examples = await prisma.example.findMany({ where: { taskId: run.taskId, ref: { in: input.exampleRefs }, split: "dev", publicInput: true } });
        appAssert(examples.length === input.exampleRefs.length, BAD_REQUEST, "Only this run's public dev examples can be used");

        // Exactly what the published numbers came from: the run's frozen prompt snapshot and price snapshot.
        const snapshot = (run.promptSnapshots as unknown as Record<string, VariantSnapshot>)[variant.promptVersionId]!;
        const price = (run.pricesSnapshot as unknown as Record<string, Price>)[variant.model.key]!;
        const fields = fieldRulesSchema.parse(run.task.fields);
        const model = toModelConfig(variant.model);
        const signal = AbortSignal.timeout(TIME_BUDGET_MS);

        const results = await pool(examples, CONCURRENCY, async (example) => {
            let outcome: CellOutcome & { outcome?: DemoOutcome };
            try {
                outcome = await executeCell(
                    { model, modelStructured: variant.model.structured, price, snapshot, fields, input: example.input, expected: example.expected as Record<string, unknown> },
                    { complete, apiKey, signal }
                );
            } catch (error) {
                const kind = classify(error);
                logger.info({ outcome: kind, status: statusOf(error) }, "demo cell failed"); // never the body, never the key
                outcome = { status: "error", error: FAILURES[kind], outcome: kind };
            }
            return { exampleRef: example.ref, input: example.input, expected: example.expected, tags: example.tags.filter((t) => t !== "_unsplit"), ...outcome };
        });

        appAssert(results.some((r) => r.outcome !== "invalid_key"), UNAUTHORIZED, FAILURES.invalid_key, appErrorCode.DemoKeyInvalid);
        const lite: ResultLite[] = results.map((r) => ({
            exampleId: r.exampleRef, repeat: 0, status: r.status, overallScore: r.overallScore, validJson: r.validJson, schemaValid: r.schemaValid,
            exactMatch: r.exactMatch, fieldScores: r.fieldScores, fieldDetails: r.fieldDetails as ResultLite["fieldDetails"], parsedJson: r.parsedJson,
            outputTokens: r.outputTokens, costUsdMicros: r.costUsdMicros, latencyMs: r.latencyMs,
        }));
        return {
            promptVersion: input.promptVersion,
            modelKey: variant.model.key,
            modelLabel: variant.model.label,
            technique: variant.promptVersion.technique,
            summary: aggregateVariant(lite, fields),
            results,
        };
    });
};
