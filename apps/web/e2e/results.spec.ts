import { test, expect } from "@playwright/test";
import { signupAndVerify } from "./helpers/signup";
import { resetRateLimits } from "./helpers/rateLimits";
import { API, addToWorkspace, newMember } from "./helpers/workspace";
import { sql } from "./helpers/db";
import { MODEL_A, answer, createPrompt, createTaskWithExamples, posting, stubReset, stubStats, waitForRun } from "./helpers/runs";

// Wilson 95 % interval, the same formula as the Playbook's stats.ts.
const wilson = (k: number, n: number, z = 1.96): [number, number] => {
  const p = k / n;
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
};

type Interval = { value: number; ci: [number, number] };
type Summary = {
  data: {
    tag: string | null;
    stale: { rules: boolean; labels: boolean };
    variants: { variantId: string; promptVersion: string; modelKey: string; price: unknown; summary: {
      n: number; repeats: number; scored: number; errors: number; skipped: number; errorRate: number; costUsdPer100: number | null;
      p50Ms: number | null; p95Ms: number | null; repeatSpread: { min: number; max: number } | null;
      metrics: Record<string, Interval | null>;
    } }[];
  };
};

const labelled = (n: number, tags: string[], opts: Parameters<typeof posting>[1] = {}) => ({
  id: `a_${String(n).padStart(3, "0")}`, input: posting(n, opts), expected: answer(n), tags,
});

test.describe("Phase 18 — aggregation, intervals, subsets, error browser, re-scoring", () => {
  test.beforeEach(async () => {
    await resetRateLimits();
    await stubReset();
  });

  test("a 3-repeat run aggregates exactly: rates, intervals, consistency, cost, errors apart; subsets; feed; stale → rescore", async ({ page, browser }) => {
    await signupAndVerify(page);
    const req = page.context().request;
    const examples = [
      labelled(1, ["tag_a"]), // perfect
      labelled(2, ["tag_a"], { give: { remote: "hybrid" } }), // wrong remote: 0.875
      labelled(3, ["tag_b"], { mode: "prose" }), // invalid JSON: 0, and 'inconsistent' (each invalid repeat is its own answer)
      labelled(4, ["tag_b"], { mode: "fence" }), // fenced: 1
      labelled(5, ["tag_b"], { mode: "400" }), // an error cell every time
    ];
    // Tags are part of the case line; the helper in runs.ts doesn't pass them, so import with tags here.
    const s = await createTaskWithExamples(req, examples.map((e) => ({ id: e.id, input: e.input, expected: e.expected })));
    for (const e of examples) {
      expect((await req.patch(`${s.T}/examples/${s.exampleIds[e.id]}`, { data: { tags: e.tags } })).status()).toBe(200);
    }
    const prompt = await createPrompt(req, s.T, "v1-zero-shot", "Posting:\n{{input}}");
    const created = await req.post(`${API}/orgs/${s.orgId}/runs`, { data: { taskId: s.taskId, promptVersionIds: [prompt], modelKeys: [MODEL_A], split: "dev", repeats: 3 } });
    expect(created.status()).toBe(201);
    const runId = ((await created.json()) as { data: { id: string } }).data.id;
    const final = await waitForRun(req, s.orgId, runId, (r) => r.status === "completed");
    expect(final).toMatchObject({ totalCells: 15, doneCells: 15, errorCells: 3 });

    const summaryUrl = (q = "") => `${API}/orgs/${s.orgId}/runs/${runId}/summary${q}`;
    const get = async (q = "") => (await (await req.get(summaryUrl(q))).json()) as Summary;

    // ── The whole set, by hand ──
    const all = await get();
    expect(all.data.stale).toEqual({ rules: false, labels: false });
    const v = all.data.variants[0]!;
    expect(v).toMatchObject({ promptVersion: "v1-zero-shot@1", modelKey: MODEL_A });
    expect(v.price).toMatchObject({ inputUsdMicrosPerMTok: 50000, outputUsdMicrosPerMTok: 200000 });
    expect(v.summary).toMatchObject({ n: 4, repeats: 3, scored: 12, errors: 3, skipped: 0 });
    expect(v.summary.errorRate).toBeCloseTo(3 / 15); // > 5 %: the UI will badge it
    const m = v.summary.metrics;
    expect(m.overall!.value).toBeCloseTo((1 + 0.875 + 0 + 1) / 4, 10); // errors are NOT zeros
    expect(m.valid_json!.value).toBeCloseTo(9 / 12, 10);
    expect(m.exact_match!.value).toBeCloseTo(6 / 12, 10);
    expect(m.remote!.value).toBeCloseTo(6 / 12, 10); // a1,a4 right; a2 mismatch; a3 missing
    expect(m.title!.value).toBeCloseTo(9 / 12, 10);
    expect(m.skills_precision!.value).toBeCloseTo(1, 10); // only the 9 valid results carry skills detail
    expect(m.skills_recall!.value).toBeCloseTo(1, 10);
    // Consistency: a3's three repeats are three different "invalid" answers; the other three examples repeat exactly.
    expect(m.consistency!.value).toBeCloseTo(3 / 4, 10);
    expect(v.summary.repeatSpread!.min).toBeCloseTo((1 + 0.875 + 0 + 1) / 4, 10);
    // Intervals: Wilson for a 0/1 series, a seeded bootstrap otherwise (identical on every request).
    const [lo, hi] = wilson(9, 12);
    expect(m.valid_json!.ci[0]).toBeCloseTo(lo, 10);
    expect(m.valid_json!.ci[1]).toBeCloseTo(hi, 10);
    expect(m.overall!.ci[0]).toBeLessThan(m.overall!.value);
    expect(m.overall!.ci[1]).toBeGreaterThan(m.overall!.value);
    expect(JSON.stringify((await get()).data.variants[0]!.summary)).toBe(JSON.stringify(v.summary));

    // Cost per 100 inputs from the stored integer micro-dollars, p50/p95 over scored calls only.
    const [agg] = await sql("select sum(cost_usd_micros)::float / count(*) / 1000000 * 100 as per100, count(*)::int as n from results where run_id = $1 and status = 'scored'", [runId]);
    expect(agg!.n).toBe(12);
    expect(v.summary.costUsdPer100).toBeCloseTo(agg!.per100, 10);
    expect(v.summary.p95Ms).toBeGreaterThanOrEqual(v.summary.p50Ms!);

    // finalize stored exactly what the endpoint serves.
    const [stored] = await sql("select summary from run_variants where run_id = $1", [runId]);
    expect(stored!.summary.metrics.overall.value).toBeCloseTo(m.overall!.value, 10);

    // ── Subsets: computed per tag, smaller n, same definitions ──
    const a = (await get("?tag=tag_a")).data.variants[0]!.summary;
    expect(a).toMatchObject({ n: 2, scored: 6, errors: 0 });
    expect(a.metrics.overall!.value).toBeCloseTo((1 + 0.875) / 2, 10);
    const b = (await get("?tag=tag_b")).data.variants[0]!.summary;
    expect(b).toMatchObject({ n: 2, scored: 6, errors: 3 });
    expect(b.metrics.overall!.value).toBeCloseTo((0 + 1) / 2, 10);
    expect((await req.get(summaryUrl("?tag=NOT%20A%20TAG"))).status()).toBe(400);

    // ── The error browser's feed: worst first, filterable, keyset-paged ──
    const feed = async (q: string) => (await (await req.get(`${API}/orgs/${s.orgId}/runs/${runId}/results?${q}`)).json()) as {
      data: { exampleRef: string; status: string; overallScore: number | null; fieldScores: { key: string; reason: string }[] | null }[];
      meta: { hasMore: boolean; nextCursor: string | null };
    };
    const failed = await feed("failedOnly=true&limit=100");
    expect(failed.data).toHaveLength(9); // a5 ×3 errors, a3 ×3 invalid, a2 ×3 wrong remote
    expect(failed.data.slice(0, 3).every((r) => r.status === "error")).toBe(true);
    expect(failed.data.slice(3, 6).every((r) => r.exampleRef === "a_003")).toBe(true);
    expect(failed.data.slice(6).every((r) => r.exampleRef === "a_002")).toBe(true);
    const seen: string[] = [];
    let cursor = "";
    for (let page_ = 0; page_ < 10; page_++) {
      const p = await feed(`failedOnly=true&limit=2${cursor}`);
      seen.push(...p.data.map((r) => `${r.exampleRef}/${r.status}`));
      if (!p.meta.hasMore) break;
      cursor = `&cursor=${p.meta.nextCursor}`;
    }
    expect(seen).toHaveLength(9);
    expect(new Set(seen.map((x, i) => `${x}#${i}`)).size).toBe(9); // no page overlap or gap
    expect(seen.map((x) => x.split("/")[0])).toEqual(failed.data.map((r) => r.exampleRef)); // same order as one big page
    const mismatch = await feed("field=remote&reason=mismatch&limit=100");
    expect(mismatch.data.map((r) => r.exampleRef)).toEqual(["a_002", "a_002", "a_002"]);
    const missing = await feed("field=remote&reason=missing&limit=100");
    expect(new Set(missing.data.map((r) => r.exampleRef))).toEqual(new Set(["a_003"]));
    expect((await feed("field=remote&limit=100")).data).toHaveLength(6); // any remote score < 1: a2 and a3, three repeats each

    // ── Stale labels → rescore from stored outputs, with no model calls ──
    const callsBefore = (await stubStats()).calls;
    // The owner decides the model was right about a_002: the label changes, so the stored scores are stale.
    expect((await req.patch(`${s.T}/examples/${s.exampleIds["a_002"]}`, { data: { expected: answer(2, { remote: "hybrid" }) } })).status()).toBe(200);
    expect((await get()).data.stale).toEqual({ rules: false, labels: true });
    const queued = await req.post(`${API}/orgs/${s.orgId}/runs/${runId}/rescore`);
    expect(queued.status()).toBe(200);
    const deadline = Date.now() + 30_000;
    while ((await get()).data.stale.labels && Date.now() < deadline) await page.waitForTimeout(250);
    const after = await get();
    expect(after.data.stale).toEqual({ rules: false, labels: false });
    expect(after.data.variants[0]!.summary.metrics.overall!.value).toBeCloseTo((1 + 1 + 0 + 1) / 4, 10); // a2 now scores 1
    expect(after.data.variants[0]!.summary.metrics.exact_match!.value).toBeCloseTo(9 / 12, 10);
    expect((await stubStats()).calls).toBe(callsBefore); // re-scoring is free: not one model call

    // A rules change (a new synonym) bumps the task version and flags the run; rescore clears it.
    const task = (await (await req.get(s.T)).json()) as { data: { task: { fields: { kind: string; key: string; synonyms?: Record<string, string> }[] } } };
    const fields = task.data.task.fields.map((f) => (f.key === "skills" ? { ...f, synonyms: { ...f.synonyms, tf: "tensorflow" } } : f));
    const patched = (await (await req.patch(s.T, { data: { fields } })).json()) as { data: { version: number; runsAffected: number } };
    expect(patched.data).toMatchObject({ version: 2, runsAffected: 1 });
    expect((await get()).data.stale.rules).toBe(true);
    expect((await req.post(`${API}/orgs/${s.orgId}/runs/${runId}/rescore`)).status()).toBe(200);
    while ((await get()).data.stale.rules && Date.now() < deadline + 30_000) await page.waitForTimeout(250);
    expect((await get()).data.stale).toEqual({ rules: false, labels: false });
    expect((await sql("select task_version from runs where id = $1", [runId]))[0]!.task_version).toBe(2);

    // ── Roles ──
    const viewer = await newMember(browser);
    await addToWorkspace(req, s.orgId, viewer, "viewer");
    expect((await viewer.request.get(summaryUrl())).status()).toBe(200);
    expect((await viewer.request.get(`${API}/orgs/${s.orgId}/runs/${runId}/results`)).status()).toBe(200);
    expect((await viewer.request.post(`${API}/orgs/${s.orgId}/runs/${runId}/rescore`)).status()).toBe(403);
    const stranger = await newMember(browser);
    expect((await stranger.request.get(summaryUrl())).status()).toBe(404);
    expect((await stranger.request.get(`${API}/orgs/${s.orgId}/runs/${runId}/results`)).status()).toBe(404);
    await viewer.ctx.close();
    await stranger.ctx.close();
  });
});
