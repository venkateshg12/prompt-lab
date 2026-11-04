import { test, expect } from "@playwright/test";
import { signupAndVerify } from "./helpers/signup";
import { resetRateLimits } from "./helpers/rateLimits";
import { API } from "./helpers/workspace";

test.describe("Phase 14 — model registry (real session)", () => {
  test.beforeEach(async () => {
    await resetRateLimits();
  });

  test("GET /models needs a session and lists only models whose provider key is set", async ({ page }) => {
    expect((await page.request.get(`${API}/models`)).status()).toBe(401);
    await signupAndVerify(page);
    const models = (await (await page.context().request.get(`${API}/models`)).json()) as {
      data: { key: string; provider: string; enabled: boolean; priceCheckedOn: string; inputUsdMicrosPerMTok: number }[];
    };
    // The E2E API has no provider keys and MODELS_SEED=test: only the fake model, so no paid call is possible.
    expect(models.data.map((m) => m.key)).toEqual(["fake:text"]);
    expect(models.data[0]).toMatchObject({ provider: "fake", enabled: true, inputUsdMicrosPerMTok: 1_000_000 });
    expect(models.data[0]!.priceCheckedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
