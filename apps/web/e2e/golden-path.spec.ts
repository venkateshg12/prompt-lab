import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { signupAndVerify } from "./helpers/signup";
import { resetRateLimits } from "./helpers/rateLimits";
import { API } from "./helpers/workspace";
import { MODEL_A, stubReset } from "./helpers/runs";
import { promptLabResultLineSchema } from "../../api/test/contract/importContracts.copy";

const postings = readFileSync(path.join(__dirname, "fixtures/postings.jsonl"), "utf8");

test.describe("Phase 28 — the golden path, in a real browser against the real API", () => {
  test.beforeEach(async () => {
    await resetRateLimits();
    await stubReset();
  });

  test("sign up → task → import → prompt → run → results → error browser → export → publish → public page", async ({ page, browser, context }) => {
    test.setTimeout(180_000);
    const owner = await signupAndVerify(page);

    // Task from the bundled job-postings example.
    await page.goto("/tasks");
    await page.getByTestId("new-task").click();
    await page.getByTestId("load-example").click();
    await page.getByTestId("create-task").click();
    await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/);
    const taskId = page.url().split("/").pop()!;

    // Import 5 postings (3 dev, 2 test).
    await page.goto(`/tasks/${taskId}?tab=examples`);
    await page.getByTestId("open-import").click();
    await page.getByLabel("Examples file content").fill(postings);
    await page.getByTestId("import-check").click();
    await expect(page.getByTestId("import-counts")).toContainText("valid 5 · invalid 0 · new 5");
    await page.getByTestId("import-commit").click();
    await expect(page.getByTestId("example-row-g_005")).toBeVisible();

    // The v1 prompt.
    await page.goto(`/tasks/${taskId}?tab=prompts`);
    await page.getByTestId("new-prompt").click();
    await page.getByTestId("prompt-key").fill("v1-zero-shot");
    await page.getByTestId("save-prompt").click();
    await expect(page.getByTestId("prompt-v1-zero-shot@1")).toBeVisible();

    // A dev run, live progress to 3/3, then the results table.
    await page.goto(`/tasks/${taskId}?tab=runs`);
    await page.getByTestId("new-run").click();
    await page.getByTestId("pick-prompt-v1-zero-shot").check();
    await page.getByTestId(`pick-model-${MODEL_A}`).check();
    await page.getByTestId("start-run").click();
    await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/);
    const runId = page.url().split("/").pop()!;
    await expect(page.getByTestId("results-table")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("[data-testid^=result-row-]")).toHaveCount(1);

    // The salary column → the error browser shows the recorded wrong salary with its reason.
    await page.locator("[data-testid^=field-link-stipend_or_salary-]").click();
    await expect(page.getByTestId("result-card")).toHaveCount(1);
    await expect(page.getByTestId("result-card")).toHaveAttribute("data-ref", "g_002");
    await expect(page.getByTestId("reason-chip-out_of_tolerance")).toHaveAttribute("data-count", "1");

    // Copy Markdown contains the row; results.jsonl parses line by line with the Playbook's schema.
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(`/runs/${runId}`);
    await page.getByTestId("copy-markdown").click();
    await expect(page.getByTestId("export-msg")).toHaveText("Markdown copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(`| v1-zero-shot@1 | ${MODEL_A} | 3 |`);
    const orgId = (/\/orgs\/([0-9a-f-]{36})\//.exec((await page.getByTestId("dl-results-jsonl").getAttribute("href"))!) ?? [])[1]!;
    const jsonl = await (await page.context().request.get(`${API}/orgs/${orgId}/runs/${runId}/export/results.jsonl`)).text();
    const lines = jsonl.trim().split("\n");
    expect(lines).toHaveLength(3);
    for (const l of lines) expect(promptLabResultLineSchema.safeParse(JSON.parse(l)).success).toBe(true);

    // Publish → a signed-out visitor sees the table and no owner email.
    await page.getByTestId("open-publish").click();
    await page.getByTestId("publish").click();
    const url = await page.getByTestId("published-url").inputValue();
    const visitor = await browser.newContext();
    const vp = await visitor.newPage();
    await vp.goto(url);
    await expect(vp.getByTestId("results-table")).toBeVisible();
    expect(await vp.content()).not.toContain(owner.email);
    await visitor.close();
  });
});
