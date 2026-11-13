import "dotenv/config";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../db/prisma";
import { runWithRequestContext } from "../utils/requestContext";
import { closePubSub } from "../utils/events/pubsub";
import { closeAll } from "./closeAll";
import { flag, resolveOrgId } from "./resolveOrg";

/*
  pnpm --filter api exec tsx src/scripts/handoff.ts [--out ../../cases/HANDOFF.md] [--export-root <dir>] [--org id | --email you]
  Generates cases/HANDOFF.md from the database: per Playbook lesson (playbook-contract.md §3), the final
  completed TEST run that holds every version it needs, its export path, testReused, n per variant, and
  copy-pasteable importer commands. A lesson without such a run is printed as MISSING with what it lacks.
  Nobody types a run id or a model key.
 */
type Lesson = { n: number; slug: string; task: string; keys: string[]; metrics: string; needs?: string };
const LESSONS: Lesson[] = [
    { n: 1, slug: "be-specific", task: "job-postings", keys: ["v0-vague", "v1-zero-shot"], metrics: "overall,valid_json" },
    { n: 2, slug: "few-shot", task: "job-postings", keys: ["v1-zero-shot", "v2-few-shot", "v2b-one-shot"], metrics: "overall,stipend_or_salary", needs: "--subset salary_lpa / salary_hidden (Playbook Phase 25)" },
    { n: 3, slug: "chain-of-thought", task: "reasoning-mini", keys: ["direct", "cot"], metrics: "overall,tokens_out_mean", needs: "--results-file (Playbook Phase 26)" },
    { n: 4, slug: "structured-output", task: "job-postings", keys: ["v1-zero-shot", "v4-structured"], metrics: "overall,valid_json,schema_valid" },
    { n: 7, slug: "testing-prompts", task: "job-postings", keys: ["v1-zero-shot", "v1-thorough"], metrics: "overall,skills", needs: "--subset / --split-label / --append (Playbook Phase 30)" },
];
const LABEL: Record<string, string> = { "v0-vague": "Vague", "v1-zero-shot": "Specific", "v2-few-shot": "Few-shot", "v2b-one-shot": "One-shot", direct: "Direct", cot: "Chain-of-thought", "v4-structured": "Structured", "v1-thorough": "Be thorough" };
const ROLE: Record<string, string> = { "v0-vague": "bad", "v1-zero-shot": "better", "v2-few-shot": "better", "v2b-one-shot": "one", direct: "bad", cot: "better", "v4-structured": "better", "v1-thorough": "thorough" };

const main = async () => {
    const args = process.argv.slice(2);
    const out = flag(args, "--out") ?? path.resolve(__dirname, "../../../../cases/HANDOFF.md");
    const orgId = await resolveOrgId({ orgId: flag(args, "--org"), email: flag(args, "--email") });
    // Where exports live (cases/<task>/runs/…): the repo, or a scratch copy for tests.
    const repo = flag(args, "--export-root") ?? path.resolve(__dirname, "../../../..");
    const sections: string[] = [];
    let missing = 0;
    await runWithRequestContext({ orgId, requestId: `cli-${randomUUID()}` }, async () => {
        for (const lesson of LESSONS) {
            const runs = await prisma.run.findMany({
                where: { status: "completed", split: "test", task: { slug: lesson.task } },
                orderBy: { createdAt: "desc" },
                include: { variants: { include: { promptVersion: true, model: true } } },
            });
            const run = runs.find((r) => lesson.keys.every((k) => r.variants.some((v) => v.promptVersion.key === k)));
            const head = `## Lesson ${lesson.n}: ${lesson.slug}`;
            if (!run) {
                missing++;
                const have = new Set(runs.flatMap((r) => r.variants.map((v) => v.promptVersion.key)));
                sections.push(`${head}\n\n**MISSING**: no completed test run of \`${lesson.task}\` holds ${lesson.keys.map((k) => `\`${k}\``).join(", ")}` + (runs.length ? ` (missing from the latest: ${lesson.keys.filter((k) => !have.has(k)).join(", ") || "none, but never together in one run"})` : "") + ".\n");
                continue;
            }
            const counts = await prisma.result.groupBy({ by: ["variantId", "status"], where: { runId: run.id }, _count: true });
            const file = `cases/${lesson.task}/runs/${run.id}.results.jsonl`;
            const models = [...new Map(run.variants.map((v) => [v.model.key, v.model])).values()];
            const table = run.variants
                .filter((v) => lesson.keys.includes(v.promptVersion.key))
                .map((v) => {
                    const c = (s: string) => counts.find((x) => x.variantId === v.id && x.status === s)?._count ?? 0;
                    return `| ${v.promptVersion.key}@${v.promptVersion.version} | ${v.model.key} | ${c("scored")} | ${c("error")} | ${c("skipped")} |`;
                });
            const commands = models.map((m) => {
                const variants = lesson.keys.map((k) => {
                    const v = run.variants.find((x) => x.promptVersion.key === k && x.model.key === m.key);
                    return v ? `--variant "${ROLE[k]}=${k}@${v.promptVersion.version},${m.key},${LABEL[k]}"` : null;
                }).filter(Boolean);
                return `pnpm --filter site import:prompt-lab --run "${path.join(repo, file)}" --cases "${path.join(repo, `cases/${lesson.task}/data`, lesson.task === "job-postings" ? "job_postings.jsonl" : "reasoning_mini.jsonl")}" --lesson ${lesson.slug} ${variants.join(" ")} --metrics ${lesson.metrics}`;
            });
            sections.push([
                head, "",
                `- Run \`${run.id}\` · split ${run.split} · ${run.repeats} repeats · testReused **${run.testReused}** · finished ${run.finishedAt?.toISOString().slice(0, 10) ?? "?"}`,
                `- Export: \`${file}\` (\`pnpm --filter api export-run -- --run ${run.id} --out-dir ../../cases/${lesson.task}/runs\`)`,
                ...(lesson.needs ? [`- Needs ${lesson.needs}: listed, not run by playbook-dry-run.sh`] : []),
                "", "| Version | Model | scored | errors | skipped |", "| --- | --- | ---: | ---: | ---: |", ...table, "",
                lesson.needs ? "```text" : "```bash",
                ...commands,
                "```", "",
            ].join("\n"));
        }
    });
    const md = [
        "# Hand-off to the Prompt Engineering Playbook",
        "",
        `Generated by \`handoff.ts\` on ${new Date().toISOString().slice(0, 10)} from the database (never typed). One section per Playbook lesson (playbook-contract.md §3).`,
        "`playbook-dry-run.sh` runs every ```bash block below with `--dry-run`. Blocks marked text need flags the Playbook adds later.",
        "",
        ...sections,
    ].join("\n");
    await writeFile(out, md);
    console.log(`wrote ${out}: ${LESSONS.length - missing} ready, ${missing} MISSING`);
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
