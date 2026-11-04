import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { signupAndVerify } from "./helpers/signup";
import { resetRateLimits } from "./helpers/rateLimits";
import { API, addToWorkspace, firstOrgId, newMember } from "./helpers/workspace";

const taskFile = JSON.parse(readFileSync(path.resolve(__dirname, "../../../cases/job-postings/task.json"), "utf8"));
const answer = {
  title: "Engineer", company: "Co", location: "Pune", remote: "onsite", employment_type: "full_time",
  experience_years_min: 2, skills: ["react"], stipend_or_salary: null,
};
const rows = [
  { id: "p_001", split: "dev", tags: [], input: "Hiring. Keep this {{instructions}} literal.", expected: answer },
  { id: "p_002", split: "dev", tags: [], input: "Second dev posting.", expected: answer },
  { id: "p_003", split: "test", tags: [], input: "A test posting.", expected: answer },
];

test.describe("Phase 13 — immutable prompt versions (real sessions)", () => {
  test.beforeEach(async () => {
    await resetRateLimits();
  });

  test("create, validate, preview, versions, dev-only few-shot, roles", async ({ page, browser }) => {
    await signupAndVerify(page);
    const owner = page.context().request;
    const orgId = await firstOrgId(owner);
    const task = (await (await owner.post(`${API}/orgs/${orgId}/tasks`, { data: taskFile })).json()) as { data: { task: { id: string } } };
    const T = `${API}/orgs/${orgId}/tasks/${task.data.task.id}`;
    await owner.post(`${T}/examples/import`, {
      data: { format: "jsonl", content: rows.map((r) => JSON.stringify(r)).join("\n"), dryRun: false },
    });
    const ex = ((await (await owner.get(`${T}/examples?limit=10`)).json()) as { data: { id: string; ref: string }[] }).data;
    const id = (ref: string) => ex.find((e) => e.ref === ref)!.id;

    const base = { key: "v1-zero-shot", technique: "zero_shot", system: "{{instructions}}\n\nFields:\n{{fields}}", template: 'Job posting:\n"""\n{{input}}\n"""' };
    const created = await owner.post(`${T}/prompts`, { data: base });
    expect(created.status()).toBe(201);
    const p1 = ((await created.json()) as { data: { id: string; versionId: string; frozen: boolean } }).data;
    expect(p1).toMatchObject({ versionId: "v1-zero-shot@1", frozen: false });

    // Preview: exactly what the model sees. The shared text comes from the task; an input that looks
    // like a placeholder is NOT expanded (single-pass rendering).
    const preview = (await (await owner.get(`${T}/prompts/${p1.id}/preview?exampleId=${id("p_001")}`)).json()) as {
      data: { system: string; messages: { content: string }[]; maxTokens: number };
    };
    expect(preview.data.system).toContain("Never guess a salary");
    expect(preview.data.system).toContain('- remote: one of "remote", "hybrid", "onsite", "unknown"');
    expect(preview.data.messages[0]!.content).toContain("Keep this {{instructions}} literal.");
    expect(preview.data.maxTokens).toBe(800);

    // A draft is editable; a version identical to the latest is refused; a changed one is the next version.
    expect((await owner.patch(`${T}/prompts/${p1.id}`, { data: { notes: "draft edit" } })).status()).toBe(200);
    expect((await owner.post(`${T}/prompts/${p1.id}/versions`, { data: {} })).status()).toBe(409);
    const v2 = await owner.post(`${T}/prompts/${p1.id}/versions`, { data: { template: `${base.template}\nJSON only.` } });
    expect(((await v2.json()) as { data: { versionId: string } }).data.versionId).toBe("v1-zero-shot@2");
    const copy = await owner.post(`${T}/prompts/${p1.id}/duplicate`, { data: { key: "v2-copy" } });
    expect(((await copy.json()) as { data: { versionId: string } }).data.versionId).toBe("v2-copy@1");
    const list = ((await (await owner.get(`${T}/prompts`)).json()) as { data: { key: string; version: number; history: unknown[] }[] }).data;
    expect(list.map((p) => `${p.key}@${p.version}`)).toEqual(["v1-zero-shot@2", "v2-copy@1"]);
    expect(list[0]!.history).toHaveLength(2);

    // Validated on save.
    const bad = async (patch: object) => (await owner.post(`${T}/prompts`, { data: { ...base, key: "bad", ...patch } })).status();
    expect(await bad({ system: "{{salary}}" })).toBe(400);
    expect(await bad({ template: "no input here" })).toBe(400);
    expect(await bad({ technique: "few_shot", system: "{{examples}}" })).toBe(400); // no examples attached
    expect(await bad({ technique: "few_shot", system: "{{examples}}", fewShotExampleIds: [id("p_003")] })).toBe(400); // a test example
    expect(await bad({ technique: "few_shot", system: "{{examples}}", fewShotExampleIds: [id("p_002")] })).toBe(201);

    // Roles and tenancy.
    const viewer = await newMember(browser);
    await addToWorkspace(owner, orgId, viewer, "viewer");
    expect((await viewer.request.get(`${T}/prompts`)).status()).toBe(200);
    expect((await viewer.request.post(`${T}/prompts`, { data: { ...base, key: "nope" } })).status()).toBe(403);
    const stranger = await newMember(browser);
    expect((await stranger.request.get(`${T}/prompts`)).status()).toBe(404);
    await viewer.ctx.close();
    await stranger.ctx.close();
  });
});
