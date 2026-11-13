import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { prisma } from "../db/prisma";
import { runWithRequestContext } from "../utils/requestContext";
import { parseNotebook } from "../cases/notebook";
import { closePubSub } from "../utils/events/pubsub";
import { closeAll } from "./closeAll";
import { flag, resolveOrgId } from "./resolveOrg";

/*
  pnpm --filter api exec tsx src/scripts/check-notebook.ts ../../cases/job-postings/EXPERIMENT.md [--org id | --email you]
  Exit 1 when a run id doesn't exist in the workspace, a change lacks hypothesis/change/delta/decision, or
  Lesson 7's picks are missing or later than the first run that used v1-thorough.
 */
const main = async () => {
    const args = process.argv.slice(2);
    const file = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1]?.startsWith("--") !== true);
    if (!file) throw new Error("Usage: check-notebook <EXPERIMENT.md> [--org id | --email you]");
    const nb = parseNotebook(await readFile(file, "utf8"));
    const orgId = await resolveOrgId({ orgId: flag(args, "--org"), email: flag(args, "--email") });
    const problems: string[] = [];
    await runWithRequestContext({ orgId, requestId: `cli-${randomUUID()}` }, async () => {
        const found = new Set((await prisma.run.findMany({ where: { id: { in: nb.runIds } }, select: { id: true } })).map((r) => r.id));
        for (const id of nb.runIds) if (!found.has(id)) problems.push(`run ${id} is not in this workspace`);
        for (const c of nb.changes) if (c.missing.length) problems.push(`${c.title}: missing ${c.missing.join(", ")}`);
        const first = await prisma.run.findFirst({
            where: { variants: { some: { promptVersion: { key: "v1-thorough" } } } },
            orderBy: { createdAt: "asc" },
            select: { id: true, createdAt: true },
        });
        if (first && !nb.picks) problems.push(`v1-thorough ran (${first.id}) but "Lesson 7 picks: <time> · refs" is missing`);
        if (first && nb.picks && nb.picks.at >= first.createdAt) problems.push(`Lesson 7 picks (${nb.picks.at.toISOString()}) are not before v1-thorough's first run (${first.createdAt.toISOString()})`);
    });
    for (const p of problems) console.log(`✗ ${p}`);
    console.log(`${nb.runIds.length} run ids, ${nb.changes.length} changes, picks ${nb.picks ? nb.picks.at.toISOString() : "none"}: ${problems.length ? `${problems.length} problem(s)` : "OK"}`);
    process.exitCode = problems.length ? 1 : 0;
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
