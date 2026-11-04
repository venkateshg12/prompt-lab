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
    // The E2E API has a (fake) NVIDIA key pointing at a local stub, and no other provider keys: only the
    // NVIDIA models and the fake model are listed, and no E2E run can reach a paid API.
    expect(models.data.map((m) => m.key).sort()).toEqual(["fake:text", "nvidia:nvidia/nemotron-3-super-120b-a12b", "nvidia:openai/gpt-oss-20b"]);
    expect(models.data.find((m) => m.key === "fake:text")).toMatchObject({ provider: "fake", enabled: true, inputUsdMicrosPerMTok: 1_000_000 });
    for (const m of models.data) expect(m.priceCheckedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
