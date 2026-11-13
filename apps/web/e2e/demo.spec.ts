import { test, expect, type APIRequestContext } from "@playwright/test";
import { signupAndVerify } from "./helpers/signup";
import { resetRateLimits } from "./helpers/rateLimits";
import { API } from "./helpers/workspace";
import { sql } from "./helpers/db";
import { redisFind } from "./helpers/redisScan";
import { MODEL_A, VISITOR_KEY, answer, createPrompt, createTaskWithExamples, posting, stubReset, stubStats, waitForRun } from "./helpers/runs";

const WRONG_BUT_WELL_SHAPED = "nvapi-not-a-real-key-but-well-shaped-0123";
type DemoBody = { slug: string; promptVersion: string; modelKey: string; exampleRefs: string[] };

const demo = (req: APIRequestContext, body: DemoBody, headers: Record<string, string> = {}) =>
  req.post(`${API}/demo/run`, { data: body, headers });

test.describe("Phase 23 — public demo: bring your own key", () => {
  test.beforeEach(async () => {
    await resetRateLimits();
    await stubReset();
  });

  test("only the visitor's key, only a published run's public dev examples, nothing stored, every failure its own message", async ({ page, browser }) => {
    test.setTimeout(240_000);
    await signupAndVerify(page);
    const req = page.context().request;
    const dev = Array.from({ length: 11 }, (_, i) => ({ id: `d_${String(i + 1).padStart(3, "0")}`, input: posting(i + 1), expected: answer(i + 1) }));
    const s = await createTaskWithExamples(req, [
      ...dev,
      { id: "t_001", split: "test", input: posting(90), expected: answer(90) },
      { id: "p_001", input: posting(91), expected: answer(91) },
    ]);
    expect((await req.patch(`${s.T}/examples/${s.exampleIds["p_001"]}`, { data: { publicInput: false } })).status()).toBe(200);
    const v1 = await createPrompt(req, s.T, "v1-zero-shot", "Posting:\n{{input}}");
    const created = await req.post(`${API}/orgs/${s.orgId}/runs`, { data: { taskId: s.taskId, promptVersionIds: [v1], modelKeys: [MODEL_A], split: "dev", repeats: 1 } });
    const runId = ((await created.json()) as { data: { id: string } }).data.id;
    await waitForRun(req, s.orgId, runId, (r) => r.status === "completed", 120_000);
    // Two failure examples arrive AFTER the run (the owner's run must never hit them): still public dev examples of the task.
    const late = [{ id: "r_410", split: "dev", tags: [], input: posting(92, { mode: "410" }), expected: answer(92) }, { id: "z_429", split: "dev", tags: [], input: posting(93, { mode: "429" }), expected: answer(93) }];
    const imported = await req.post(`${s.T}/examples/import`, { data: { format: "jsonl", content: late.map((e) => JSON.stringify(e)).join("\n"), dryRun: false } });
    expect(imported.status()).toBe(200);
    const slug = ((await (await req.post(`${API}/orgs/${s.orgId}/runs/${runId}/publish`, { data: { title: "Demo source" } })).json()) as { data: { slug: string } }).data.slug;
    const ok: DemoBody = { slug, promptVersion: "v1-zero-shot@1", modelKey: MODEL_A, exampleRefs: ["d_001", "d_002", "d_003", "d_004", "d_005"] };
    const counts = async () => (await sql("select (select count(*) from runs)::int as runs, (select count(*) from results)::int as results"))[0]!;
    const anon = await browser.newContext();
    const A = anon.request;

    // ── 1. No header → 400 DEMO_KEY_MISSING; the server's NVIDIA_API_KEY is set and is never used ──
    await stubReset();
    const missing = await demo(A, ok);
    expect(missing.status()).toBe(400);
    expect(((await missing.json()) as { errors: { code: string }[] }).errors[0]!.code).toBe("DEMO_KEY_MISSING");
    expect((await stubStats()).calls).toBe(0);

    // ── 2. A wrong-shaped key for the model's provider → 400 DEMO_KEY_INVALID, no outbound call ──
    const shape = await demo(A, ok, { "X-Provider-Key": "sk-this-is-an-openai-key-0123456789" });
    expect(shape.status()).toBe(400);
    expect(((await shape.json()) as { errors: { code: string }[] }).errors[0]!.code).toBe("DEMO_KEY_INVALID");
    expect((await stubStats()).calls).toBe(0);

    // ── 3. The visitor's key, 5 examples → scored results; no run, no result, no job, nothing in Redis with the key ──
    const before = await counts();
    const good = await demo(A, ok, { "X-Provider-Key": VISITOR_KEY });
    expect(good.status()).toBe(200);
    expect(good.headers()["cache-control"]).toBe("no-store");
    const body = (await good.json()) as { data: { results: { exampleRef: string; status: string; overallScore: number }[]; summary: { n: number; metrics: { overall: { value: number } } } } };
    expect(body.data.results.map((r) => r.status)).toEqual(["scored", "scored", "scored", "scored", "scored"]);
    expect(body.data.summary.n).toBe(5);
    expect(body.data.summary.metrics.overall.value).toBe(1);
    expect((await stubStats()).byKey).toEqual({ server: 0, visitor: 5, other: 0 });
    expect(await counts()).toEqual(before);
    expect(await redisFind(VISITOR_KEY)).toEqual([]);
    expect(await redisFind(VISITOR_KEY, 6380)).toEqual([]);
    expect(JSON.stringify(body)).not.toContain(VISITOR_KEY);

    // ── 4. A right-shaped key the provider rejects → 401 with the fixed message, nothing of the provider's body ──
    const rejected = await demo(A, ok, { "X-Provider-Key": WRONG_BUT_WELL_SHAPED });
    expect(rejected.status()).toBe(401);
    const rejectedText = await rejected.text();
    expect(JSON.parse(rejectedText)).toMatchObject({ errors: [{ message: "The provider rejected this key.", code: "DEMO_KEY_INVALID" }] });
    expect(rejectedText).not.toContain(WRONG_BUT_WELL_SHAPED);
    expect(rejectedText).not.toContain("forbidden"); // the stub's body (which echoes the key) never reaches the visitor

    // ── 6. Not an open proxy (each check from its own visitor id: every demo request counts toward the limits) ──
    await resetRateLimits();
    let n = 0;
    const bad = async (over: Partial<DemoBody>, status = 400) =>
      expect((await demo(A, { ...ok, ...over }, { "X-Provider-Key": VISITOR_KEY, "X-Lab-Visitor": `proxycheck${n++}`.padEnd(24, "x") })).status()).toBe(status);
    await bad({ exampleRefs: dev.map((d) => d.id) }); // 11 refs
    await bad({ exampleRefs: ["t_001"] }); // test split
    await bad({ exampleRefs: ["p_001"] }); // private input
    await bad({ promptVersion: "v9-nope@1" }); // not in the run
    await bad({ slug: "r_aaaaaaaaaa" }, 404); // not published
    expect((await stubStats()).byKey.server).toBe(0);

    // ── 5. Limits: 5 per hour per visitor, then 20 per hour per IP ──
    await resetRateLimits();
    const one = { ...ok, exampleRefs: ["d_001"] };
    const visitor = (id: string) => ({ "X-Provider-Key": VISITOR_KEY, "X-Lab-Visitor": id.padEnd(24, "x") });
    for (let i = 0; i < 5; i++) expect((await demo(A, one, visitor("alice"))).status()).toBe(200);
    expect((await demo(A, one, visitor("alice"))).status()).toBe(429);
    let ipRuns = 5;
    for (let v = 0; ipRuns < 20; v++) {
      for (let i = 0; i < 5 && ipRuns < 20; i++, ipRuns++) expect((await demo(A, one, visitor(`fresh${v}`))).status()).toBe(200);
    }
    expect((await demo(A, one, visitor("brandnewvisitor"))).status()).toBe(429); // the IP is now blocked
    await resetRateLimits();

    // ── 7. The page: key in memory unless remembered for this tab; never localStorage or a cookie; 401 clears it ──
    const vp = await anon.newPage();
    await vp.goto(`/demo?run=${slug}`);
    await expect(vp.getByTestId("demo-examples").locator("input:checked")).toHaveCount(5);
    await vp.getByTestId("key-input").fill(VISITOR_KEY);
    await vp.reload();
    await expect(vp.getByTestId("key-input")).toHaveValue("");
    await vp.getByTestId("key-input").fill(VISITOR_KEY);
    await vp.getByTestId("remember-key").check();
    await vp.reload();
    await expect(vp.getByTestId("key-input")).toHaveValue(VISITOR_KEY);
    const otherTab = await anon.newPage();
    await otherTab.goto(`/demo?run=${slug}`);
    await expect(otherTab.getByTestId("key-input")).toHaveValue("");
    await otherTab.close();
    expect(await vp.evaluate(() => JSON.stringify(localStorage))).not.toContain("nvapi");
    expect(JSON.stringify(await anon.cookies())).not.toContain("nvapi");
    await vp.getByTestId("demo-start").click();
    await expect(vp.getByTestId("demo-results")).toBeVisible({ timeout: 60_000 });
    await expect(vp.getByTestId("demo-results").getByTestId("result-card")).toHaveCount(5);
    await expect(vp.getByTestId("demo-results")).toContainText("5-example sample on your key, not the published result");
    await vp.getByTestId("key-input").fill(WRONG_BUT_WELL_SHAPED);
    await vp.getByTestId("demo-start").click();
    await expect(vp.getByTestId("demo-error")).toHaveText("The provider rejected this key.");
    await expect(vp.getByTestId("key-input")).toHaveValue("");
    await expect(vp.getByTestId("key-input")).toBeFocused();
    expect(await vp.evaluate(() => JSON.stringify(sessionStorage))).not.toContain("nvapi");

    // ── 8. 429 and 410 each get their own message ──
    const limited = await demo(A, { ...ok, exampleRefs: ["d_001", "z_429"] }, { "X-Provider-Key": VISITOR_KEY });
    expect(limited.status()).toBe(200);
    const lr = ((await limited.json()) as { data: { results: { exampleRef: string; error?: string }[] } }).data.results;
    expect(lr.find((r) => r.exampleRef === "z_429")!.error).toBe("The provider is rate-limiting this key.");
    // The visitor's 429s never open the model's breaker (5 failures would): afterwards the model still answers.
    await resetRateLimits();
    for (let i = 0; i < 5; i++) await demo(A, { ...ok, exampleRefs: ["z_429"] }, { "X-Provider-Key": VISITOR_KEY, "X-Lab-Visitor": `breaker${i}`.padEnd(24, "x") });
    const after429 = await demo(A, { ...ok, exampleRefs: ["d_001"] }, { "X-Provider-Key": VISITOR_KEY, "X-Lab-Visitor": "breakerafter".padEnd(24, "x") });
    expect(((await after429.json()) as { data: { results: { status: string }[] } }).data.results[0]!.status).toBe("scored");
    const retired = await demo(A, { ...ok, exampleRefs: ["r_410"] }, { "X-Provider-Key": VISITOR_KEY });
    expect(retired.status()).toBe(200);
    expect(((await retired.json()) as { data: { results: { error?: string }[] } }).data.results[0]!.error).toBe("This model has been retired by the provider.");
    await sql("update models set active = true where key = $1", [MODEL_A]); // the stub only pretended: restore it for later specs
    expect((await stubStats()).byKey.server).toBe(0); // across the whole spec, after the published run: never the owner's key
    await anon.close();
  });
});
