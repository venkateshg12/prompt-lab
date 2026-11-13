import { test, expect, type Page } from "@playwright/test";
import { signupAndVerify } from "./helpers/signup";
import { resetRateLimits } from "./helpers/rateLimits";
import { API } from "./helpers/workspace";
import { sql } from "./helpers/db";
import { MODEL_A, MODEL_B, createPrompt, createTaskWithExamples, posting, stubReset, waitForRun, answer, type RunDto } from "./helpers/runs";

const dev = (n: number, mode?: string) => ({ id: `l_${String(n).padStart(3, "0")}`, split: "dev" as const, input: posting(n, { mode }), expected: answer(n) });
const test_ = (n: number) => ({ id: `l_${String(n).padStart(3, "0")}`, split: "test" as const, input: posting(n), expected: answer(n) });

const openLauncher = async (page: Page, taskId: string) => {
  await page.goto(`/tasks/${taskId}?tab=runs`);
  await page.getByTestId("new-run").click();
  await expect(page.getByTestId("run-launcher")).toBeVisible();
};

test.describe("Phase 20 — run launcher and live progress (real browser, queue, worker, scorer, SSE)", () => {
  test.beforeEach(async () => {
    await resetRateLimits();
    await stubReset();
  });

  test("grid + dated server estimate + skipped cells, live progress over ONE stream, lists", async ({ page }) => {
    await signupAndVerify(page);
    const req = page.context().request;
    // 4 dev postings that answer after 400 ms, so the bar is observably in motion; 2 test postings.
    const s = await createTaskWithExamples(req, [dev(1, "slow"), dev(2, "slow"), dev(3, "slow"), dev(4, "slow"), test_(5), test_(6)]);
    await createPrompt(req, s.T, "v1-zero-shot", "Posting:\n{{input}}");
    await createPrompt(req, s.T, "v4-structured", "Posting:\n{{input}}", "structured");
    // A at supported, B at unsupported: the structured prompt on B is the skipped part of the grid.
    const before = await sql("select key, structured from models where key in ($1, $2)", [MODEL_A, MODEL_B]);
    await sql("update models set structured = 'supported' where key = $1", [MODEL_A]);
    await sql("update models set structured = 'unsupported' where key = $1", [MODEL_B]);

    try {
      await openLauncher(page, s.taskId);
      // Nothing chosen: Start is disabled with the reason.
      await expect(page.getByTestId("start-run")).toBeDisabled();
      await expect(page.getByTestId("start-blocked")).toContainText("Pick at least one prompt and one model");

      await page.getByTestId("pick-prompt-v1-zero-shot").check();
      await page.getByTestId("pick-prompt-v4-structured").check();
      await page.getByTestId(`pick-model-${MODEL_A}`).check();
      await page.getByTestId(`pick-model-${MODEL_B}`).check();

      // 2 prompts × 2 models × 4 dev × 1 = 16 calls, 4 of them skipped (v4 × the unsupported model).
      await expect(page.getByTestId("grid-calls")).toHaveText("16 calls");
      await expect(page.getByTestId("grid-skipped")).toContainText("4 skipped");
      await expect(page.getByTestId("estimate-dates")).toContainText("prices checked");
      await expect(page.getByTestId("estimate-usd")).toHaveText(/^\$\d/);
      await expect(page.getByTestId("start-run")).toBeEnabled();

      // The same numbers from the API directly (the UI shows the server's estimate, it does not compute one).
      const body = { taskId: s.taskId, promptVersionIds: [] as string[], modelKeys: [MODEL_A, MODEL_B], split: "dev", repeats: 1 };
      const prompts = ((await (await req.get(`${s.T}/prompts`)).json()) as { data: { id: string }[] }).data;
      body.promptVersionIds = prompts.map((p) => p.id);
      const est = ((await (await req.post(`${API}/orgs/${s.orgId}/runs/estimate`, { data: body })).json()) as {
        data: { totalCells: number; cells: number; skippedCells: number; totalUsdMicros: number };
      }).data;
      expect(est).toMatchObject({ totalCells: 16, cells: 12, skippedCells: 4 });
      const shown = Number((await page.getByTestId("estimate-usd").innerText()).replace("$", ""));
      expect(shown).toBeCloseTo(est.totalUsdMicros / 1_000_000, 4);

      // Watch the network from here on: ONE event-stream request, and no per-cell polling of GET /runs/:id.
      const streams: string[] = [];
      const detailGets: string[] = [];
      page.on("request", (r) => {
        if (r.resourceType() === "eventsource") streams.push(r.url());
        else if (r.method() === "GET" && /\/runs\/[0-9a-f-]{36}$/.test(r.url())) detailGets.push(r.url());
      });

      await page.getByTestId("start-run").click();
      await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/);
      const runId = page.url().split("/").pop()!;
      await expect(page.getByTestId("run-total")).toHaveText("16");

      // The bar moves: sample the counter until the run is over.
      const seen = new Set<string>();
      await expect
        .poll(async () => {
          seen.add(await page.getByTestId("run-done").innerText());
          return page.getByTestId("run-status").getAttribute("data-status");
        }, { timeout: 60_000, intervals: [100] })
        .toBe("completed");
      await expect(page.getByTestId("run-done")).toHaveText("16");
      expect(seen.size).toBeGreaterThanOrEqual(2);

      // Skipped counter = the 4 skipped cells; 12 scored; the cost ticked up from stored results.
      await expect(page.getByTestId("count-skipped")).toHaveText("4");
      await expect(page.getByTestId("count-scored")).toHaveText("12");
      await expect(page.getByTestId("count-errors")).toHaveText("0");
      const dollars = Number((await page.getByTestId("run-cost").innerText()).replace("$", ""));
      expect(dollars).toBeGreaterThan(0);
      await expect(page.getByTestId(`model-${MODEL_A}`)).toContainText("8 / 8");
      await expect(page.getByTestId(`model-${MODEL_B}`)).toContainText("8 / 8");

      // Counters equal the database; the displayed cost equals SUM(cost_usd_micros).
      const row = (await sql("select done_cells, error_cells, total_cells from runs where id = $1", [runId]))[0]!;
      expect([row.done_cells, row.error_cells, row.total_cells]).toEqual([16, 0, 16]);
      const sum = (await sql("select coalesce(sum(cost_usd_micros), 0)::int as c from results where run_id = $1", [runId]))[0]!.c as number;
      expect(dollars).toBeCloseTo(sum / 1_000_000, 4);
      const db = await sql("select status, count(*)::int as n from results where run_id = $1 group by 1", [runId]);
      expect(Object.fromEntries(db.map((r) => [r.status, r.n]))).toEqual({ scored: 12, skipped: 4 });

      expect(streams).toHaveLength(1);
      expect(detailGets.length).toBeLessThanOrEqual(4); // initial load, one on connect, one on completion, one slack
      await expect(page.getByTestId("run-transport")).toHaveCount(0); // not active any more

      // Lists: the task's tab and the workspace page show it with grid, progress and cost.
      await page.goto(`/tasks/${s.taskId}?tab=runs`);
      const rowTask = page.getByTestId(`run-row-${runId}`);
      await expect(rowTask.getByTestId("run-grid")).toHaveText("2 × 2 × 4 × 1 = 16");
      await expect(rowTask.getByTestId("run-pct")).toHaveText("100%");
      await page.goto("/runs");
      await expect(page.getByTestId(`run-row-${runId}`)).toBeVisible();
      await page.getByTestId(`run-row-${runId}`).getByTestId("run-link").click();
      await expect(page).toHaveURL(new RegExp(`/runs/${runId}$`));
    } finally {
      for (const m of before) await sql("update models set structured = $2 where key = $1", [m.key, m.structured]);
    }
  });

  test("budget blocks Start (UI and API); test split needs intent; test reuse is shown before spending", async ({ page }) => {
    await signupAndVerify(page);
    const req = page.context().request;
    const s = await createTaskWithExamples(req, [dev(1), dev(2), test_(3), test_(4)]);
    const zero = await createPrompt(req, s.T, "v1-zero-shot", "Posting:\n{{input}}");
    const runBody = { taskId: s.taskId, promptVersionIds: [zero], modelKeys: [MODEL_A], split: "dev" };

    // Over budget: the launcher explains and disables Start; the API refuses the same body on its own.
    expect((await req.patch(`${API}/orgs/${s.orgId}`, { data: { monthlyBudgetUsd: 0 } })).status()).toBe(200);
    await openLauncher(page, s.taskId);
    await page.getByTestId("pick-prompt-v1-zero-shot").check();
    await page.getByTestId(`pick-model-${MODEL_A}`).check();
    await expect(page.getByTestId("over-budget")).toContainText("Estimate exceeds the");
    await expect(page.getByTestId("start-run")).toBeDisabled();
    await expect(page.getByTestId("start-blocked")).toContainText("Estimate exceeds");
    expect((await req.post(`${API}/orgs/${s.orgId}/runs`, { data: runBody })).status()).toBe(402);
    expect((await sql("select count(*)::int as n from runs where task_id = $1", [s.taskId]))[0]!.n).toBe(0);

    // Budget restored: Start works again, then switch to test.
    expect((await req.patch(`${API}/orgs/${s.orgId}`, { data: { monthlyBudgetUsd: 20 } })).status()).toBe(200);
    await page.reload();
    await page.getByTestId("new-run").click();
    await page.getByTestId("pick-prompt-v1-zero-shot").check();
    await page.getByTestId(`pick-model-${MODEL_A}`).check();
    await expect(page.getByTestId("start-run")).toBeEnabled();

    // Test split without "final run": Start disabled; the API says 400 for confirmFinal false.
    await page.getByTestId("split-test").check();
    await expect(page.getByTestId("test-callout")).toBeVisible();
    await expect(page.getByTestId("test-reused-warning")).toHaveCount(0); // first use of the test set
    await expect(page.getByTestId("start-run")).toBeDisabled();
    await expect(page.getByTestId("start-blocked")).toContainText("final run");
    expect((await req.post(`${API}/orgs/${s.orgId}/runs`, { data: { ...runBody, split: "test", confirmFinal: false } })).status()).toBe(400);

    // Intent given: the first test run starts and finishes, not reused.
    await page.getByTestId("final-run").check();
    await expect(page.getByTestId("start-run")).toBeEnabled();
    await page.getByTestId("start-run").click();
    await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/);
    const first = page.url().split("/").pop()!;
    await expect(page.getByTestId("run-status")).toHaveAttribute("data-status", "completed", { timeout: 60_000 });
    await expect(page.getByTestId("test-reused-badge")).toHaveCount(0);

    // Using the test set again: the callout warns BEFORE anything is spent, and the run is marked reused.
    await openLauncher(page, s.taskId);
    await page.getByTestId("pick-prompt-v1-zero-shot").check();
    await page.getByTestId(`pick-model-${MODEL_A}`).check();
    await page.getByTestId("split-test").check();
    await expect(page.getByTestId("test-reused-warning")).toContainText("test reused");
    await page.getByTestId("final-run").check();
    await page.getByTestId("start-run").click();
    await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/);
    const second = page.url().split("/").pop()!;
    expect(second).not.toBe(first);
    await expect(page.getByTestId("test-reused-badge")).toBeVisible();
    expect((await sql("select test_reused from runs where id = $1", [second]))[0]!.test_reused).toBe(true);
    expect((await sql("select test_reused from runs where id = $1", [first]))[0]!.test_reused).toBe(false);
  });

  test("cancel with confirmation: finished cells kept, the rest skipped, nothing new afterwards", async ({ page }) => {
    await signupAndVerify(page);
    const req = page.context().request;
    const many = Array.from({ length: 50 }, (_, i) => dev(i + 1, "slow")); // above the 40/min per-model budget: the rest WAITS, so there is something to cancel
    const s = await createTaskWithExamples(req, [...many, test_(100)]);
    await createPrompt(req, s.T, "v1-zero-shot", "Posting:\n{{input}}");

    await openLauncher(page, s.taskId);
    await page.getByTestId("pick-prompt-v1-zero-shot").check();
    await page.getByTestId(`pick-model-${MODEL_A}`).check();
    await expect(page.getByTestId("grid-calls")).toHaveText("50 calls");
    await page.getByTestId("start-run").click();
    await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/);
    const runId = page.url().split("/").pop()!;

    // Wait for some progress, then cancel through the confirmation.
    await expect.poll(async () => Number(await page.getByTestId("run-done").innerText()), { timeout: 30_000 }).toBeGreaterThan(0);
    await page.getByTestId("cancel-run").click();
    await expect(page.getByText("Cancel this run?")).toBeVisible();
    await page.getByRole("button", { name: "CANCEL RUN", exact: true }).click();

    const run: RunDto = await waitForRun(req, s.orgId, runId, (r) => r.status === "cancelled" && r.doneCells === r.totalCells);
    await expect(page.getByTestId("run-status")).toHaveAttribute("data-status", "cancelled");
    await expect(page.getByTestId("run-done")).toHaveText(String(run.totalCells));
    const skipped = Number(await page.getByTestId("count-skipped").innerText());
    const scored = Number(await page.getByTestId("count-scored").innerText());
    expect(skipped).toBeGreaterThan(0);
    expect(scored).toBeGreaterThan(0);
    expect(scored + skipped).toBe(50);

    // No new Result rows afterwards.
    const count = async () => (await sql("select count(*)::int as n from results where run_id = $1", [runId]))[0]!.n as number;
    const n1 = await count();
    await page.waitForTimeout(2500);
    expect(await count()).toBe(n1);
    // The cancel button is gone and a second cancel is refused by the API.
    await expect(page.getByTestId("cancel-run")).toHaveCount(0);
    expect((await req.post(`${API}/orgs/${s.orgId}/runs/${runId}/cancel`)).status()).toBe(409);
  });
  test("stream down for 10 s -> polling every 3 s; stream back -> live again; counters equal the database", async ({ page }) => {
    await signupAndVerify(page);
    const req = page.context().request;
    // 50 slow cells on one model are paced by the 40/min budget, so the run lasts long enough to cut the stream.
    const s = await createTaskWithExamples(req, Array.from({ length: 50 }, (_, i) => dev(i + 1, "slow")));
    await createPrompt(req, s.T, "v1-zero-shot", "Posting:\n{{input}}");
    await openLauncher(page, s.taskId);
    await page.getByTestId("pick-prompt-v1-zero-shot").check();
    await page.getByTestId(`pick-model-${MODEL_A}`).check();
    await page.getByTestId("start-run").click();
    await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/);
    const runId = page.url().split("/").pop()!;
    await expect(page.getByTestId("run-transport")).toHaveText("live");

    // Cut the stream (as a stopped API would): after the 10 s grace the page polls GET /runs/:id.
    await page.route("**/events", (route) => route.abort());
    await page.reload();
    const polls: number[] = [];
    page.on("request", (r) => { if (r.method() === "GET" && /\/runs\/[0-9a-f-]{36}$/.test(r.url())) polls.push(Date.now()); });
    await expect(page.getByTestId("run-transport")).toHaveText("polling every 3 s", { timeout: 25_000 });
    await expect.poll(() => polls.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(3);

    // Stream back: live again, polling stops, and the numbers equal the database.
    await page.unroute("**/events");
    await expect(page.getByTestId("run-transport")).toHaveText("live", { timeout: 30_000 });
    const afterReconnect = polls.length;
    await page.waitForTimeout(4000);
    expect(polls.length - afterReconnect).toBeLessThanOrEqual(1);
    const row = (await sql("select done_cells, error_cells from runs where id = $1", [runId]))[0]!;
    const ui = Number(await page.getByTestId("run-done").innerText());
    expect(ui).toBeGreaterThanOrEqual(row.done_cells - 2); // the DB may be a message ahead of the throttled stream
    expect(ui).toBeLessThanOrEqual(row.done_cells + 0);
    await req.post(`${API}/orgs/${s.orgId}/runs/${runId}/cancel`); // don't leave 50 paced cells running
  });
});
