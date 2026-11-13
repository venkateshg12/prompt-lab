import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { signupAndVerify } from "./helpers/signup";
import { resetRateLimits } from "./helpers/rateLimits";
import { API } from "./helpers/workspace";
import { apiEnv } from "./helpers/apiEnv";
import { playbookAvailable, runPlaybookImporter } from "./helpers/playbook";
import { MODEL_A, answer, createPrompt, createTaskWithExamples, posting, stubReset, waitForRun } from "./helpers/runs";

const REPO = path.resolve(__dirname, "../../..");
const cli = (script: string, args: string[]) =>
  execFileSync("pnpm", ["--filter", "api", "exec", "tsx", `src/scripts/${script}.ts`, ...args], { cwd: REPO, env: { ...process.env, ...apiEnv, LOG_LEVEL: "silent" }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

test.describe("Phase 27 — Playbook hand-off generated from the database", () => {
  test.beforeEach(async () => {
    await resetRateLimits();
    await stubReset();
  });

  test("a final test run holding v0-vague + v1-zero-shot → export-run → HANDOFF.md → the Playbook importer reads it", async ({ page }) => {
    test.skip(!playbookAvailable(), "Playbook repo not found: the hand-off's importer check needs it");
    test.setTimeout(180_000);
    await signupAndVerify(page);
    const req = page.context().request;
    const s = await createTaskWithExamples(req, Array.from({ length: 4 }, (_, i) => ({ id: `h_${i}`, split: "test" as const, input: posting(i), expected: answer(i) })));
    const v0 = await createPrompt(req, s.T, "v0-vague", "Extract the important details from this job posting as JSON.\n\n{{input}}");
    const v1 = await createPrompt(req, s.T, "v1-zero-shot", "Posting:\n{{input}}");
    const created = await req.post(`${API}/orgs/${s.orgId}/runs`, { data: { taskId: s.taskId, promptVersionIds: [v0, v1], modelKeys: [MODEL_A], split: "test", repeats: 2, confirmFinal: true } });
    expect(created.status()).toBe(201);
    const runId = ((await created.json()) as { data: { id: string } }).data.id;
    await waitForRun(req, s.orgId, runId, (r) => r.status === "completed");

    // Exports and the hand-off go to a scratch "repo", never the real cases/ folder.
    const root = mkdtempSync(path.join(os.tmpdir(), "pl-handoff-"));
    const runs = path.join(root, "cases/job-postings/runs");
    mkdirSync(runs, { recursive: true });
    cli("export-run", ["--run", runId, "--out-dir", runs]);
    const out = path.join(root, "HANDOFF.md");
    expect(cli("handoff", ["--org", s.orgId, "--out", out, "--export-root", root])).toContain("1 ready, 4 MISSING");
    const md = readFileSync(out, "utf8");
    expect(md).toContain(`Run \`${runId}\` · split test · 2 repeats · testReused **false**`);
    expect(md).toContain("| v0-vague@1 | nvidia:openai/gpt-oss-20b | 8 | 0 | 0 |");
    expect(md).toContain("**MISSING**: no completed test run of `reasoning-mini`");

    // The generated command, run through the Playbook's real importer (dry run).
    const line = md.split("\n").find((l) => l.startsWith("pnpm --filter site import:prompt-lab") && l.includes("--lesson be-specific"))!;
    const args = [...line.matchAll(/--(run|lesson|variant|metrics) (?:"([^"]+)"|(\S+))/g)].flatMap((m) => [`--${m[1]}`, m[2] ?? m[3]!]);
    const result = runPlaybookImporter([...args, "--dry-run"]);
    expect(result).toContain("bad: n=4×2, 0 errors, 0 skipped");
    expect(result).toContain("better: n=4×2, 0 errors, 0 skipped");
    expect(result).toContain("(dry run: nothing written)");
  });
});
