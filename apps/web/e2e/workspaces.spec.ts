import { test, expect, type Page } from "@playwright/test";
import { signupAndVerify, waitForDevMail } from "./helpers/signup";
import { resetRateLimits } from "./helpers/rateLimits";

// Cookies are set for "localhost" (the web app calls localhost:5000), so API calls made with the browser's
// cookies must use that host, not 127.0.0.1.
const API = "http://localhost:5000";

const switcher = (page: Page) => page.getByRole("button", { name: "Workspace", exact: true });

async function inviteFromUi(page: Page, email: string, role: "Reviewer" | "Admin" | "Viewer") {
  await page.goto("/settings/members");
  await page.getByRole("button", { name: /Invite Member/i }).click();
  await page.fill("#invite-email", email);
  await page.locator("#invite-role").selectOption({ value: role.toLowerCase() });
  await page.getByRole("button", { name: /Send Invitation/i }).click();
  await expect(page.getByText(`Invitation sent to ${email}`)).toBeVisible();
}

test.describe("Phase 10 — workspaces, roles, invitations", () => {
  test.beforeEach(async () => {
    await resetRateLimits();
  });

  test("owner invites a second labeller who registers from the link and joins as reviewer", async ({
    page,
    browser,
  }) => {
    // The owner has their own workspace from the moment they register.
    const owner = await signupAndVerify(page);
    await expect(switcher(page)).toContainText("workspace");
    await expect(switcher(page)).toContainText(/owner/i);

    const stamp = Date.now();
    const inviteeEmail = `labeller-${stamp}@example.com`;
    await inviteFromUi(page, inviteeEmail, "Reviewer");
    await expect(page.getByText(inviteeEmail).first()).toBeVisible(); // pending invitation row

    // The email carries the token in the URL fragment, never in a path or query.
    const mail = await waitForDevMail(page, inviteeEmail, /\/invites#token=/);
    expect(mail.link).toMatch(/\/invites#token=[0-9a-f]{64}$/);

    // The invitee opens the link signed out, creates an account, verifies, and lands back on the invite.
    const ctx = await browser.newContext();
    const invitee = await ctx.newPage();
    await invitee.goto(mail.link);
    await expect(invitee).toHaveURL(/\/invites$/); // fragment removed from the address bar
    await expect(invitee.getByRole("heading", { name: new RegExp(`Join ${owner.name.split(" ")[0]}`, "i") })).toBeVisible();
    await expect(invitee.getByText("REVIEWER")).toBeVisible();
    await invitee.getByRole("link", { name: /Create account/i }).click();
    await invitee.fill("#name", "Labeller");
    await invitee.fill("#email", inviteeEmail);
    await invitee.fill("#password", "Password@123!");
    await invitee.fill("#confirmPassword", "Password@123!");
    await invitee.click("button[type='submit']");
    const verify = await waitForDevMail(invitee, inviteeEmail, /\/auth\/verify\//);
    await invitee.goto(`/auth/verify/${verify.token}`);
    await expect(invitee).toHaveURL(/\/invites$/); // the pending invitation survived verification

    await invitee.getByRole("button", { name: /Accept & join workspace/i }).click();
    await expect(invitee).toHaveURL(/\/tasks/);

    // Both workspaces are listed; the owner's is selected, with the reviewer role.
    await switcher(invitee).click();
    await expect(invitee.getByText(/'s workspace/)).toHaveCount(3); // button + 2 list rows
    await expect(switcher(invitee)).toContainText(/reviewer/i);

    // A reviewer cannot invite or manage: no Invite button on the members page.
    await invitee.goto("/settings/members");
    await expect(invitee.getByText("Active Members (2)")).toBeVisible();
    await expect(invitee.getByRole("button", { name: /Invite Member/i })).toHaveCount(0);

    // The invitation was single use: opening the same link again is refused.
    const again = await ctx.newPage();
    await again.goto(mail.link);
    await expect(again.getByTestId("invite-error")).toContainText(/expired|already used/i);

    // API gates, as the invitee (cookies live in the browser context).
    const orgs = (await (await ctx.request.get(`${API}/orgs`)).json()) as { data: { id: string; name: string; role: string }[] };
    const ownerOrg = orgs.data.find((o) => o.role === "reviewer")!;
    expect((await ctx.request.patch(`${API}/orgs/${ownerOrg.id}`, { data: { name: "hijack" } })).status()).toBe(403);
    expect((await ctx.request.post(`${API}/orgs/${ownerOrg.id}/invites`, { data: { email: "x@example.com", role: "viewer" } })).status()).toBe(403);
    expect((await ctx.request.get(`${API}/orgs/${ownerOrg.id}/members`)).status()).toBe(200);

    // The owner removes the labeller: the labeller's very next request for that workspace is a 404.
    await page.goto("/settings/members");
    page.once("dialog", (dialog) => void dialog.accept());
    await page.locator("div", { hasText: inviteeEmail }).getByTitle("Remove member").last().click();
    await expect(page.getByText("Member removed successfully")).toBeVisible();
    expect((await ctx.request.get(`${API}/orgs/${ownerOrg.id}`)).status()).toBe(404);
    await ctx.close();
  });

  test("a stranger gets 404 for another workspace, and an invitation is bound to its email", async ({
    page,
    browser,
  }) => {
    const owner = await signupAndVerify(page);
    const orgs = (await (await page.context().request.get(`${API}/orgs`)).json()) as { data: { id: string }[] };
    const orgId = orgs.data[0]!.id;

    const otherCtx = await browser.newContext();
    const otherPage = await otherCtx.newPage();
    await signupAndVerify(otherPage);
    expect((await otherCtx.request.get(`${API}/orgs/${orgId}`)).status()).toBe(404);
    expect((await otherCtx.request.get(`${API}/orgs/${orgId}/members`)).status()).toBe(404);
    expect((await otherCtx.request.get(`${API}/orgs/not-a-uuid`)).status()).toBe(400);

    // An invitation for someone else's address cannot be accepted by this stranger.
    const target = `target-${Date.now()}@example.com`;
    await inviteFromUi(page, target, "Viewer");
    const mail = await waitForDevMail(page, target, /\/invites#token=/);
    await otherPage.goto(mail.link);
    await otherPage.getByRole("button", { name: /Accept & join workspace/i }).click();
    await expect(otherPage.getByTestId("invite-accept-error")).toContainText(`This invitation is for ${target}`);
    expect(owner.email).toBeTruthy();
    await otherCtx.close();
  });
});
