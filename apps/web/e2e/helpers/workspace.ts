import { type APIRequestContext, type Browser, type BrowserContext, expect } from "@playwright/test";
import { signupAndVerify, waitForDevMail, type TestUser } from "./signup";

// Cookies are set for "localhost", so calls that reuse the browser's session must use that host.
export const API = "http://localhost:5000";

export interface Member {
  user: TestUser;
  ctx: BrowserContext;
  request: APIRequestContext;
}

/** Signs a new user up in its own browser context. */
export async function newMember(browser: Browser): Promise<Member> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const user = await signupAndVerify(page);
  return { user, ctx, request: ctx.request };
}

export async function firstOrgId(request: APIRequestContext): Promise<string> {
  const orgs = (await (await request.get(`${API}/orgs`)).json()) as { data: { id: string }[] };
  return orgs.data[0]!.id;
}

/** The owner invites `member` into their workspace with `role`, and `member` accepts through the API. */
export async function addToWorkspace(
  owner: APIRequestContext,
  orgId: string,
  member: Member,
  role: "admin" | "reviewer" | "viewer"
) {
  const created = await owner.post(`${API}/orgs/${orgId}/invites`, { data: { email: member.user.email, role } });
  expect(created.status()).toBe(201);
  const page = await member.ctx.newPage();
  const mail = await waitForDevMail(page, member.user.email, /\/invites#token=/);
  await page.close();
  const token = mail.link.split("#token=")[1];
  const accepted = await member.request.post(`${API}/invites/accept`, { data: { token } });
  expect(accepted.status()).toBe(200);
}
