import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";
import type { Response } from "express";
import { prisma } from "../db/prisma";
import { runAsSystem, runWithRequestContext } from "../utils/requestContext";
import { runMarkdown, runSummaryCsv, streamResultLines } from "../services/export.service";
import { closePubSub } from "../utils/events/pubsub";
import { closeAll } from "./closeAll";
import { flag } from "./resolveOrg";

/*
  pnpm --filter api export-run -- --run <id> --out-dir runs/
  → runs/<id>.results.jsonl (Playbook contract), runs/<id>.summary.csv, runs/<id>.md
  The same functions as the API's export endpoints, so a file and a download are identical.
 */
const main = async () => {
    const args = process.argv.slice(2);
    const runId = flag(args, "--run");
    const outDir = flag(args, "--out-dir") ?? "runs";
    if (!runId) throw new Error("Usage: export-run --run <runId> [--out-dir runs]");
    const orgId = await runAsSystem(async () => {
        const run = await prisma.run.findUnique({ where: { id: runId }, select: { orgId: true } });
        if (!run) throw new Error(`No run ${runId}`);
        return run.orgId;
    });
    await mkdir(outDir, { recursive: true });
    await runWithRequestContext({ orgId, requestId: `cli-${randomUUID()}` }, async () => {
        const base = path.join(outDir, runId);
        // streamResultLines writes to an Express Response; a file stream with the same write/once("drain") contract stands in.
        const file = createWriteStream(`${base}.results.jsonl`);
        const sink = Object.assign(file as unknown as Writable, { setHeader: () => undefined }) as unknown as Response;
        await streamResultLines(runId, sink);
        await new Promise((resolve) => file.on("close", resolve));
        await writeFile(`${base}.summary.csv`, await runSummaryCsv(orgId, runId));
        await writeFile(`${base}.md`, await runMarkdown(orgId, runId));
        console.log(`wrote ${base}.results.jsonl, ${base}.summary.csv, ${base}.md`);
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
