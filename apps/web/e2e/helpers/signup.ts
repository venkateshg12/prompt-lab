import { type Page, expect } from "@playwright/test";

export interface TestUser {
  name: string;
  email: string;
  password: string;
  token?: string;
}

const apiUrl = () => process.env.API_BASE_URL || "http://127.0.0.1:5000";

/**
 * Polls the API's dev mailbox for the last email sent to `email` (non-production only). `match`
 * narrows it to one kind of mail by its link, e.g. /\/invites#token=/ or /\/auth\/verify\//.
 */
export async function waitForDevMail(page: Page, email: string, match?: RegExp) {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const res = await fetch(`${apiUrl()}/auth/dev/latest-link?email=${encodeURIComponent(email)}`);
      if (res.ok) {
        const body = (await res.json()) as { email?: { token?: string; link?: string } };
        const entry = body?.email;
        if (entry?.link && (!match || match.test(entry.link))) {
          return entry as { token?: string; link: string };
        }
      }
    } catch {
      // API might be spinning up
    }
    await page.waitForTimeout(400);
  }
  throw new Error(`No dev mail for ${email} matching ${match ?? "anything"} from ${apiUrl()}/auth/dev/latest-link`);
}

export async function signupAndVerify(page: Page, overrides: Partial<TestUser> = {}): Promise<TestUser> {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const name = overrides.name || `Test User ${stamp}`;
  const email = overrides.email || `test-${stamp}@example.com`;
  const password = overrides.password || "Password@123!";

  await page.goto("/register");
  await page.waitForLoadState("domcontentloaded");
  await page.fill("#name", name);
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.fill("#confirmPassword", password);
  await page.click("button[type='submit']");

  const mail = await waitForDevMail(page, email, /\/auth\/verify\//);
  await page.goto(`/auth/verify/${mail.token}`);

  // Verification signs the user in and redirects to the app; otherwise it asks for a login.
  try {
    await page.waitForURL(/\/tasks|\/login/, { timeout: 10000 });
  } catch {
    // still on the verify page
  }
  if (page.url().includes("/login")) {
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.click("button[type='submit']");
    await page.waitForURL(/\/tasks/, { timeout: 10000 });
  }
  await expect(page).toHaveURL(/\/tasks/);

  return { name, email, password, token: mail.token };
}

export async function loginUser(page: Page, user: TestUser): Promise<void> {
  await page.goto("/login");
  await page.fill("#email", user.email);
  await page.fill("#password", user.password);
  await page.click("button[type='submit']");
  await page.waitForURL(/\/tasks/, { timeout: 10000 });
}
