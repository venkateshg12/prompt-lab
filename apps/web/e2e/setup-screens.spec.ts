import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { signupAndVerify } from "./helpers/signup";
import { resetRateLimits } from "./helpers/rateLimits";
import { API, addToWorkspace, firstOrgId, newMember, type Member } from "./helpers/workspace";
import { MODEL_A, answer, stubReset, waitForRun } from "./helpers/runs";

const line = (n: number, over: Record<string, unknown> = {}, split: "dev" | "test" = n <= 40 ? "dev" : "test") => ({
  id: `x_${String(n).padStart(3, "0")}`,
  split,
  tags: n % 3 === 0 ? ["salary_lpa"] : ["plain"],
  input: `Posting ${n}: we are hiring an engineer in Pune.`,
  expected: answer(n, over),
});
const jsonl = (rows: object[]) => rows.map((r) => JSON.stringify(r)).join("\n");

/** A signed-in member's page with the owner's workspace selected (the org store is persisted in localStorage). */
async function memberPage(member: Member, orgId: string): Promise<Page> {
  const page = await member.ctx.newPage();
  await page.addInitScript((id) => {
    localStorage.setItem("promptlab-org-store", JSON.stringify({ state: { selectedOrgId: id }, version: 0 }));
  }, orgId);
  return page;
}

test.describe("Phase 19 — task, test-set and prompt screens (real browser)", () => {
  test.beforeEach(async () => {
    await resetRateLimits();
    await stubReset();
  });

  test("owner: create a task, dry-run import, URL filters, label editing, prompts (frozen, dev-only few-shot, server preview)", async ({ page }) => {
    await signupAndVerify(page);
    const req = page.context().request;

    // ── Tasks: empty state, then create from the bundled example ──
    await page.goto("/tasks");
    await expect(page.getByTestId("tasks-empty")).toBeVisible();
    await page.getByTestId("new-task").click();
    await page.getByTestId("load-example").click();
    await page.getByTestId("create-task").click();
    await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/);
    const taskId = page.url().split("/").pop()!;
    await expect(page.getByTestId("task-title")).toContainText("Job Posting Extractor");
    await expect(page.getByTestId("task-version")).toHaveText("v1");

    // Overview: 8 rules, 8-property schema, with the enum values visible
    await expect(page.getByTestId("rules-table").locator("tbody tr")).toHaveCount(8);
    await expect(page.getByTestId("json-schema")).toContainText('"hybrid"');
    await expect(page.getByTestId("schema-props")).toHaveText("8");

    // The task list now shows its counts
    await page.goto("/tasks");
    await expect(page.getByTestId("task-card-job-postings")).toContainText("Fields");
    await expect(page.getByTestId("task-card-job-postings")).toContainText("0 / 0");

    // ── Test set: dry-run import with one bad row ──
    await page.goto(`/tasks/${taskId}?tab=examples`);
    await expect(page.getByTestId("examples-empty")).toBeVisible();
    const good = Array.from({ length: 60 }, (_, i) => line(i + 1));
    const bad = [...good];
    bad[1] = line(2, { remote: "wfh" }); // line 2: not in the task's enum
    await page.getByTestId("open-import").click();
    await page.getByLabel("Examples file content").fill(jsonl(bad));
    await page.getByTestId("import-check").click();
    await expect(page.getByTestId("import-counts")).toContainText("invalid 1");
    await expect(page.getByTestId("import-invalid")).toContainText("line 2");
    await expect(page.getByTestId("import-invalid")).toContainText("expected.remote");
    await expect(page.getByTestId("import-commit")).toBeDisabled();
    // Fix it → Check → Import
    await page.getByLabel("Examples file content").fill(jsonl(good));
    await expect(page.getByTestId("import-commit")).toBeDisabled(); // editing invalidates the earlier report
    await page.getByTestId("import-check").click();
    await expect(page.getByTestId("import-counts")).toContainText("valid 60 · invalid 0 · new 60");
    await page.getByTestId("import-commit").click();
    await expect(page.getByTestId("example-row-x_060")).toBeVisible(); // newest first

    // Cursor paging: 50 per page, "Load more" fetches the rest
    await expect(page.getByTestId("examples-table").locator("tbody tr")).toHaveCount(50);
    await page.getByTestId("load-more").click();
    await expect(page.getByTestId("examples-table").locator("tbody tr")).toHaveCount(60);
    await expect(page.getByTestId("load-more")).toHaveCount(0);

    // ── Filters live in the URL and survive a reload ──
    await page.getByTestId("filter-split").selectOption("dev");
    await page.getByTestId("filter-tag").fill("salary_lpa");
    await page.getByTestId("filter-tag").press("Enter");
    await expect(page).toHaveURL(/split=dev/);
    await expect(page).toHaveURL(/tag=salary_lpa/);
    await expect(page.getByTestId("examples-table").locator("tbody tr")).toHaveCount(13); // multiples of 3 up to 40
    await page.reload();
    await expect(page.getByTestId("filter-split")).toHaveValue("dev");
    await expect(page.getByTestId("examples-table").locator("tbody tr")).toHaveCount(13);
    await page.goto(`/tasks/${taskId}?tab=examples`);

    // ── Edit a label: invalid enum is flagged before Save; Rev goes 1 → 2 ──
    await page.getByTestId("load-more").click(); // newest first: x_003 is on page 2
    await page.getByTestId("example-row-x_003").click();
    const expected = page.getByLabel("Expected");
    const original = JSON.parse(await expected.inputValue());
    await expected.fill(JSON.stringify({ ...original, remote: "wfh" }, null, 2));
    await expect(page.getByTestId("expected-error")).toContainText("remote");
    await expect(page.getByTestId("save-example")).toBeDisabled();
    await expected.fill(JSON.stringify({ ...original, company: "Gamma Co" }, null, 2));
    await expect(page.getByTestId("expected-error")).toHaveCount(0);
    await page.getByTestId("save-example").click();
    await expect(page.getByTestId("example-row-x_003").locator("td").last()).toHaveText("2");

    // ── Rules: invalid JSON flagged; a real change shows the version bump before it is sent ──
    await page.getByTestId("tab-overview").click();
    await page.getByTestId("edit-rules").click();
    await page.getByLabel("Field rules (JSON)").fill("[{ nope");
    await expect(page.getByTestId("rules-error")).toBeVisible();
    const task = (await (await req.get(`${API}/orgs/${await firstOrgId(req)}/tasks/${taskId}`)).json()) as { data: { task: { fields: object[] } } };
    await page.getByLabel("Field rules (JSON)").fill(JSON.stringify(task.data.task.fields.map((f) => ((f as { key: string }).key === "skills" ? { ...f, synonyms: { ...(f as { synonyms: object }).synonyms, tf: "tensorflow" } } : f)), null, 2));
    await page.getByTestId("review-change").click();
    await expect(page.getByTestId("version-notice")).toContainText("v1 → v2");
    await page.getByTestId("save-rules").click();
    await expect(page.getByTestId("task-version")).toHaveText("v2");

    // ── Prompts: create v1, preview is the SERVER's render (byte-identical to the API) ──
    await page.getByTestId("tab-prompts").click();
    await expect(page.getByTestId("prompts-empty")).toBeVisible();
    await page.getByTestId("new-prompt").click();
    await page.getByTestId("prompt-key").fill("v1-zero-shot");
    await page.getByTestId("save-prompt").click();
    await expect(page.getByTestId("prompt-v1-zero-shot@1")).toBeVisible();
    await expect(page.getByTestId("draft-badge").first()).toBeVisible();
    await expect(page.getByTestId("turn-system")).toContainText("- remote: one of");
    const orgId = await firstOrgId(req);
    const prompts = (await (await req.get(`${API}/orgs/${orgId}/tasks/${taskId}/prompts`)).json()) as { data: { id: string; versionId: string }[] };
    const v1 = prompts.data.find((p) => p.versionId === "v1-zero-shot@1")!;
    const shownExample = await page.getByTestId("preview-example").inputValue();
    const api = (await (await req.get(`${API}/orgs/${orgId}/tasks/${taskId}/prompts/${v1.id}/preview?exampleId=${shownExample}`)).json()) as { data: { system: string; messages: { content: string }[] } };
    expect(await page.getByTestId("turn-system").textContent()).toBe(api.data.system);
    expect(await page.getByTestId("turn-user").textContent()).toBe(api.data.messages[0]!.content);

    // Placeholder chips insert at the cursor
    await page.getByTestId("prompt-v1-zero-shot@1").click();
    await page.getByLabel("Template").click();
    await page.getByTestId("chip-instructions").click();
    expect(await page.getByLabel("Template").inputValue()).toContain("{{instructions}}");

    // ── Few-shot: the picker lists DEV examples only, so a test example can't be chosen at all ──
    await page.getByTestId("new-prompt").click();
    await page.getByTestId("prompt-key").fill("v2-few-shot");
    await page.getByTestId("technique").selectOption("few_shot");
    await expect(page.getByTestId("few-shot-picker")).toBeVisible();
    await expect(page.getByTestId("shot-x_001")).toBeVisible();
    await expect(page.getByTestId("shot-x_041")).toHaveCount(0); // x_041+ are test
    await page.getByTestId("shot-x_001").check();
    await page.getByTestId("shot-x_002").check();
    await page.getByLabel("System").fill("{{instructions}}\n\nFields:\n{{fields}}\n\n{{examples}}");
    await page.getByTestId("save-prompt").click();
    await expect(page.getByTestId("prompt-v2-few-shot@1")).toBeVisible();
    await expect(page.getByTestId("preview-meta")).toContainText("inline few-shot");
    await expect(page.getByTestId("turn-system")).toContainText("Example 2");

    // ── Frozen: once a run uses a version it is read-only; Create @2 opens an editable copy ──
    const created = await req.post(`${API}/orgs/${orgId}/runs`, { data: { taskId, promptVersionIds: [v1.id], modelKeys: [MODEL_A], split: "dev" } });
    expect(created.status()).toBe(201);
    const runId = ((await created.json()) as { data: { id: string } }).data.id;
    await waitForRun(req, orgId, runId, (r) => r.status === "completed");
    await page.reload();
    await page.getByTestId("tab-prompts").click();
    await page.getByTestId("prompt-v1-zero-shot@1").click();
    await expect(page.getByTestId("prompt-editor").getByTestId("frozen-badge")).toContainText("frozen");
    await expect(page.getByLabel("Template")).toHaveAttribute("readonly", "");
    await expect(page.getByTestId("save-prompt")).toHaveCount(0);
    await page.getByTestId("create-next").click();
    await expect(page.getByLabel("Template")).not.toHaveAttribute("readonly", "");
    await page.getByTestId("save-prompt").click(); // unchanged copy: the API refuses a no-op version, shown inline
    await expect(page.getByTestId("prompt-error")).toContainText("No changes");
    await page.getByLabel("Template").fill('Posting:\n"""\n{{input}}\n"""\nReturn JSON only.');
    await page.getByTestId("save-prompt").click();
    await expect(page.getByTestId("prompt-v1-zero-shot@2")).toBeVisible();
  });

  test("reviewer labels blind and agreement uses the scorer's rules; viewer sees no edit controls", async ({ page, browser }) => {
    await signupAndVerify(page);
    const req = page.context().request;
    const orgId = await firstOrgId(req);
    // Task + examples with known first labels (set up through the API; the screens under test are the reviewer's).
    const taskFile = JSON.parse(readFileSync(path.resolve(__dirname, "../../../cases/job-postings/task.json"), "utf8"));
    const task = (await (await req.post(`${API}/orgs/${orgId}/tasks`, { data: taskFile })).json()) as { data: { task: { id: string } } };
    const T = `${API}/orgs/${orgId}/tasks/${task.data.task.id}`;
    const rows = [
      line(1, { company: "Acme Labs" }, "dev"),
      line(2, { company: "Beta Corp", remote: "onsite" }, "dev"),
      line(3, { company: "Gamma" }, "dev"),
    ];
    await req.post(`${T}/examples/import`, { data: { format: "jsonl", content: jsonl(rows), dryRun: false } });

    const reviewer = await newMember(browser);
    await addToWorkspace(req, orgId, reviewer, "reviewer");
    const rp = await memberPage(reviewer, orgId);
    await rp.goto(`/tasks/${task.data.task.id}?tab=examples`);
    await expect(rp.getByTestId("example-row-x_001")).toBeVisible();
    await expect(rp.getByTestId("open-import")).toHaveCount(0); // a reviewer can't import
    await expect(rp.getByTestId("example-row-x_001")).toContainText("hidden until you label");

    // Second labels: "acme labs." vs "Acme Labs" and a different remote on x_002
    const second = [
      { id: "x_001", over: { company: "acme labs." } },
      { id: "x_002", over: { company: "Beta Corp", remote: "hybrid" } },
      { id: "x_003", over: { company: "Gamma" } },
    ];
    for (const [i, s] of second.entries()) {
      await rp.getByTestId(`example-row-${s.id}`).click();
      await expect(rp.getByTestId("label-hidden")).toBeVisible(); // the first label is hidden: no anchoring
      await expect(rp.getByLabel("Expected")).toHaveCount(0);
      if (i === 0) {
        await rp.getByLabel("Second label").fill("{ not json");
        await expect(rp.getByTestId("label-error")).toBeVisible();
        await expect(rp.getByTestId("save-second-label")).toBeDisabled();
      }
      await rp.getByLabel("Second label").fill(JSON.stringify(answer(i + 1, s.over), null, 2));
      await rp.getByTestId("save-second-label").click();
      await expect(rp.getByTestId("example-sheet")).toHaveCount(0);
    }
    // Agreement is computed with the scorer's rules: "acme labs." agrees with "Acme Labs"; the remote differs on x_002.
    await expect(rp.getByTestId("agreement-panel")).toContainText("3 double-labelled");
    await expect(rp.getByTestId("agreement-company")).toContainText("3/3");
    await expect(rp.getByTestId("agreement-remote")).toContainText("2/3");
    await expect(rp.getByTestId("agreement-remote")).toContainText("x_002");
    await rp.getByTestId("example-row-x_001").click();
    await expect(rp.getByTestId("label-hidden")).toHaveCount(0); // after labelling, the first label is visible
    await rp.keyboard.press("Escape");

    // Viewer: read-only everywhere
    const viewer = await newMember(browser);
    await addToWorkspace(req, orgId, viewer, "viewer");
    const vp = await memberPage(viewer, orgId);
    await vp.goto(`/tasks/${task.data.task.id}?tab=examples`);
    await expect(vp.getByTestId("example-row-x_001")).toBeVisible();
    await expect(vp.getByTestId("open-import")).toHaveCount(0);
    await vp.getByTestId("example-row-x_001").click();
    await expect(vp.getByTestId("save-example")).toHaveCount(0);
    await expect(vp.getByTestId("second-label")).toHaveCount(0);
    await expect(vp.getByLabel("Input")).toHaveAttribute("readonly", "");
    await vp.keyboard.press("Escape");
    await vp.getByTestId("tab-prompts").click();
    await expect(vp.getByTestId("new-prompt")).toHaveCount(0);
    await vp.getByTestId("tab-overview").click();
    await expect(vp.getByTestId("edit-rules")).toHaveCount(0);
    await vp.goto("/tasks");
    await expect(vp.getByTestId("new-task")).toHaveCount(0);

    // A stranger asking for this task gets the "doesn't exist" state, not data
    const stranger = await newMember(browser);
    const sp = await stranger.ctx.newPage();
    await sp.addInitScript((id) => localStorage.setItem("promptlab-org-store", JSON.stringify({ state: { selectedOrgId: id }, version: 0 })), orgId);
    await sp.goto(`/tasks/${task.data.task.id}`);
    await expect(sp.getByTestId("task-missing")).toBeVisible();
    await reviewer.ctx.close();
    await viewer.ctx.close();
    await stranger.ctx.close();
  });
});
