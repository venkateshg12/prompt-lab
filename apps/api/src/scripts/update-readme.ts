import "dotenv/config";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { flag } from "./args";
import { currentBlock, PLACEHOLDER, postNumbers, renderBlock, replaceBetweenMarkers, resumeBullet, type Snapshot } from "../cases/readme";

/*
  pnpm --filter api readme:update -- --run <id> [--public-base https://prompt-lab.vercel.app]
      the PUBLISHED TEST run → docs/results/<id>.summary.json (snapshot) → README results block
  pnpm --filter api readme:check
      re-renders the block from the committed snapshot (no database) and exits 1 if the README differs
  pnpm --filter api readme:update -- --print-bullet | --print-post
      the resume bullet / the post's numbers, from the same snapshot, same rounding
 */
const ROOT = path.resolve(__dirname, "../../../..");
const README = path.join(ROOT, "README.md");
const RESULTS = path.join(ROOT, "docs/results");

const snapshotOfReadme = async (readme: string): Promise<Snapshot | null> => {
    const runId = /\*Run ([0-9a-f-]{36}) ·/.exec(currentBlock(readme))?.[1];
    if (!runId) return null;
    const file = path.join(RESULTS, `${runId}.summary.json`);
    if (!existsSync(file)) throw new Error(`The README quotes run ${runId} but ${path.relative(ROOT, file)} is missing`);
    return JSON.parse(await readFile(file, "utf8")) as Snapshot;
};

/* The only part that needs the database (and so the API env): building the snapshot. */
const buildSnapshot = async (runId: string, publicBase: string | undefined): Promise<Snapshot> => {
    const { prisma } = await import("../db/prisma.js");
    const { runAsSystem, runWithRequestContext } = await import("../utils/requestContext.js");
    const { getRunSummary } = await import("../services/results.service.js");
    const { loadRunForExport, markdownInput } = await import("../services/export.service.js");
    const run = await runAsSystem(() => prisma.run.findUnique({ where: { id: runId }, select: { orgId: true, split: true, publishedSlug: true, status: true } }));
    if (!run) throw new Error(`No run ${runId}`);
    if (run.split !== "test") throw new Error(`Run ${runId} is a ${run.split} run: the README quotes the final TEST run only`);
    if (run.status !== "completed") throw new Error(`Run ${runId} is ${run.status}`);
    if (!run.publishedSlug) throw new Error(`Run ${runId} isn't published: publish it first, so every number can be clicked into`);
    return runWithRequestContext({ requestId: "readme", orgId: run.orgId }, async () => {
        const full = await loadRunForExport(runId);
        const examples = (await prisma.result.findMany({ where: { runId }, distinct: ["exampleId"], select: { exampleId: true } })).length;
        const { rows, meta } = markdownInput(await getRunSummary(run.orgId, runId), full, examples);
        const { CLIENT_URL } = await import("../constants/env.js");
        const base = (publicBase ?? CLIENT_URL ?? "").replace(/\/$/, "");
        return { runId, slug: run.publishedSlug, publicUrl: base ? `${base}/r/${run.publishedSlug}` : null, rows, meta };
    });
};

const main = async () => {
    const args = process.argv.slice(2);
    const readme = await readFile(README, "utf8");

    if (args.includes("--check")) {
        const snap = await snapshotOfReadme(readme);
        if (!snap) {
            if (currentBlock(readme) === PLACEHOLDER) return console.log("README: no run quoted yet (placeholder) — OK");
            throw new Error("README results block is neither the placeholder nor a generated table");
        }
        if (currentBlock(readme) !== renderBlock(snap)) {
            console.error(`README results block differs from docs/results/${snap.runId}.summary.json: run readme:update, never edit the table by hand`);
            process.exitCode = 1;
            return;
        }
        return console.log(`README results block matches run ${snap.runId}`);
    }

    if (args.includes("--print-bullet") || args.includes("--print-post")) {
        const snap = await snapshotOfReadme(readme);
        if (!snap) throw new Error("No run in the README yet: run readme:update -- --run <id> first");
        return console.log(args.includes("--print-bullet") ? resumeBullet(snap) : postNumbers(snap));
    }

    const runId = flag(args, "--run");
    if (!runId) throw new Error("Usage: readme:update -- --run <published test run id> [--public-base <web url>] | --check | --print-bullet | --print-post");
    const snap = await buildSnapshot(runId, flag(args, "--public-base"));
    await mkdir(RESULTS, { recursive: true });
    await writeFile(path.join(RESULTS, `${runId}.summary.json`), JSON.stringify(snap, null, 2) + "\n");
    await writeFile(README, replaceBetweenMarkers(readme, renderBlock(snap)));
    console.log(`README results block written from run ${runId} (snapshot docs/results/${runId}.summary.json)`);
};

main()
    .catch((e) => {
        console.error(e.message ?? e);
        process.exitCode = 1;
    })
    .finally(async () => {
        // Only the --run path opened connections (dynamic imports); close them if they exist.
        if (process.argv.includes("--run")) {
            const { closePubSub } = await import("../utils/events/pubsub.js");
            const { closeAll } = await import("./closeAll.js");
            await closePubSub();
            await closeAll();
        }
    });
