import { test, expect } from "@playwright/test";
import { signupAndVerify } from "./helpers/signup";
import { resetRateLimits } from "./helpers/rateLimits";
import { API } from "./helpers/workspace";
import { explainIndexed } from "./helpers/db";
import { MODEL_A, answer, createPrompt, createTaskWithExamples, posting, stubReset, stubStats, waitForRun } from "./helpers/runs";

type Interval = { value: number; ci: [number, number] };
type Summary = { data: { stale: { rules: boolean; labels: boolean }; variants: { variantId: string; promptVersion: string; summary: { n: number; metrics: Record<string, Interval | null> } }[] } };

const SALARY = { min: 600000, max: 800000, currency: "INR", period: "year" };
const WRONG_SALARY = { min: 60000, max: 80000, currency: "INR", period: "year" }; // LPA read wrong: out of tolerance

test.describe("Phase 21 — results table, error browser, side-by-side, re-score (real browser)", () => {
  test.beforeEach(async () => {
    await resetRateLimits();
    await stubReset();
  });

  test("table = summary, tag subset, error browser with facets + keyboard, compare with repeats, re-score from the UI", async ({ page }) => {
    test.setTimeout(180_000);
    await signupAndVerify(page);
    const req = page.context().request;
    const ex = [
      { id: "a_001", tags: ["salary_lpa"], input: posting(1, { give: { stipend_or_salary: SALARY } }), expected: answer(1, { stipend_or_salary: SALARY }) },
      { id: "a_002", tags: ["salary_lpa"], input: posting(2, { give: { stipend_or_salary: WRONG_SALARY } }), expected: answer(2, { stipend_or_salary: SALARY }) },
      { id: "a_003", tags: ["other"], input: posting(3, { mode: "prose" }), expected: answer(3) },
      { id: "a_004", tags: ["other"], input: posting(4, { mode: "alt" }), expected: answer(4) },
    ];
    const s = await createTaskWithExamples(req, ex.map((e) => ({ id: e.id, input: e.input, expected: e.expected })));
    for (const e of ex) expect((await req.patch(`${s.T}/examples/${s.exampleIds[e.id]}`, { data: { tags: e.tags } })).status()).toBe(200);
    const v1 = await createPrompt(req, s.T, "v1-zero-shot", "Posting:\n{{input}}");
    // v2's template carries a PATCH marker: the stub answers location "Mumbai" for it, so the two prompts differ on one field.
    const v2 = await createPrompt(req, s.T, "v2-mumbai", 'Posting:\n{{input}}\n<<PATCH {"location":"Mumbai"} >>');
    const created = await req.post(`${API}/orgs/${s.orgId}/runs`, { data: { taskId: s.taskId, promptVersionIds: [v1, v2], modelKeys: [MODEL_A], split: "dev", repeats: 3 } });
    expect(created.status()).toBe(201);
    const runId = ((await created.json()) as { data: { id: string } }).data.id;
    await waitForRun(req, s.orgId, runId, (r) => r.status === "completed");

    const summary = async (tag = "") => (await (await req.get(`${API}/orgs/${s.orgId}/runs/${runId}/summary${tag ? `?tag=${tag}` : ""}`)).json()) as Summary;
    const all = await summary();
    const V1 = all.data.variants.find((v) => v.promptVersion === "v1-zero-shot@1")!;
    const V2 = all.data.variants.find((v) => v.promptVersion === "v2-mumbai@1")!;

    // ── 1. Every number in the table equals the summary; hover shows interval + n; overlap dims the bold ──
    await page.goto(`/runs/${runId}`);
    await expect(page.getByTestId("results-table")).toBeVisible({ timeout: 30_000 });
    for (const v of [V1, V2]) {
      for (const [col, key] of [["overall", "overall"], ["field_stipend_or_salary", "stipend_or_salary"], ["valid_json", "valid_json"], ["field_location", "location"]] as const) {
        const cell = page.getByTestId(`cell-${col}-${v.variantId}`);
        expect(Number(await cell.getAttribute("data-value"))).toBeCloseTo(v.summary.metrics[key]!.value, 10);
      }
    }
    await expect(page.getByTestId(`cell-overall-${V1.variantId}`)).toHaveAttribute("title", /\(.+–.+, n=\d+\)/);
    const [a, b] = [V1.summary.metrics.overall!, V2.summary.metrics.overall!];
    const [hi, lo] = a.value > b.value ? [a, b] : [b, a];
    const winner = a.value > b.value ? V1 : V2;
    await expect(page.getByTestId(`cell-overall-${winner.variantId}`)).toHaveAttribute("data-best", lo.ci[1] >= hi.ci[0] ? "best-unclear" : "best");
    // Location: v1 always right, v2 always "Mumbai": 1 vs 0, the intervals don't overlap, so a clear bold.
    await expect(page.getByTestId(`cell-field_location-${V1.variantId}`)).toHaveAttribute("data-best", "best");
    await expect(page.getByTestId("run-meta")).toContainText("prices checked");
    // Sorting is client-side: sort by location descending puts v1 first.
    // Numeric columns sort descending first (TanStack's default for non-strings); the second click flips to ascending.
    await page.getByTestId("sort-field_location").click();
    await expect(page.getByTestId("sort-field_location")).toContainText("▼");
    await expect(page.locator("[data-testid^=result-row-]").first()).toHaveAttribute("data-testid", `result-row-${V1.variantId}`);
    await page.getByTestId("sort-field_location").click();
    await expect(page.getByTestId("sort-field_location")).toContainText("▲");
    await expect(page.locator("[data-testid^=result-row-]").first()).toHaveAttribute("data-testid", `result-row-${V2.variantId}`);

    // ── 2. A tag subset: n drops, salary changes, back to the full table without the tag ──
    await page.getByTestId("tag-filter").selectOption("salary_lpa");
    await expect(page).toHaveURL(/tag=salary_lpa/);
    const sub = (await summary("salary_lpa")).data.variants.find((v) => v.variantId === V1.variantId)!;
    await expect(page.getByTestId(`cell-n-${V1.variantId}`)).toHaveText(String(sub.summary.n));
    expect(sub.summary.n).toBe(2);
    await expect.poll(async () => Number(await page.getByTestId(`cell-field_stipend_or_salary-${V1.variantId}`).getAttribute("data-value"))).toBeCloseTo(sub.summary.metrics.stipend_or_salary!.value, 10);
    await page.getByTestId("tag-filter").selectOption("");
    await expect(page.getByTestId(`cell-n-${V1.variantId}`)).toHaveText(String(V1.summary.n));

    // ── 3. Salary cell → failing results worst first; chip counts sum to the list; a chip filters; reload keeps it ──
    await page.getByTestId(`field-link-stipend_or_salary-${V1.variantId}`).click();
    await expect(page).toHaveURL(new RegExp(`/runs/${runId}/errors\\?.*field=stipend_or_salary`));
    await expect(page.getByTestId("result-card").first()).toBeVisible();
    const cards = await page.getByTestId("result-card").count();
    const chips = page.locator("[data-testid^=reason-chip-]");
    let sum = 0;
    for (let i = 0; i < (await chips.count()); i++) sum += Number(await chips.nth(i).getAttribute("data-count"));
    expect(sum).toBe(cards);
    await expect(page.getByTestId("reason-chip-out_of_tolerance")).toHaveAttribute("data-count", "3");
    await page.getByTestId("reason-chip-out_of_tolerance").click();
    await expect(page).toHaveURL(/reason=out_of_tolerance/);
    await expect(page.getByTestId("result-card")).toHaveCount(3);
    await page.reload();
    await expect(page.getByTestId("result-card")).toHaveCount(3);
    for (const ref of await page.getByTestId("result-card").evaluateAll((els) => els.map((e) => e.getAttribute("data-ref")))) expect(ref).toBe("a_002");
    // Normalised values + reason on the salary row.
    await expect(page.getByTestId("field-row-stipend_or_salary").first().getByTestId("field-reason")).toHaveText("out_of_tolerance");

    // ── 4 + 5. Worst first (prose = 0 first); j j k o shows the verbatim raw output; typing never moves; c compares ──
    await page.goto(`/runs/${runId}/errors?variant=${V1.variantId}&failedOnly=true`);
    await expect(page.getByTestId("result-card").first()).toHaveAttribute("data-ref", "a_003");
    const list = page.getByTestId("error-list");
    await page.locator("body").press("j");
    await page.locator("body").press("j");
    await page.locator("body").press("k");
    await expect(list).toHaveAttribute("data-active-index", "1");
    await expect(page.getByTestId("result-card").nth(1)).toHaveAttribute("aria-current", "true");
    await page.locator("body").press("o");
    const card = page.getByTestId("result-card").nth(1);
    await expect(card.getByTestId("raw-output")).toContainText("Sure! Here is the extraction:");
    await expect(card.getByTestId("card-valid-json")).toContainText("false");
    await page.getByTestId("filter-tag-input").click();
    await page.keyboard.type("jjj");
    await expect(list).toHaveAttribute("data-active-index", "1");
    await page.getByTestId("filter-tag-input").blur();
    await page.locator("body").press("c");
    await expect(page).toHaveURL(new RegExp(`/runs/${runId}/compare\\?example=a_003&a=${V1.variantId}&b=${V2.variantId}`));

    // ── 6. Compare v1 vs v2 on a_004: location differs; 3 repeats show the inconsistent "remote" ──
    await page.goto(`/runs/${runId}/compare?example=a_004&a=${V1.variantId}&b=${V2.variantId}`);
    await expect(page.getByTestId("diff-row-location")).toHaveAttribute("data-differs", "true");
    await expect(page.getByTestId("diff-row-title")).toHaveAttribute("data-differs", "false");
    await expect(page.getByTestId("repeat-tabs")).toBeVisible();
    await expect(page.getByTestId("inconsistent-fields")).toContainText("remote");
    const remotes = new Set<string>();
    for (let i = 0; i < 3; i++) {
      await page.getByTestId(`repeat-tab-${i}`).click();
      remotes.add((await page.getByTestId("diff-row-remote").locator("td").nth(2).textContent()) ?? "");
    }
    expect(remotes.size).toBe(2);

    // ── 7. Edit a label → stale banner → Re-score from the UI: no model calls, banner gone, salary moves, notes record it ──
    const salaryBefore = V1.summary.metrics.stipend_or_salary!.value;
    const callsBefore = (await stubStats()).calls;
    expect((await req.patch(`${s.T}/examples/${s.exampleIds["a_002"]}`, { data: { expected: answer(2, { stipend_or_salary: WRONG_SALARY }) } })).status()).toBe(200);
    await page.goto(`/runs/${runId}`);
    await expect(page.getByTestId("stale-banner")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("rescore").click();
    await expect(page.getByTestId("stale-banner")).toBeHidden({ timeout: 30_000 }); // the worker's `rescored` SSE message reloads the summary
    await expect(page.getByTestId("run-notes")).toContainText(/re-scored \d{4}-\d{2}-\d{2} with task v1; changed: a_002/);
    const salaryAfter = (await summary()).data.variants.find((v) => v.variantId === V1.variantId)!.summary.metrics.stipend_or_salary!.value;
    expect(salaryAfter).toBeGreaterThan(salaryBefore);
    expect(Number(await page.getByTestId(`cell-field_stipend_or_salary-${V1.variantId}`).getAttribute("data-value"))).toBeCloseTo(salaryAfter, 10);
    expect((await stubStats()).calls).toBe(callsBefore);

    // ── 8. The feed's query can be served by the (run, variant, score) index ──
    const plan = await explainIndexed(`SELECT id FROM results WHERE run_id = '${runId}' AND variant_id = '${V1.variantId}' ORDER BY overall_score ASC NULLS FIRST, id ASC LIMIT 21`);
    expect(plan).toContain("results_run_id_variant_id_overall_score_idx");
  });
});
