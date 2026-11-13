import { randomInt } from "node:crypto";
import { prisma, Prisma } from "../db/prisma";
import { isUniqueViolation } from "../db/errors";
import { appAssert } from "../utils/errors";
import { CONFLICT, NOT_FOUND } from "../constants/https";
import { cache } from "../utils/cache";
import { getRequestId, runAsSystem, runWithRequestContext } from "../utils/requestContext";
import { recordAudit, type AuditActor } from "./audit.service";
import { getRunSummary, listResults, type ResultsQuery } from "./results.service";
import { markdownOf } from "./export.service";
import type { PublishBody } from "@repo/types";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
/** r_ + 10 base62 characters from the CSPRNG: unguessable, and short enough to paste. */
export const newSlug = () => `r_${Array.from({ length: 10 }, () => BASE62[randomInt(62)]).join("")}`;

export type PublishOptions = { title: string | null; includeNotes: boolean };
const TERMINAL = new Set(["completed", "cancelled", "failed"]);

/* ── The owner's side (tenant-scoped like every other request) ─────────────────────────────────── */

export const publishRun = async (orgId: string, runId: string, body: PublishBody, actor: AuditActor) => {
    const run = await prisma.run.findUnique({ where: { id: runId }, select: { id: true, status: true, publishedSlug: true } });
    appAssert(run, NOT_FOUND, "Run not found");
    appAssert(TERMINAL.has(run.status), CONFLICT, "Wait for the run to finish before publishing it");
    const publishOptions: PublishOptions = { title: body.title ?? null, includeNotes: body.includeNotes };
    let slug = run.publishedSlug;
    if (slug) {
        // Already public: only the options change; the link everyone has keeps working.
        await prisma.run.update({ where: { id: runId }, data: { publishOptions } });
    } else {
        for (let attempt = 0; ; attempt++) {
            const candidate = newSlug();
            try {
                await prisma.run.update({ where: { id: runId }, data: { publishedSlug: candidate, publishedAt: new Date(), publishOptions } });
                slug = candidate;
                break;
            } catch (e) {
                if (!isUniqueViolation(e) || attempt >= 2) throw e; // a collision is ~1 in 10^17: retry, at most 3 tries
            }
        }
    }
    await recordAudit({ orgId, actor, action: "run.publish", target: { type: "run", id: runId }, diff: { slug, ...publishOptions } });
    await cache.bump("published");
    const saved = await prisma.run.findUnique({ where: { id: runId }, select: { publishedSlug: true, publishedAt: true, publishOptions: true } });
    return { slug: saved!.publishedSlug!, publishedAt: saved!.publishedAt, options: saved!.publishOptions as PublishOptions };
};

export const unpublishRun = async (orgId: string, runId: string, actor: AuditActor) => {
    const run = await prisma.run.findUnique({ where: { id: runId }, select: { publishedSlug: true } });
    appAssert(run, NOT_FOUND, "Run not found");
    appAssert(run.publishedSlug, NOT_FOUND, "This run isn't published");
    await prisma.run.update({ where: { id: runId }, data: { publishedSlug: null, publishedAt: null, publishOptions: Prisma.DbNull } });
    await recordAudit({ orgId, actor, action: "run.unpublish", target: { type: "run", id: runId }, diff: { slug: run.publishedSlug } });
    await cache.bump("published");
    return { unpublished: true };
};

/** The workspace's published runs (the owner's "Published" page). */
export const listOrgPublished = async () => {
    const runs = await prisma.run.findMany({
        where: { publishedSlug: { not: null } },
        orderBy: { publishedAt: "desc" },
        select: { id: true, publishedSlug: true, publishedAt: true, publishOptions: true, split: true, task: { select: { name: true } } },
    });
    return runs.map((r) => ({ runId: r.id, slug: r.publishedSlug!, publishedAt: r.publishedAt, options: r.publishOptions as PublishOptions | null, split: r.split, taskName: r.task.name }));
};

/* ── The public side: the ONLY cross-tenant read is slug → (runId, orgId); everything after is scoped ── */

const resolveSlug = async (slug: string) => {
    const hit = await runAsSystem(() => prisma.run.findUnique({ where: { publishedSlug: slug }, select: { id: true, orgId: true } }));
    appAssert(hit, NOT_FOUND, "Not found");
    return hit;
};
const asOrg = <T>(orgId: string, fn: () => Promise<T>) => runWithRequestContext({ requestId: getRequestId() ?? "public", orgId }, fn);

/*
  What a published page may show: versions, split, n, prices with dates, prompt text, caveats.
  Never: owner name or email, workspace name, user ids, drafts, anything that spends money.
 */
const buildPublicRun = async (slug: string) => {
    const { id, orgId } = await resolveSlug(slug);
    return asOrg(orgId, async () => {
        const run = await prisma.run.findUnique({
            where: { id },
            include: { task: { select: { name: true, slug: true, version: true, fields: true } }, variants: { include: { promptVersion: true, model: true } } },
        });
        appAssert(run, NOT_FOUND, "Not found");
        const options = (run.publishOptions as PublishOptions | null) ?? { title: null, includeNotes: false };
        const summary = await getRunSummary(orgId, id);
        const examples = await prisma.result.findMany({ where: { runId: id }, distinct: ["exampleId"], select: { exampleId: true } });
        const prompts = [...new Map(run.variants.map((v) => [v.promptVersion.id, v.promptVersion])).values()].map((p) => ({
            ref: `${p.key}@${p.version}`, technique: p.technique, system: p.system, template: p.template,
        }));
        const prices = run.pricesSnapshot as Record<string, { inputUsdMicrosPerMTok: number; outputUsdMicrosPerMTok: number; priceCheckedOn: string; priceNote?: string | null }>;
        const models = [...new Map(run.variants.map((v) => [v.model.key, v.model])).values()].map((m) => ({ key: m.key, label: m.label, provider: m.provider, price: prices[m.key] ?? null }));
        const caveats: string[] = [];
        if (run.split === "dev") caveats.push("Development split: these numbers guided prompt changes, so they are optimistic. Final numbers come from the test split.");
        if (run.testReused) caveats.push("The test set had already been used by an earlier run: not a clean final result.");
        if (summary.variants.some((v) => v.summary.n < 20)) caveats.push("Small sample (n < 20) on at least one row: read the intervals, not the point values.");
        if (run.repeats > 1) caveats.push("Intervals are computed over results (examples × repeats); repeats of one example are not independent, so they are slightly optimistic.");
        for (const line of (run.notes ?? "").split("\n")) if (line.startsWith("re-scored")) caveats.push(`Re-scored from stored outputs (no model calls): ${line.replace(/^re-scored /, "")}.`);
        const notes = Object.values(prices).map((p) => p.priceNote).filter(Boolean);
        if (notes.length) caveats.push(`Prices: ${[...new Set(notes)].join("; ")}.`);
        return {
            slug,
            title: options.title ?? `${run.task.name}: ${run.split} run`,
            publishedAt: run.publishedAt,
            run: {
                id: run.id, split: run.split, repeats: run.repeats, status: run.status, testReused: run.testReused, taskVersion: run.taskVersion,
                totalCells: run.totalCells, createdAt: run.createdAt, finishedAt: run.finishedAt, notes: options.includeNotes ? run.notes : null,
            },
            task: { name: run.task.name, slug: run.task.slug, version: run.task.version, fields: run.task.fields },
            prompts,
            models,
            tags: summary.tags,
            variants: summary.variants.map(({ price: _price, ...v }) => v),
            caveats,
            markdown: markdownOf(summary, run, examples.length),
        };
    });
};

/** Cached 5 min under `published` (bumped by publish, unpublish and re-score). */
export const getPublicRun = async (slug: string) => {
    const key = await cache.versionedKey(["published"], `public:run:${slug}`);
    return cache.getOrSet(key, () => buildPublicRun(slug), 300);
};

/** The read-only error browser feed: hidden inputs come back null, and so does their raw output (it can quote the input). */
export const getPublicResults = async (slug: string, q: ResultsQuery) => {
    const { id, orgId } = await resolveSlug(slug);
    return asOrg(orgId, () => listResults(orgId, id, q, { publicView: true }));
};

/** The home page's list: published runs across workspaces (slug, title, task, split, best row, date). */
export const listPublicRuns = async () => {
    const key = await cache.versionedKey(["published"], "public:list");
    return cache.getOrSet(key, () =>
        runAsSystem(async () => {
            const runs = await prisma.run.findMany({
                where: { publishedSlug: { not: null } },
                orderBy: { publishedAt: "desc" },
                take: 50,
                select: {
                    publishedSlug: true, publishedAt: true, publishOptions: true, split: true, task: { select: { name: true } },
                    variants: { select: { summary: true, promptVersion: { select: { key: true, version: true } }, model: { select: { label: true } } } },
                },
            });
            return runs.map((r) => {
                const best = r.variants
                    .map((v) => ({ prompt: `${v.promptVersion.key}@${v.promptVersion.version}`, model: v.model.label, overall: (v.summary as { metrics?: { overall?: { value: number } | null } } | null)?.metrics?.overall?.value ?? null }))
                    .filter((v) => v.overall != null)
                    .sort((a, b) => b.overall! - a.overall!)[0] ?? null;
                const options = r.publishOptions as PublishOptions | null;
                return { slug: r.publishedSlug!, title: options?.title ?? `${r.task.name}: ${r.split} run`, taskName: r.task.name, split: r.split, publishedAt: r.publishedAt, best };
            });
        }), 300);
};
