import { test, expect } from "@playwright/test";
import { signupAndVerify, waitForDevMail } from "./helpers/signup";
import { resetRateLimits } from "./helpers/rateLimits";
import { API, addToWorkspace, newMember } from "./helpers/workspace";
import { sql } from "./helpers/db";
import {
  MODEL_A, MODEL_B, answer, collectProgress, createPrompt, createTaskWithExamples, posting, stubReset, stubStats, waitForRun,
} from "./helpers/runs";

const labelled = (n: number, opts: Parameters<typeof posting>[1] = {}, split: "dev" | "test" = "dev") => ({
  id: `r_${String(n).padStart(3, "0")}`, split, input: posting(n, opts), expected: answer(n),
});

test.describe("Phase 17 — the runner (real queue, worker, scorer, DB and SSE; deterministic stub model)", () => {
  test.beforeEach(async () => {
    await resetRateLimits();
    await stubReset();
  });

  test("a 2×2 grid runs to completion: exact results, errors counted but not scored, live progress, email", async ({ page }) => {
    const owner = await signupAndVerify(page);
    const req = page.context().request;
    const s = await createTaskWithExamples(req, [
      labelled(1), // perfect
      labelled(2, { give: { remote: "hybrid" } }), // wrong remote: 7/8
      labelled(3, { mode: "prose" }), // prose around the JSON: invalid, never repaired
      labelled(4, { mode: "fence" }), // fenced JSON: valid, raw text kept verbatim
      labelled(5, { mode: "400" }), // provider answers 400: an error cell
      labelled(6, { mode: "flaky2" }), // 429, 429, then OK: attempts 3
    ]);
    const p1 = await createPrompt(req, s.T, "v1-zero-shot", "Posting:\n{{input}}");
    const p2 = await createPrompt(req, s.T, "v2-job", "Job:\n{{input}}");
    const body = { taskId: s.taskId, promptVersionIds: [p1, p2], modelKeys: [MODEL_A, MODEL_B], split: "dev", repeats: 1 };

    // The server-side estimate runs the same validation as a real run, and writes nothing.
    const est = (await (await req.post(`${API}/orgs/${s.orgId}/runs/estimate`, { data: body })).json()) as { data: { totalCells: number; withinBudget: boolean; estimatedCostUsdMicros: number } };
    expect(est.data).toMatchObject({ totalCells: 24, withinBudget: true });
    expect(est.data.estimatedCostUsdMicros).toBeGreaterThan(0);
    expect((await sql("select count(*)::int as n from runs where task_id = $1", [s.taskId]))[0]!.n).toBe(0);

    const created = await req.post(`${API}/orgs/${s.orgId}/runs`, { data: body });
    expect(created.status()).toBe(201);
    const run = ((await created.json()) as { data: { id: string; totalCells: number; status: string } }).data;
    expect(run.totalCells).toBe(24);

    // Live progress over SSE, in the page like the real UI: monotonic, ends at 24/24.
    const progress = await collectProgress(page, s.orgId, run.id);
    const done = progress.map((m) => m.doneCells);
    expect([...done].sort((a, b) => a - b)).toEqual(done);
    expect(done.at(-1)).toBe(24);

    const final = await waitForRun(req, s.orgId, run.id, (r) => r.status === "completed");
    expect(final).toMatchObject({ doneCells: 24, errorCells: 4 });
    expect(final.variants).toHaveLength(4);
    for (const v of final.variants) expect(v).toMatchObject({ scored: 5, errors: 1, skipped: 0 });
    expect(final.progressByModel.map((m) => m.done)).toEqual([12, 12]);

    // Exactly one result per cell, with the right outcome for each kind of model behaviour.
    const rows = await sql(
      `select e.ref, r.status, r.attempts, r.valid_json, r.schema_valid, r.overall_score, r.exact_match, r.raw_output, r.error, r.cost_usd_micros, r.field_details
         from results r join examples e on e.id = r.example_id where r.run_id = $1`,
      [run.id]
    );
    expect(rows).toHaveLength(24);
    const of = (ref: string) => rows.filter((r) => r.ref === ref);
    for (const r of of("r_001")) expect(r).toMatchObject({ status: "scored", valid_json: true, schema_valid: true, overall_score: 1, exact_match: true });
    for (const r of of("r_002")) expect(r).toMatchObject({ status: "scored", valid_json: true, exact_match: false, overall_score: 0.875 });
    for (const r of of("r_003")) {
      expect(r).toMatchObject({ status: "scored", valid_json: false, overall_score: 0 });
      expect(r.raw_output).toMatch(/^Sure! Here is the extraction: \{/); // stored verbatim
    }
    for (const r of of("r_004")) {
      expect(r).toMatchObject({ status: "scored", valid_json: true, overall_score: 1 });
      expect(r.raw_output.startsWith("```json")).toBe(true); // the fence is kept in the raw text, stripped only for parsing
    }
    for (const r of of("r_005")) {
      expect(r).toMatchObject({ status: "error", attempts: 1, overall_score: null });
      expect(r.error).toMatch(/^ProviderHttpError: .*400/);
    }
    for (const r of of("r_006")) expect(r).toMatchObject({ status: "scored", attempts: 3, overall_score: 1 });
    expect(rows.filter((r) => r.status === "scored").every((r) => r.cost_usd_micros > 0)).toBe(true);
    expect(rows.find((r) => r.ref === "r_001")!.field_details.skills).toMatchObject({ precision: 1, recall: 1 });

    // 8 calls per variant: 4 single-call cells + the 400 + three attempts for the flaky one.
    expect((await stubStats()).calls).toBe(32);

    // The prompts are frozen the moment a run used them; a frozen version can't be edited.
    expect((await req.patch(`${s.T}/prompts/${p1}`, { data: { notes: "late edit" } })).status()).toBe(409);
    // The prompt text each variant was run with is snapshotted on the run.
    const snaps = (await sql("select prompt_snapshots from runs where id = $1", [run.id]))[0]!.prompt_snapshots as Record<string, { userTemplate: string; versionId: string }>;
    expect(Object.values(snaps).map((x) => x.versionId).sort()).toEqual(["v1-zero-shot@1", "v2-job@1"]);

    // "Your run finished" email, through the queue, with a link to the run.
    const mail = await waitForDevMail(page, owner.email, /\/runs\//);
    expect(mail.link).toContain(`/runs/${run.id}`);
  });

  test("cancel mid-run: remaining cells are skipped, no further model calls, rate-limit waits are not errors", async ({ page }) => {
    await signupAndVerify(page);
    const req = page.context().request;
    // 50 slow examples per model is above the 40/min per-model budget: ten cells per model must WAIT (not error).
    const s = await createTaskWithExamples(req, Array.from({ length: 50 }, (_, i) => labelled(i + 1, { mode: "slow" })));
    const p = await createPrompt(req, s.T, "v1-zero-shot", "Posting:\n{{input}}");
    const run = ((await (await req.post(`${API}/orgs/${s.orgId}/runs`, { data: { taskId: s.taskId, promptVersionIds: [p], modelKeys: [MODEL_A, MODEL_B], split: "dev" } })).json()) as { data: { id: string } }).data;

    await waitForRun(req, s.orgId, run.id, (r) => r.doneCells >= 4);
    const cancelled = await req.post(`${API}/orgs/${s.orgId}/runs/${run.id}/cancel`);
    expect(cancelled.status()).toBe(200);

    // Every remaining cell drains as `skipped`; the run keeps its terminal status.
    const final = await waitForRun(req, s.orgId, run.id, (r) => r.doneCells === r.totalCells, 60_000);
    expect(final.status).toBe("cancelled");
    expect(final.errorCells).toBe(0); // a full rate-limit budget is waiting, never an error
    const counts = await sql("select status, count(*)::int as n from results where run_id = $1 group by 1", [run.id]);
    const by = Object.fromEntries(counts.map((c) => [c.status, c.n]));
    expect(by.scored).toBeGreaterThanOrEqual(4);
    expect(by.skipped).toBeGreaterThan(0);
    expect((by.scored ?? 0) + (by.skipped ?? 0)).toBe(100);
    expect((await sql("select count(*)::int as n from results where run_id = $1 and status = 'skipped' and error <> 'cancelled'", [run.id]))[0]!.n).toBe(0);

    // No further spend after the cancel.
    const calls = (await stubStats()).calls;
    await page.waitForTimeout(1500);
    expect((await stubStats()).calls).toBe(calls);

    // A cancelled run can't be cancelled again.
    const again = await req.post(`${API}/orgs/${s.orgId}/runs/${run.id}/cancel`);
    expect(again.status()).toBe(409);
    expect(((await again.json()) as { errors: { code: string }[] }).errors[0]!.code).toBe("RUN_NOT_CANCELLABLE");
  });

  test("budget, test-set reuse, structured-probe and role guards", async ({ page, browser }) => {
    await signupAndVerify(page);
    const req = page.context().request;
    const s = await createTaskWithExamples(req, [labelled(1), labelled(2, {}, "test")]);
    const zero = await createPrompt(req, s.T, "v1-zero-shot", "Posting:\n{{input}}");
    const structured = await createPrompt(req, s.T, "v4-structured", "Posting:\n{{input}}", "structured");
    const runBody = (over: object = {}) => ({ taskId: s.taskId, promptVersionIds: [zero], modelKeys: [MODEL_A], split: "dev", ...over });
    // The test split needs deliberate intent: without confirmFinal it is refused.
    const noIntent = await req.post(`${API}/orgs/${s.orgId}/runs`, { data: runBody({ split: "test" }) });
    expect(noIntent.status()).toBe(400);
    const post = (data: object) => req.post(`${API}/orgs/${s.orgId}/runs`, { data });

    // A structured prompt needs a probed model: untested is refused before anything is created.
    const unprobed = await post(runBody({ promptVersionIds: [structured] }));
    expect(unprobed.status()).toBe(400);
    expect(((await unprobed.json()) as { errors: { code: string }[] }).errors[0]!.code).toBe("MODEL_UNPROBED");
    // Unknown / unusable inputs are rejected up front.
    expect((await post(runBody({ modelKeys: ["nvidia:nope/missing"] }))).status()).toBe(404);
    expect((await post(runBody({ split: "test", confirmFinal: true, promptVersionIds: [zero], taskId: "00000000-0000-7000-8000-000000000000" }))).status()).toBe(404);

    // Budget: a zero budget refuses the run with 402 and creates nothing.
    expect((await req.patch(`${API}/orgs/${s.orgId}`, { data: { monthlyBudgetUsd: 0 } })).status()).toBe(200);
    const broke = await post(runBody());
    expect(broke.status()).toBe(402);
    expect(((await broke.json()) as { errors: { code: string }[] }).errors[0]!.code).toBe("BUDGET_EXCEEDED");
    expect((await sql("select count(*)::int as n from runs where task_id = $1", [s.taskId]))[0]!.n).toBe(0);
    expect((await req.patch(`${API}/orgs/${s.orgId}`, { data: { monthlyBudgetUsd: 20 } })).status()).toBe(200);

    // Test once: the second test run on the same dataset is flagged testReused.
    const first = ((await (await post(runBody({ split: "test", confirmFinal: true }))).json()) as { data: { id: string; testReused: boolean } }).data;
    expect(first.testReused).toBe(false);
    await waitForRun(req, s.orgId, first.id, (r) => r.status === "completed");
    const second = ((await (await post(runBody({ split: "test", confirmFinal: true }))).json()) as { data: { id: string; testReused: boolean } }).data;
    expect(second.testReused).toBe(true);
    await waitForRun(req, s.orgId, second.id, (r) => r.status === "completed");

    // Roles: a viewer can read runs but not start one; another workspace sees nothing.
    const viewer = await newMember(browser);
    await addToWorkspace(req, s.orgId, viewer, "viewer");
    expect((await viewer.request.get(`${API}/orgs/${s.orgId}/runs`)).status()).toBe(200);
    expect((await viewer.request.post(`${API}/orgs/${s.orgId}/runs`, { data: runBody() })).status()).toBe(403);
    expect((await viewer.request.post(`${API}/orgs/${s.orgId}/runs/${first.id}/cancel`)).status()).toBe(403);
    const stranger = await newMember(browser);
    expect((await stranger.request.get(`${API}/orgs/${s.orgId}/runs/${first.id}`)).status()).toBe(404);
    // A task with runs can't be deleted, and its test examples can't be re-split.
    expect((await req.delete(s.T)).status()).toBe(409);
    expect((await req.post(`${s.T}/examples/split`, { data: { reassign: true } })).status()).toBe(409);
    expect((await req.delete(`${s.T}/examples/${s.exampleIds["r_002"]}`)).status()).toBe(409); // r_002 is the test example the runs scored
    // The run list pages and filters by task.
    const list = (await (await req.get(`${API}/orgs/${s.orgId}/runs?taskId=${s.taskId}&limit=1`)).json()) as { data: { id: string }[]; meta: { hasMore: boolean } };
    expect(list.data).toHaveLength(1);
    expect(list.meta.hasMore).toBe(true);
    await viewer.ctx.close();
    await stranger.ctx.close();
  });
});
