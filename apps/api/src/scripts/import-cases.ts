import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../db/prisma";
import { runAsSystem, runWithRequestContext } from "../utils/requestContext";
import { createTask, updateTask } from "../services/task.service";
import { importExamples } from "../services/example.service";
import { contentHash, createPrompt } from "../services/prompt.service";
import { parsePromptFile } from "../prompts/promptFile";
import { cache } from "../utils/cache";
import { getQueueRedis } from "../config/redis";
import { createTaskSchema, promptBodySchema } from "@repo/types";
import { sameJson } from "../utils/stableJson";

/*
  pnpm --filter api import-cases -- --case job-postings [--org <orgId> | --email <userEmail>] [--dry-run | --check]

  --check is a dry run that exits 1 when the files differ from the database (for CI)

  Loads cases/<case>/ into PostgreSQL, idempotently. Without --org/--email it uses (or creates) the
  workspace "Case studies" owned by the first platform admin, so a fresh clone and CI can load a case
  with one command. Phase 12 adds examples from data/*.jsonl, Phase 13 prompts from prompts/*.md.
 */
const flag = (args: string[], name: string): string | undefined => {
    const index = args.indexOf(name);
    return index !== -1 ? args[index + 1] : undefined; // check -1 first: args[indexOf + 1] reads args[0] when absent
};

const parseArgs = (args: string[]) => {
    const caseSlug = flag(args, "--case");
    if (!caseSlug || !/^[a-z0-9-]+$/.test(caseSlug)) throw new Error("--case <slug> is required (e.g. job-postings)");
    const check = args.includes("--check");
    return { caseSlug, orgId: flag(args, "--org"), email: flag(args, "--email"), check, dryRun: check || args.includes("--dry-run") };
};

const CASE_ORG_NAME = "Case studies";

const resolveOrgId = async (opts: { orgId?: string; email?: string }): Promise<string> => {
    if (opts.orgId) return opts.orgId;
    return runAsSystem(async () => {
        if (opts.email) {
            const user = await prisma.user.findUnique({ where: { email: opts.email.toLowerCase() } });
            if (!user) throw new Error(`No user ${opts.email}`);
            const membership = await prisma.membership.findFirst({ where: { userId: user.id, role: "owner" }, orderBy: { createdAt: "asc" } });
            if (!membership) throw new Error(`${opts.email} owns no workspace`);
            return membership.orgId;
        }
        const admin = await prisma.user.findFirst({ where: { role: "admin" }, orderBy: { createdAt: "asc" } });
        if (!admin) throw new Error('No platform admin to own the "Case studies" workspace: pass --org <orgId> or --email <you>');
        const existing = await prisma.org.findFirst({ where: { name: CASE_ORG_NAME, createdById: admin.id } });
        if (existing) return existing.id;
        const org = await prisma.org.create({ data: { name: CASE_ORG_NAME, createdById: admin.id } });
        await prisma.membership.create({ data: { orgId: org.id, userId: admin.id, role: "owner" } });
        return org.id;
    });
};

const main = async () => {
    const { caseSlug, orgId: orgFlag, email, dryRun, check } = parseArgs(process.argv.slice(2));
    let drift = 0; // things the files would change in the database
    const orgId = await resolveOrgId({ orgId: orgFlag, email });
    const dir = path.resolve(__dirname, "../../../../cases", caseSlug);
    const body = createTaskSchema.parse(JSON.parse(await readFile(path.join(dir, "task.json"), "utf8")));
    const actor = { type: "system" as const };

    // The tenant extension needs an org in context: run as that org, exactly like a request would.
    await runWithRequestContext({ orgId, requestId: `import-${Date.now()}` }, async () => {
        const existing = await prisma.task.findFirst({ where: { slug: body.slug } });
        if (!existing) {
            drift++;
            console.log(dryRun ? "would create task" : "created task", body.slug);
            if (!dryRun) await createTask(orgId, body, actor);
        } else {
            const { slug: _slug, ...update } = body;
            const keys = ["name", "description", "instructions", "fields"] as const;
            const same = keys.every((k) => sameJson(existing[k], update[k]));
            if (!same) drift++;
            console.log(same ? "task unchanged" : dryRun ? "would update task" : "updated task", body.slug);
            if (!same && !dryRun) await updateTask(orgId, existing.id, update, actor);
        }

        // Examples: every data/*.jsonl through the same service the API uses. Any invalid row aborts.
        const task = await prisma.task.findFirst({ where: { slug: body.slug } });
        const dataDir = path.join(dir, "data");
        const files = (await readdir(dataDir).catch(() => [])).filter((f) => f.endsWith(".jsonl")).sort();
        for (const file of files) {
            if (!task) {
                console.log(`would import ${file} (task not created in a dry run)`);
                continue;
            }
            const content = await readFile(path.join(dataDir, file), "utf8");
            const preview = await importExamples(orgId, task.id, { format: "jsonl", content, dryRun: true }, actor);
            console.log(`${file}: ${preview.valid} valid, ${preview.invalid.length} invalid, new ${preview.new}, changed ${preview.changed}, unchanged ${preview.unchanged}`);
            if (preview.invalid.length > 0) {
                for (const bad of preview.invalid.slice(0, 20)) console.error(`  line ${bad.line}${bad.ref ? ` (${bad.ref})` : ""}: ${bad.issues.join("; ")}`);
                throw new Error(`${file} has invalid rows; nothing was imported`);
            }
            drift += preview.new + preview.changed;
            if (!dryRun) await importExamples(orgId, task.id, { format: "jsonl", content, dryRun: false }, actor);
        }

        // Prompts: every prompts/*.md. A changed file always creates the NEXT version (never edits one,
        // even an unfrozen one), so git and the database tell the same history.
        const promptDir = path.join(dir, "prompts");
        const promptFiles = (await readdir(promptDir).catch(() => [])).filter((f) => f.endsWith(".md")).sort();
        for (const file of promptFiles) {
            const parsed = parsePromptFile(await readFile(path.join(promptDir, file), "utf8"), file);
            const refs = parsed.fewShotRefs;
            const shots = task && refs.length ? await prisma.example.findMany({ where: { taskId: task.id, ref: { in: refs } } }) : [];
            for (const ref of refs) {
                const shot = shots.find((e) => e.ref === ref);
                if (task && (!shot || shot.split !== "dev")) throw new Error(`${file}: few-shot ${ref} must be a dev example of this task`);
            }
            const prompt = promptBodySchema.parse({
                key: parsed.key,
                technique: parsed.technique,
                system: parsed.system,
                template: parsed.template,
                fewShotExampleIds: refs.map((ref) => shots.find((e) => e.ref === ref)?.id).filter((id): id is string => Boolean(id)),
                notes: parsed.notes,
            });
            const latest = task ? await prisma.promptVersion.findFirst({ where: { taskId: task.id, key: prompt.key }, orderBy: { version: "desc" } }) : null;
            if (latest && contentHash(latest) === contentHash(prompt)) {
                console.log(`prompt unchanged ${prompt.key}@${latest.version}`);
                continue;
            }
            drift++;
            const nextVersion = (latest?.version ?? 0) + 1;
            if (dryRun || !task) {
                console.log(`would create ${prompt.key}@${nextVersion}`);
            } else {
                const created = await createPrompt(orgId, task.id, prompt, actor);
                console.log(`created ${created.key}@${created.version}`);
            }
        }
    });
    if (check && drift > 0) {
        console.error(`${drift} difference(s) between cases/${caseSlug} and the database`);
        process.exitCode = 1;
    }
};

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    // CLI scripts inherit service connections: close them or the process hangs.
    .finally(() => Promise.allSettled([prisma.$disconnect(), cache.close(), getQueueRedis().quit()]));
