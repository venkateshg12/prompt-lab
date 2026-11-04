import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../db/prisma";
import { runAsSystem, runWithRequestContext } from "../utils/requestContext";
import { createTask, updateTask } from "../services/task.service";
import { cache } from "../utils/cache";
import { getQueueRedis } from "../config/redis";
import { createTaskSchema } from "@repo/types";
import { sameJson } from "../utils/stableJson";

/*
  pnpm --filter api import-cases -- --case job-postings [--org <orgId> | --email <userEmail>] [--dry-run]

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
    return { caseSlug, orgId: flag(args, "--org"), email: flag(args, "--email"), dryRun: args.includes("--dry-run") };
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
    const { caseSlug, orgId: orgFlag, email, dryRun } = parseArgs(process.argv.slice(2));
    const orgId = await resolveOrgId({ orgId: orgFlag, email });
    const dir = path.resolve(__dirname, "../../../../cases", caseSlug);
    const body = createTaskSchema.parse(JSON.parse(await readFile(path.join(dir, "task.json"), "utf8")));
    const actor = { type: "system" as const };

    // The tenant extension needs an org in context: run as that org, exactly like a request would.
    await runWithRequestContext({ orgId, requestId: `import-${Date.now()}` }, async () => {
        const existing = await prisma.task.findFirst({ where: { slug: body.slug } });
        if (!existing) {
            console.log(dryRun ? "would create task" : "created task", body.slug);
            if (!dryRun) await createTask(orgId, body, actor);
        } else {
            const { slug: _slug, ...update } = body;
            const keys = ["name", "description", "instructions", "fields"] as const;
            const same = keys.every((k) => sameJson(existing[k], update[k]));
            console.log(same ? "task unchanged" : dryRun ? "would update task" : "updated task", body.slug);
            if (!same && !dryRun) await updateTask(orgId, existing.id, update, actor);
        }
        // Phase 12: examples from data/*.jsonl. Phase 13: prompts from prompts/*.md.
    });
};

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    // CLI scripts inherit service connections: close them or the process hangs.
    .finally(() => Promise.allSettled([prisma.$disconnect(), cache.close(), getQueueRedis().quit()]));
