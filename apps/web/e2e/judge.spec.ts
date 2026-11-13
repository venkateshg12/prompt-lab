import { test, expect } from "@playwright/test";
import { signupAndVerify } from "./helpers/signup";
import { resetRateLimits } from "./helpers/rateLimits";
import { API } from "./helpers/workspace";
import { sql } from "./helpers/db";
import { MODEL_A, MODEL_B, answer, createPrompt, createTaskWithExamples, posting, stubReset, stubStats, waitForRun } from "./helpers/runs";

type Summary = { data: {
  variants: { variantId: string; promptVersion: string; modelLabel: string; summary: { costUsdPer100: number; metrics: Record<string, { value: number } | null> } }[];
  judge: null | { byVariant: Record<string, { judged: number; passed: number; errors: number }>; validation: { n: number; agreement: number | null; kappa: number | null; validated: boolean } };
} };

// 31 postings: every 5th the judge fails, one answer the judge garbles (→ judge_error, never a guess).
const verdict = (i: number) => (i === 7 ? "garbage" : i % 5 === 0 ? "fail" : "pass");

test.describe("Phase 26 — validated LLM judge and cost/accuracy charts", () => {
  test.beforeEach(async () => {
    await resetRateLimits();
    await stubReset();
  });

  test("a different-family judge, stored apart, validated by human labels; charts from the summaries", async ({ page }) => {
    test.setTimeout(240_000);
    await signupAndVerify(page);
    const req = page.context().request;
    const s = await createTaskWithExamples(req, Array.from({ length: 31 }, (_, i) => ({
      id: `j_${String(i).padStart(3, "0")}`, input: `${posting(i)}\n<<JUDGE ${verdict(i)} >>`, expected: answer(i),
    })));
    const v1 = await createPrompt(req, s.T, "v1-zero-shot", "Posting:\n{{input}}");
    const created = await req.post(`${API}/orgs/${s.orgId}/runs`, { data: { taskId: s.taskId, promptVersionIds: [v1], modelKeys: [MODEL_A], split: "dev", repeats: 1 } });
    const runId = ((await created.json()) as { data: { id: string } }).data.id;
    await waitForRun(req, s.orgId, runId, (r) => r.status === "completed", 120_000);
    const R = `${API}/orgs/${s.orgId}/runs/${runId}`;
    const summary = async () => (await (await req.get(`${R}/summary`)).json()) as Summary;
    const storedBefore = await sql("select id, summary::text as s from run_variants where run_id = $1 order by id", [runId]);
    const overallBefore = await sql("select id, overall_score from results where run_id = $1 order by id", [runId]);

    // A judge from the SAME family as a judged model is refused.
    const same = await req.post(`${R}/judge`, { data: { modelKey: MODEL_A } });
    expect(same.status()).toBe(422);
    expect(((await same.json()) as { errors: { code: string }[] }).errors[0]!.code).toBe("JUDGE_SAME_FAMILY");

    // Start from the UI with a different family; every scored result gets one verdict.
    await page.goto(`/runs/${runId}`);
    await page.getByTestId("judge-model").selectOption(MODEL_B);
    await page.getByTestId("judge-start").click();
    await expect(page.getByTestId("judge-msg")).toHaveText("Judging 31 results…");
    await expect.poll(async () => {
      const j = (await summary()).data.judge;
      return j ? Object.values(j.byVariant).reduce((n, v) => n + v.judged + v.errors, 0) : 0;
    }, { timeout: 60_000 }).toBe(31);
    const j = (await summary()).data.judge!;
    const stats = Object.values(j.byVariant)[0]!;
    expect(stats).toEqual({ judged: 30, passed: 23, errors: 1 }); // j_000, j_005 … j_030 fail (7), j_007 garbled
    const garbage = await sql("select judge from results r join examples e on e.id = r.example_id where r.run_id = $1 and e.ref = 'j_007'", [runId]);
    expect(garbage[0]!.judge).toMatchObject({ status: "judge_error", pass: null, raw: "I think it is probably fine?" });

    // Scores untouched: every result's overall and every stored summary byte-identical.
    expect(await sql("select id, overall_score from results where run_id = $1 order by id", [runId])).toEqual(overallBefore);
    expect(await sql("select id, summary::text as s from run_variants where run_id = $1 order by id", [runId])).toEqual(storedBefore);

    // Posting the same judge again adds no job and no call (deterministic job ids).
    const calls = (await stubStats()).calls;
    expect((await req.post(`${R}/judge`, { data: { modelKey: MODEL_B } })).status()).toBe(200);
    await page.waitForTimeout(1500);
    expect((await stubStats()).calls).toBe(calls);

    // Not validated yet: the column is dimmed and the card says why, from the data.
    await page.reload();
    const variantId = Object.keys(j.byVariant)[0]!;
    await expect(page.getByTestId("judge-validation")).toHaveAttribute("data-validated", "false");
    await expect(page.getByTestId("judge-validation")).toContainText("n 0");
    await expect(page.getByTestId(`cell-judge-${variantId}`)).toHaveText("76.7 % *");

    // Human labels: 3 in the UI, the rest through the API, agreeing with the judge → agreement 1, κ 1, n 30.
    const items = page.getByTestId("judge-item");
    await expect(items.first()).toBeVisible();
    for (let k = 0; k < 3; k++) {
      const item = items.first();
      const isPass = (await item.textContent())!.includes("judge: pass");
      await item.getByTestId(isPass ? "human-pass" : "human-fail").click();
      await expect(page.getByTestId("judge-validation")).toContainText(`n ${k + 1}`);
    }
    const list = ((await (await req.get(`${R}/judge?unlabelledOnly=true&limit=200`)).json()) as { data: { resultId: string; judge: { status: string; pass: boolean | null } }[] }).data;
    for (const r of list.filter((x) => x.judge.status === "ok")) {
      expect((await req.patch(`${R}/judge/${r.resultId}/human`, { data: { pass: r.judge.pass } })).status()).toBe(200);
    }
    const validation = (await (await req.get(`${R}/judge/validation`)).json()) as { data: { n: number; agreement: number; kappa: number; validated: boolean } };
    expect(validation.data).toEqual({ n: 30, agreement: 1, kappa: 1, validated: true });
    await page.reload();
    await expect(page.getByTestId("judge-validation")).toHaveText("Validated: agreement 100.0 %, κ 1.00, n 30");
    await expect(page.getByTestId(`cell-judge-${variantId}`)).toHaveText("76.7 %");

    // Charts: one point per scored row; the front is paretoFront over the table's numbers.
    await expect(page.getByTestId("cost-accuracy-chart")).toBeVisible();
    await expect(page.getByTestId("field-bars")).toBeVisible();
    const sv = (await summary()).data.variants[0]!;
    await expect(page.getByTestId("pareto-front")).toHaveText(`Front: ${sv.promptVersion} · ${sv.modelLabel}`);
    await expect(page.getByTestId("cost-accuracy-chart").locator("svg").first()).toBeVisible();
    // Kept for a human look at the rendered charts (test-results/, not committed).
    await page.getByTestId("cost-accuracy-chart").screenshot({ path: test.info().outputPath("cost-accuracy.png") });
    await page.getByTestId("field-bars").screenshot({ path: test.info().outputPath("field-bars.png") });
  });
});
