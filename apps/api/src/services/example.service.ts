import { createHash } from "node:crypto";
import { prisma, type Prisma } from "../db/prisma";
import { withTransaction } from "../utils/db";
import { afterCursor, cursorOrder, decodeCursor, pageOf } from "../utils/db/cursor";
import { cache } from "../utils/cache";
import { sameJson } from "../utils/stableJson";
import { parseJsonl } from "../utils/importers/jsonl";
import { parseCsv } from "../utils/importers/csv";
import { recordAudit, type AuditActor } from "./audit.service";
import { getTask } from "./task.service";
import appAssert from "../utils/errors/appAssert";
import { BAD_REQUEST, FORBIDDEN, NOT_FOUND } from "../constants/https";
import {
    answerSchemaFor,
    caseLineSchema,
    type AutoSplitBody,
    type CaseLine,
    type FieldRule,
    type ImportExamplesBody,
    type OrgRole,
    type UpdateExampleBody,
} from "@repo/types";
import { z } from "zod";
import type { Example } from "../generated/prisma/client";

const MAX_EXAMPLES_PER_TASK = 1000;
const UNSPLIT = "_unsplit"; // tag: file had no split; auto-split reassigns exactly these rows and removes it

const fmt = (issue: z.core.$ZodIssue) => `${issue.path.join(".") || "(row)"}: ${issue.message}`;
const realTags = (tags: string[]) => tags.filter((t) => t !== UNSPLIT);
const sortedTags = (tags: string[]) => [...tags].sort();

/** An example as the API returns it. A reviewer doesn't see `expected` until their own label is in (blind double-labelling). */
export const toExampleDto = (e: Example, role?: OrgRole) => {
    const hideExpected = role === "reviewer" && e.secondLabel === null;
    return {
        id: e.id,
        ref: e.ref,
        split: e.split,
        tags: realTags(e.tags),
        unsplit: e.tags.includes(UNSPLIT),
        input: e.input,
        expected: hideExpected ? null : e.expected,
        expectedHidden: hideExpected,
        publicInput: e.publicInput,
        secondLabel: e.secondLabel,
        secondLabelById: e.secondLabelById,
        notes: e.notes,
        revision: e.revision,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
    };
};

const loadTaskAnswerSchema = async (taskId: string) => {
    const task = await getTask(taskId);
    return { task, rules: task.fields as FieldRule[], answer: answerSchemaFor(task.fields) };
};

type Plan = { v: CaseLine & { line: number }; old?: Example; kind: "new" | "changed" | "unchanged"; labelChanged: boolean };

/** Parses, validates and plans an import (no writes). Shared by the preview, the commit and import-cases. */
export const planImport = async (taskId: string, body: Pick<ImportExamplesBody, "format" | "content">) => {
    const { answer } = await loadTaskAnswerSchema(taskId);
    const rows = body.format === "jsonl" ? parseJsonl(body.content) : parseCsv(body.content);

    const invalid: { line: number; ref?: string; issues: string[] }[] = [];
    const valid: (CaseLine & { line: number })[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
        if (row.error) {
            invalid.push({ line: row.line, issues: [row.error] });
            continue;
        }
        const line = caseLineSchema.safeParse(row.value);
        if (!line.success) {
            invalid.push({ line: row.line, issues: line.error.issues.map(fmt) });
            continue;
        }
        if (seen.has(line.data.id)) {
            invalid.push({ line: row.line, ref: line.data.id, issues: ["duplicate id in file"] });
            continue;
        }
        seen.add(line.data.id);
        const expected = answer.safeParse(line.data.expected);
        if (!expected.success) {
            invalid.push({ line: row.line, ref: line.data.id, issues: expected.error.issues.map((i) => `expected.${fmt(i)}`) });
            continue;
        }
        valid.push({ ...line.data, expected: expected.data, line: row.line });
    }

    const existing = new Map(
        (await prisma.example.findMany({ where: { taskId, ref: { in: valid.map((v) => v.id) } } })).map((e) => [e.ref, e])
    );
    const plan: Plan[] = valid.map((v) => {
        const old = existing.get(v.id);
        const labelChanged = Boolean(old && (old.input !== v.input || !sameJson(old.expected, v.expected)));
        const metaChanged = Boolean(
            old &&
                ((v.split !== undefined && old.split !== v.split) ||
                    !sameJson(sortedTags(realTags(old.tags)), sortedTags(v.tags)) ||
                    (v.publicInput !== undefined && old.publicInput !== v.publicInput) ||
                    (v.notes !== undefined && old.notes !== v.notes))
        );
        const kind = !old ? "new" : labelChanged || metaChanged ? "changed" : "unchanged";
        return { v, old, kind, labelChanged };
    });
    const summary = {
        valid: valid.length,
        invalid,
        new: plan.filter((p) => p.kind === "new").length,
        changed: plan.filter((p) => p.kind === "changed").length,
        unchanged: plan.filter((p) => p.kind === "unchanged").length,
    };
    return { plan, summary };
};

export const importExamples = async (orgId: string, taskId: string, body: ImportExamplesBody, actor: AuditActor) => {
    const { plan, summary } = await planImport(taskId, body);
    const total = (await prisma.example.count({ where: { taskId } })) + summary.new;
    appAssert(total <= MAX_EXAMPLES_PER_TASK, BAD_REQUEST, `A task holds at most ${MAX_EXAMPLES_PER_TASK} examples`);
    // A half-imported test set is worse than none: nothing is written while any row is invalid.
    if (body.dryRun || summary.invalid.length > 0) return { dryRun: true, ...summary };

    await withTransaction(async (tx) => {
        for (const { v, old, kind, labelChanged } of plan) {
            if (kind === "unchanged") continue;
            const unsplit = !v.split && (!old || old.tags.includes(UNSPLIT));
            const data = {
                input: v.input,
                expected: v.expected as Prisma.InputJsonValue,
                tags: unsplit ? [...new Set([...v.tags, UNSPLIT])] : v.tags,
                split: v.split ?? old?.split ?? "dev",
                publicInput: v.publicInput ?? old?.publicInput ?? true,
                notes: v.notes ?? old?.notes ?? null,
            };
            if (!old) {
                await tx.example.create({ data: { orgId, taskId, ref: v.id, ...data } });
            } else {
                await tx.example.update({
                    where: { id: old.id },
                    data: { ...data, ...(labelChanged ? { revision: { increment: 1 } } : {}) },
                });
                if (labelChanged) {
                    await recordAudit(
                        {
                            orgId,
                            actor,
                            action: "example.relabel",
                            target: { type: "example", id: old.id },
                            diff: { expected: { from: old.expected, to: v.expected }, input: { changed: old.input !== v.input } },
                        },
                        tx
                    );
                }
                if (v.split && old.split === "test" && v.split === "dev") {
                    await recordAudit({ orgId, actor, action: "example.split_moved", target: { type: "example", id: old.id }, diff: { from: "test", to: "dev" } }, tx);
                }
            }
        }
    });
    await cache.bump("tasks"); // example counts feed the task list
    return { dryRun: false, ...summary };
};

export const listExamples = async (
    taskId: string,
    query: { split?: "dev" | "test"; tag?: string; q?: string; cursor?: string; limit: number },
    role: OrgRole
) => {
    const where: Prisma.ExampleWhereInput = {
        taskId,
        ...(query.split ? { split: query.split } : {}),
        ...(query.tag ? { tags: { has: query.tag } } : {}),
        ...(query.q
            ? { OR: [{ ref: { contains: query.q, mode: "insensitive" } }, { input: { contains: query.q, mode: "insensitive" } }] }
            : {}),
        ...afterCursor(decodeCursor(query.cursor)),
    };
    const rows = await prisma.example.findMany({ where, orderBy: cursorOrder, take: query.limit + 1 });
    const { items, meta } = pageOf(rows, query.limit);
    return { items: items.map((e) => toExampleDto(e, role)), meta };
};

export const getExample = async (taskId: string, id: string, role: OrgRole) => {
    const example = await prisma.example.findFirst({ where: { id, taskId } });
    appAssert(example, NOT_FOUND, "Example not found");
    return toExampleDto(example, role);
};

export const updateExample = async (orgId: string, taskId: string, id: string, body: UpdateExampleBody, actor: AuditActor) => {
    const { answer } = await loadTaskAnswerSchema(taskId);
    let expected: unknown;
    if (body.expected !== undefined) {
        const parsed = answer.safeParse(body.expected);
        appAssert(parsed.success, BAD_REQUEST, parsed.success ? "" : parsed.error.issues.map((i) => `expected.${fmt(i)}`).join("; "));
        expected = parsed.data;
    }
    const updated = await withTransaction(async (tx) => {
        const before = await tx.example.findFirst({ where: { id, taskId } });
        appAssert(before, NOT_FOUND, "Example not found");
        const labelChanged =
            (body.input !== undefined && body.input !== before.input) ||
            (expected !== undefined && !sameJson(expected, before.expected));
        const tags =
            body.tags !== undefined
                ? // moving to a real split settles the "unsplit" marker
                  [...new Set([...body.tags, ...(before.tags.includes(UNSPLIT) && body.split === undefined ? [UNSPLIT] : [])])]
                : body.split !== undefined
                  ? realTags(before.tags)
                  : undefined;
        const example = await tx.example.update({
            where: { id },
            data: {
                ...(body.input !== undefined ? { input: body.input } : {}),
                ...(expected !== undefined ? { expected: expected as Prisma.InputJsonValue } : {}),
                ...(body.split !== undefined ? { split: body.split } : {}),
                ...(tags !== undefined ? { tags } : {}),
                ...(body.publicInput !== undefined ? { publicInput: body.publicInput } : {}),
                ...(body.notes !== undefined ? { notes: body.notes } : {}),
                ...(labelChanged ? { revision: { increment: 1 } } : {}),
            },
        });
        if (labelChanged) {
            await recordAudit(
                {
                    orgId,
                    actor,
                    action: "example.relabel",
                    target: { type: "example", id },
                    diff: { expected: { from: before.expected, to: example.expected }, input: { changed: before.input !== example.input } },
                },
                tx
            );
        }
        if (body.split === "dev" && before.split === "test") {
            // Phase 17: flag when a test run already used it
            await recordAudit({ orgId, actor, action: "example.split_moved", target: { type: "example", id }, diff: { from: "test", to: "dev" } }, tx);
        }
        return example;
    });
    await cache.bump("tasks");
    return toExampleDto(updated);
};

export const deleteExample = async (taskId: string, id: string) => {
    // Phase 17: 409 if results reference it
    const { count } = await prisma.example.deleteMany({ where: { id, taskId } });
    appAssert(count === 1, NOT_FOUND, "Example not found");
    await cache.bump("tasks");
};

const order = (slug: string, ref: string) => createHash("sha256").update(`${slug}:${ref}`).digest("hex");

/*
  Deterministic stratified split. Each example joins the group of its RAREST real tag (fewest examples,
  then alphabetical; untagged = "_none"), so a rare tag isn't swallowed by a common one. Within a group
  the order is sha256(slug:ref); the first round(n × devShare) go to dev, but a group of two or more
  always puts at least one example on each side.
 */
export const autoSplit = async (orgId: string, taskId: string, body: AutoSplitBody, actor: AuditActor) => {
    // Phase 17: reassign: true only while the task has no test run
    const task = await getTask(taskId);
    const all = await prisma.example.findMany({ where: { taskId } });
    const pool = body.reassign ? all : all.filter((e) => e.tags.includes(UNSPLIT));

    const tagCounts = new Map<string, number>();
    for (const e of pool) for (const t of realTags(e.tags)) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    const groupOf = (e: Example) => {
        const tags = realTags(e.tags);
        if (tags.length === 0) return "_none";
        return [...tags].sort((a, b) => (tagCounts.get(a)! - tagCounts.get(b)!) || (a < b ? -1 : 1))[0]!;
    };

    const groups = new Map<string, Example[]>();
    for (const e of pool) groups.set(groupOf(e), [...(groups.get(groupOf(e)) ?? []), e]);

    const assignment = new Map<string, "dev" | "test">();
    const summary: Record<string, { dev: number; test: number }> = {};
    for (const [group, members] of [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
        const sorted = [...members].sort((a, b) => (order(task.slug, a.ref) < order(task.slug, b.ref) ? -1 : 1));
        const n = sorted.length;
        let devCount = Math.round(n * body.devShare);
        if (n >= 2) devCount = Math.min(Math.max(devCount, 1), n - 1);
        sorted.forEach((e, i) => assignment.set(e.id, i < devCount ? "dev" : "test"));
        summary[group] = { dev: devCount, test: n - devCount };
    }

    await withTransaction(async (tx) => {
        for (const e of pool) {
            const split = assignment.get(e.id)!;
            await tx.example.update({ where: { id: e.id }, data: { split, tags: realTags(e.tags) } });
            if (e.split === "test" && split === "dev") {
                await recordAudit({ orgId, actor, action: "example.split_moved", target: { type: "example", id: e.id }, diff: { from: "test", to: "dev" } }, tx);
            }
        }
    });
    await cache.bump("tasks");
    const dev = [...assignment.values()].filter((s) => s === "dev").length;
    return { assigned: pool.length, dev, test: pool.length - dev, groups: summary };
};

/*
  A reviewer labels blind and independently: the label is validated by the task's own schema, and it
  can't come from the person who last relabelled `expected` (a second label by the same person
  measures nothing).
 */
export const setSecondLabel = async (orgId: string, taskId: string, id: string, label: unknown, reviewerId: string) => {
    const { answer } = await loadTaskAnswerSchema(taskId);
    const parsed = answer.safeParse(label);
    appAssert(parsed.success, BAD_REQUEST, parsed.success ? "" : parsed.error.issues.map(fmt).join("; "));

    const example = await prisma.example.findFirst({ where: { id, taskId } });
    appAssert(example, NOT_FOUND, "Example not found");
    const lastRelabel = await prisma.auditLog.findFirst({
        where: { targetType: "example", targetId: id, action: "example.relabel" },
        orderBy: { at: "desc" },
    });
    appAssert(lastRelabel?.actorId !== reviewerId, FORBIDDEN, "The second label must come from someone other than the person who last edited the expected answer");

    const updated = await withTransaction(async (tx) => {
        const row = await tx.example.update({
            where: { id },
            data: { secondLabel: parsed.data as Prisma.InputJsonValue, secondLabelById: reviewerId },
        });
        await recordAudit({ orgId, actor: { type: "user", id: reviewerId }, action: "example.second_label", target: { type: "example", id } }, tx);
        return row;
    });
    return toExampleDto(updated, "owner");
};

/*
  Per-field agreement between `expected` and `secondLabel` over double-labelled examples. Until Phase 16
  exists "agree" means equal after JSON canonicalisation; Phase 16 swaps in the field scorers (so
  ["JS"] vs ["javascript"] agree, and LPA vs monthly agree within 5 %).
 */
export const agreement = async (taskId: string) => {
    const { rules } = await loadTaskAnswerSchema(taskId);
    const both = await prisma.example.findMany({ where: { taskId, secondLabelById: { not: null } } });
    const same = (a: unknown, b: unknown) => sameJson(a, b); // Phase 16: scoreField(rule, a, b) === 1
    const fields = rules.map((rule) => {
        const disagreements = both
            .filter((e) => !same((e.expected as Record<string, unknown>)?.[rule.key], (e.secondLabel as Record<string, unknown>)?.[rule.key]))
            .map((e) => e.ref);
        const agree = both.length - disagreements.length;
        return { key: rule.key, agree, total: both.length, rate: both.length ? agree / both.length : null, disagreements };
    });
    return { examples: both.length, fields };
};

export const exportExamples = async (taskId: string, opts: { split?: "dev" | "test"; publicOnly?: boolean }) => {
    const rows = await prisma.example.findMany({
        where: { taskId, ...(opts.split ? { split: opts.split } : {}) },
        orderBy: { ref: "asc" },
    });
    return rows
        .map((e) =>
            JSON.stringify({
                id: e.ref,
                split: e.split,
                tags: realTags(e.tags),
                input: opts.publicOnly && !e.publicInput ? "[hidden]" : e.input,
                expected: e.expected,
            })
        )
        .join("\n") + (rows.length ? "\n" : "");
};

