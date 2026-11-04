import { test, expect, type Page } from "@playwright/test";
import { signupAndVerify, loginUser } from "./helpers/signup";
import { resetRateLimits } from "./helpers/rateLimits";

// Counts the API calls a page makes to one path, to prove the refresh queue is single-flight.
const countRequests = (page: Page, pathPart: string) => {
  const hits: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes(pathPart)) hits.push(request.url());
  });
  return hits;
};

test.describe("Phase 09 — web foundation: auth flows", () => {
  test.beforeEach(async () => {
    await resetRateLimits();
  });

  test("landing page, register → verify → /tasks empty state, logout, login", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Which prompt, on which model")).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();

    const user = await signupAndVerify(page);
    await expect(page.getByTestId("tasks-empty")).toContainText("No tasks yet");

    await page.goto("/account");
    await expect(page.getByText("This device")).toBeVisible();

    // The click only starts the logout request: wait for the app's own redirect to /login.
    await page.getByRole("button", { name: /Sign out/i }).first().click();
    await expect(page).toHaveURL(/\/login/);

    await loginUser(page, user);
    await expect(page).toHaveURL(/\/tasks/);
  });

  test("guards: /account sends a guest to /login?from=, back after login; open redirect refused", async ({
    page,
  }) => {
    const user = await signupAndVerify(page);
    await page.goto("/account");
    await page.getByRole("button", { name: /Sign out/i }).first().click();
    await expect(page).toHaveURL(/\/login/);

    await page.goto("/account");
    await expect(page).toHaveURL(/\/login\?from=%2Faccount/);
    await page.fill("#email", user.email);
    await page.fill("#password", user.password);
    await page.click("button[type='submit']");
    await expect(page).toHaveURL(/\/account$/);

    // GuestOnly's sanitizeRedirectUrl: a signed-in user following ?from=//evil lands in the app.
    await page.goto("/login?from=//evil.example");
    await expect(page).toHaveURL(/localhost:3000\/tasks/);
  });

  test("silent refresh is single-flight even when two requests 401 together", async ({ page, context }) => {
    await signupAndVerify(page);
    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === "refreshToken")).toBeDefined();

    await context.clearCookies({ name: "accessToken" });
    const refreshes = countRequests(page, "/auth/refresh");
    // /account fires /auth/me and /session together.
    await page.goto("/account");
    await expect(page.getByText("This device")).toBeVisible();
    await expect(page).toHaveURL(/\/account/);
    expect(refreshes).toHaveLength(1);
  });

  test("a failed refresh sends the user to /login", async ({ page, context }) => {
    await signupAndVerify(page);
    await context.clearCookies();
    await page.goto("/account");
    await expect(page).toHaveURL(/\/login/);
  });

  test("a revoked device is signed out on its next click", async ({ page, browser }) => {
    const user = await signupAndVerify(page);

    const second = await browser.newContext();
    const other = await second.newPage();
    await loginUser(other, user);
    await other.goto("/account");
    await expect(other.getByText("This device")).toBeVisible();

    await page.goto("/account");
    await expect(page.getByText("This device")).toBeVisible();
    // Two devices now: revoke the one that isn't this device.
    const rows = page.locator("ul > li");
    await expect(rows).toHaveCount(2);
    await rows.filter({ hasNot: page.getByText("This device") }).getByRole("button", { name: /Sign out/i }).click();
    const confirm = page.getByRole("button", { name: /^(Sign out|Confirm|Yes|Continue)/i }).last();
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
    await expect(rows).toHaveCount(1);

    // The other device's access token is still cryptographically valid, but its session row is gone.
    await other.goto("/tasks");
    await expect(other).toHaveURL(/\/login/);
    await second.close();
  });

  test("a sleeping server shows the wake notice, then clears it", async ({ page }) => {
    await signupAndVerify(page);
    // A fresh load has no recent answer, so a slow /auth/me raises the notice after ~3 s.
    await page.route("**/auth/me", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 4500));
      await route.continue();
    });
    await page.goto("/tasks");
    await expect(page.getByText("Waking up the Prompt Lab server").first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Server is ready")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("tasks-empty")).toBeVisible();
  });
});
