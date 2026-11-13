import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { signupAndVerify } from "./helpers/signup";
import { resetRateLimits } from "./helpers/rateLimits";
import { API } from "./helpers/workspace";
import { apiEnv } from "./helpers/apiEnv";
import { playbookAvailable, runPlaybookImporter } from "./helpers/playbook";
import { MODEL_A, answer, createPrompt, createTaskWithExamples, posting, stubReset, waitForRun } from "./helpers/runs";

const REPO = path.resolve(__dirname, "../../..");

/** Runs an API script against the E2E database, exactly as an owner would from a terminal. */
const cli = (script: string, args: string[]) =>
  execFileSync("pnpm", ["--filter", "api", "exec", "tsx", `src/scripts/${script}.ts`, ...args], {
    cwd: REPO,
    env: { ...process.env, ...apiEnv, LOG_LEVEL: "silent" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

test.describe("Phase 22 — exports, Playbook result lines and published runs", () => {
  test.beforeEach(async () => {
    await resetRateLimits();
    await stubReset();
  });

  test("Markdown = CLI, formula-safe CSV, contract JSONL read by the Playbook importer, publish → public read-only page → unpublish", async ({ page, browser, context }) => {
    test.setTimeout(240_000);
    const owner = await signupAndVerify(page);
    const req = page.context().request;
    const evil = `=HYPERLINK("http://evil.example","click") ₹25,000 प्रति माह\n${posting(2)}`;
    const s = await createTaskWithExamples(req, [
      { id: "p_001", input: posting(1), expected: answer(1) },
      { id: "p_002", input: evil, expected: answer(2) },
      { id: "p_003", input: `PRIVATE-POSTING-TEXT ${posting(3, { mode: "prose" })}`, expected: answer(3) },
    ]);
    // p_003 is a third-party posting the owner may not republish: its input (and raw output) must stay off public pages.
    expect((await req.patch(`${s.T}/examples/${s.exampleIds["p_003"]}`, { data: { publicInput: false } })).status()).toBe(200);
    const v1 = await createPrompt(req, s.T, "v1-zero-shot", "Posting:\n{{input}}");
    const v2 = await createPrompt(req, s.T, "v2-few-shot", "Read carefully.\nPosting:\n{{input}}");
    const created = await req.post(`${API}/orgs/${s.orgId}/runs`, { data: { taskId: s.taskId, promptVersionIds: [v1, v2], modelKeys: [MODEL_A], split: "dev", repeats: 2, notes: "owner-only note" } });
    expect(created.status()).toBe(201);
    const runId = ((await created.json()) as { data: { id: string } }).data.id;
    const run = await waitForRun(req, s.orgId, runId, (r) => r.status === "completed");
    const R = `${API}/orgs/${s.orgId}/runs/${runId}`;

    // ── 1. Copy Markdown = `bench --run <id> --markdown`, byte for byte ──
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(`/runs/${runId}`);
    await page.getByTestId("copy-markdown").click();
    await expect(page.getByTestId("export-msg")).toHaveText("Markdown copied");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toMatch(/^\| Prompt \| Model \| n \| Overall/);
    expect(copied).toContain(`*Run ${runId} · dev split, 3 examples × 2 repeats (n = 6 per row)`);
    expect(copied).toContain("prices checked");
    expect(cli("bench", ["--run", runId, "--markdown"])).toBe(copied);

    // ── 2. CSVs: BOM, formula-safe, inputs off unless asked ──
    const csv = await (await req.get(`${R}/export/results.csv`)).text();
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.split("\r\n")[0]!.split(",")).not.toContain("input");
    expect(csv.split("\r\n")[0]!.split(",")).not.toContain("raw_output");
    expect(csv).not.toContain("HYPERLINK");
    const withText = await (await req.get(`${R}/export/results.csv?includeText=true`)).text();
    expect(withText.split("\r\n")[0]).toMatch(/,input,raw_output$/);
    expect(withText).toContain(`"'=HYPERLINK(""http://evil.example"",""click"") ₹25,000 प्रति माह`); // text, not a formula; UTF-8 intact
    expect(withText).not.toMatch(/(^|,)=HYPERLINK/m);
    const summaryCsv = await (await req.get(`${R}/export/summary.csv`)).text();
    expect(summaryCsv.split("\r\n").filter(Boolean)).toHaveLength(3); // header + 2 variants
    expect(summaryCsv).toContain("overall_ci_low");

    // ── 3. The contract export: one line per cell, readable by the Playbook's real importer ──
    const jsonlRes = await req.get(`${R}/export/results.jsonl`);
    expect(jsonlRes.headers()["content-type"]).toContain("application/x-ndjson");
    const jsonl = await jsonlRes.text();
    const lines = jsonl.trim().split("\n").map((l) => JSON.parse(l) as { runId: string; promptVersion: string; exampleId: string; repeat: number; status: string; fieldScores: { key: string; score: number }[] | null });
    expect(lines).toHaveLength(run.totalCells);
    expect(new Set(lines.map((l) => `${l.promptVersion}|${l.exampleId}|${l.repeat}`)).size).toBe(run.totalCells);
    expect(lines.every((l) => l.runId === runId)).toBe(true);
    if (playbookAvailable()) {
      const file = path.join(mkdtempSync(path.join(os.tmpdir(), "pl-export-")), "run.jsonl");
      writeFileSync(file, jsonl);
      const out = runPlaybookImporter(["--run", file, "--lesson", "be-specific",
        "--variant", `bad=v1-zero-shot@1,${MODEL_A},Zero-shot`, "--variant", `better=v2-few-shot@1,${MODEL_A},Few-shot`,
        "--metrics", "overall,valid_json", "--dry-run"]);
      expect(out).toContain("bad: n=3×2, 0 errors, 0 skipped");
      expect(out).toContain("better: n=3×2, 0 errors, 0 skipped");
      expect(out).toContain("(dry run: nothing written)");
    } else {
      test.info().annotations.push({ type: "skipped-step", description: "Playbook repo not found; importer dry-run not executed" });
    }
    // Case lines for the dev split, private inputs omitted with publicOnly.
    const cases = (await (await req.get(`${s.T}/examples/export.jsonl?split=dev&publicOnly=true`)).text()).trim().split("\n").map((l) => JSON.parse(l) as { id: string; input: string });
    expect(cases.find((c) => c.id === "p_003")!.input).toBe("[hidden]");

    // ── 4. Publish from the UI → a private window sees a read-only page with no owner data ──
    await page.goto(`/runs/${runId}`);
    await page.getByTestId("open-publish").click();
    await page.getByTestId("publish-title").fill("Zero-shot vs few-shot");
    await page.getByTestId("publish").click();
    const url = await page.getByTestId("published-url").inputValue();
    const slug = url.split("/r/")[1]!;
    expect(slug).toMatch(/^r_[0-9A-Za-z]{10}$/);
    await page.keyboard.press("Escape");

    const visitor = await browser.newContext(); // a private window: no cookies
    const vp = await visitor.newPage();
    await vp.goto(`/r/${slug}`);
    await expect(vp.getByTestId("published-title")).toHaveText("Zero-shot vs few-shot");
    await expect(vp.getByTestId("results-table")).toBeVisible();
    await expect(vp.getByTestId("caveats")).toContainText("Development split");
    await expect(vp.getByTestId("public-markdown")).toContainText(`Run ${runId}`);
    await expect(vp.getByTestId("public-notes")).toHaveCount(0); // notes were not chosen
    await expect(vp.locator("button, input, textarea, select").filter({ hasText: /publish|start|cancel|re-score/i })).toHaveCount(0);
    const orgName = ((await (await req.get(`${API}/orgs/${s.orgId}`)).json()) as { data: { org: { name: string } } }).data.org.name;
    expect(orgName).toBeTruthy();
    const html = await (await visitor.request.get(`/r/${slug}`)).text();
    expect(html).toContain("Zero-shot vs few-shot"); // server-rendered, not a loader shell
    for (const secret of [owner.email, orgName, "owner-only note"]) expect(html).not.toContain(secret);
    const pub = await (await visitor.request.get(`${API}/public/runs/${slug}`)).text();
    for (const secret of [owner.email, orgName, "owner-only note", "startedBy", "orgId"]) expect(pub).not.toContain(secret);
    // The read-only error browser: the private example shows "[input hidden]" and no raw output.
    await vp.goto(`/r/${slug}/errors?failedOnly=true`);
    const privateCard = vp.locator('[data-testid=result-card][data-ref="p_003"]').first();
    await expect(privateCard.getByTestId("input-hidden")).toHaveText("[input hidden]");
    await privateCard.getByTestId("toggle-raw").click();
    await expect(privateCard).toContainText("No output");
    await expect(vp.getByTestId("compare-link")).toHaveCount(0);
    const feed = await (await visitor.request.get(`${API}/public/runs/${slug}/results?limit=100`)).text();
    expect(feed).not.toContain("PRIVATE-POSTING-TEXT");
    expect(feed).toContain("p_001"); // public inputs are shown
    // The home page and /r list it.
    expect(await (await visitor.request.get(`${API}/public/runs`)).text()).toContain(slug);

    // ── 6 + 7. A guessed slug is a plain 404; the public limiter answers 429 in the envelope ──
    const t0 = Date.now();
    expect((await visitor.request.get(`${API}/public/runs/r_aaaaaaaaaa`)).status()).toBe(404);
    const guessMs = Date.now() - t0;
    const t1 = Date.now();
    expect((await visitor.request.get(`${API}/public/runs/${slug}`)).status()).toBe(200);
    expect(Math.abs(guessMs - (Date.now() - t1))).toBeLessThan(500);
    expect((await visitor.request.get(`${API}/public/runs/not-a-slug`)).status()).toBe(404);
    let limited: { status: number; body: string } | null = null;
    for (let i = 0; i < 320 && !limited; i++) {
      const r = await visitor.request.get(`${API}/public/runs/${slug}`);
      if (r.status() === 429) limited = { status: 429, body: await r.text() };
    }
    expect(limited?.status).toBe(429);
    expect(JSON.parse(limited!.body)).toMatchObject({ status: "error", data: null });
    await resetRateLimits();

    // ── 5. Unpublish → the API forgets the slug at once (cache bumped) ──
    await page.goto(`/runs/${runId}`);
    await page.getByTestId("open-publish").click();
    await page.getByTestId("unpublish").click();
    await expect(page.getByTestId("publish")).toBeVisible();
    expect((await visitor.request.get(`${API}/public/runs/${slug}`)).status()).toBe(404);
    expect(await (await visitor.request.get(`${API}/public/runs`)).text()).not.toContain(slug);
    await visitor.close();

    // export-run writes the same three files the endpoints serve.
    const dir = mkdtempSync(path.join(os.tmpdir(), "pl-run-"));
    cli("export-run", ["--run", runId, "--out-dir", dir]);
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(path.join(dir, `${runId}.md`), "utf8")).toBe(copied);
    expect(readFileSync(path.join(dir, `${runId}.results.jsonl`), "utf8")).toBe(jsonl);
  });
});
