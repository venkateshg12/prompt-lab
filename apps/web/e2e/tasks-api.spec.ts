import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { signupAndVerify } from "./helpers/signup";
import { resetRateLimits } from "./helpers/rateLimits";

// Cookies are set for "localhost", so calls that reuse the browser's session must use that host.
const API = "http://localhost:5000";
const taskFile = JSON.parse(readFileSync(path.resolve(__dirname, "../../../cases/job-postings/task.json"), "utf8"));

test.describe("Phase 11 — tasks and the field-rule DSL (API contract, real session)", () => {
  test.beforeEach(async () => {
    await resetRateLimits();
  });

  test("create, read with derived JSON Schema, version on definition change, duplicate slug, tenancy", async ({
    page,
    browser,
  }) => {
    await signupAndVerify(page);
    const req = page.context().request;
    const orgs = (await (await req.get(`${API}/orgs`)).json()) as { data: { id: string }[] };
    const orgId = orgs.data[0]!.id;

    const created = await req.post(`${API}/orgs/${orgId}/tasks`, { data: taskFile });
    expect(created.status()).toBe(201);
    const taskId = ((await created.json()) as { data: { task: { id: string; version: number } } }).data.task.id;

    const dup = await req.post(`${API}/orgs/${orgId}/tasks`, { data: taskFile });
    expect(dup.status()).toBe(409);

    const one = (await (await req.get(`${API}/orgs/${orgId}/tasks/${taskId}`)).json()) as {
      data: { task: { version: number }; jsonSchema: { properties: object; additionalProperties: boolean } };
    };
    expect(Object.keys(one.data.jsonSchema.properties)).toHaveLength(8);
    expect(one.data.jsonSchema.additionalProperties).toBe(false);
    expect(one.data.task.version).toBe(1);

    // A rename is not a definition change; new instructions are.
    const rename = (await (await req.patch(`${API}/orgs/${orgId}/tasks/${taskId}`, { data: { name: "Renamed" } })).json()) as {
      data: { version: number; versionBumped: boolean };
    };
    expect(rename.data).toMatchObject({ version: 1, versionBumped: false });
    const redefine = (await (
      await req.patch(`${API}/orgs/${orgId}/tasks/${taskId}`, { data: { instructions: "New instructions." } })
    ).json()) as { data: { version: number; versionBumped: boolean } };
    expect(redefine.data).toMatchObject({ version: 2, versionBumped: true });

    // The list reflects the write at once (cache bumped), and a bad rule is a 400 with a field path.
    const list = (await (await req.get(`${API}/orgs/${orgId}/tasks`)).json()) as { data: { name: string; version: number }[] };
    expect(list.data[0]).toMatchObject({ name: "Renamed", version: 2 });
    const bad = await req.post(`${API}/orgs/${orgId}/tasks`, {
      data: { slug: "bad", name: "b", instructions: "x", fields: [{ kind: "enum", key: "Bad Key", values: ["a"] }] },
    });
    expect(bad.status()).toBe(400);

    // Another workspace's member gets 404, never the task.
    const otherCtx = await browser.newContext();
    await signupAndVerify(await otherCtx.newPage());
    expect((await otherCtx.request.get(`${API}/orgs/${orgId}/tasks/${taskId}`)).status()).toBe(404);
    expect((await otherCtx.request.get(`${API}/orgs/${orgId}/tasks`)).status()).toBe(404);
    await otherCtx.close();
  });
});
