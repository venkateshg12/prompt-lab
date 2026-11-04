import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { signupAndVerify } from "./helpers/signup";
import { resetRateLimits } from "./helpers/rateLimits";
import { API, firstOrgId } from "./helpers/workspace";

const taskFile = JSON.parse(readFileSync(path.resolve(__dirname, "../../../cases/job-postings/task.json"), "utf8"));
const answer = {
  title: "Dev", company: "Co", location: "Pune", remote: "remote", employment_type: "full_time",
  experience_years_min: 1, skills: ["react"], stipend_or_salary: null,
};
const rows = Array.from({ length: 6 }, (_, i) => ({
  id: `jp_00${i + 1}`, split: i < 4 ? "dev" : "test", tags: [], input: `posting ${i + 1}`, expected: { ...answer, company: `Co${i + 1}` },
}));

type Preview = {
  data: { system: string; messages: { role: string; content: string }[]; fewShotStyle: string; maxTokens: number; structured?: { schema: { properties: object } } };
};

test.describe("Phase 15 — technique rendering and the probe endpoint (real session)", () => {
  test.beforeEach(async () => {
    await resetRateLimits();
  });

  test("each technique renders its own request; the probe endpoint is platform-admin only", async ({ page }) => {
    await signupAndVerify(page);
    const req = page.context().request;
    const orgId = await firstOrgId(req);
    const task = (await (await req.post(`${API}/orgs/${orgId}/tasks`, { data: taskFile })).json()) as { data: { task: { id: string } } };
    const T = `${API}/orgs/${orgId}/tasks/${task.data.task.id}`;
    await req.post(`${T}/examples/import`, { data: { format: "jsonl", content: rows.map((r) => JSON.stringify(r)).join("\n"), dryRun: false } });
    const ex = ((await (await req.get(`${T}/examples?limit=10`)).json()) as { data: { id: string; ref: string }[] }).data;
    const id = (ref: string) => ex.find((e) => e.ref === ref)!.id;
    const shots = ["jp_001", "jp_002", "jp_003"].map(id);

    const make = async (key: string, technique: string, system: string, template: string, fewShotExampleIds: string[] = []) => {
      const res = await req.post(`${T}/prompts`, { data: { key, technique, system, template, fewShotExampleIds } });
      expect(res.status()).toBe(201);
      return ((await res.json()) as { data: { id: string } }).data.id;
    };
    const preview = async (promptId: string) =>
      (await (await req.get(`${T}/prompts/${promptId}/preview?exampleRef=jp_005`)).json()) as Preview;
    const base = "{{instructions}}\n\nFields:\n{{fields}}";

    // few_shot, inline: {{examples}} in the system text
    const inline = await preview(await make("fs-inline", "few_shot", `${base}\n\n{{examples}}`, "Input: {{input}}", shots));
    expect(inline.data.fewShotStyle).toBe("inline");
    for (const n of [1, 2, 3]) expect(inline.data.system).toContain(`Example ${n}`);
    expect(inline.data.messages).toHaveLength(1);

    // few_shot, multi-turn: no {{examples}} placeholder, so each example is a user turn + an assistant turn
    const multi = await preview(await make("fs-multi", "few_shot", base, "Input: {{input}}", shots));
    expect(multi.data.fewShotStyle).toBe("multi_turn");
    expect(multi.data.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant", "user", "assistant", "user"]);
    expect(multi.data.messages.at(-1)!.content).toContain("posting 5");
    expect(JSON.parse(multi.data.messages[1]!.content)).toMatchObject({ company: "Co1" });

    // cot: its own token budget, and the reply is expected between <json> tags
    const cot = await preview(await make("cot", "cot", base, 'Posting: {{input}}\nThen answer between <json> and </json>.'));
    expect(cot.data.maxTokens).toBe(2000);
    expect(cot.data.messages.at(-1)!.content.trim().endsWith("</json>.")).toBe(true);

    // structured: the schema derived from the task's rules rides along (8 fields)
    const structured = await preview(await make("structured", "structured", base, "Posting: {{input}}"));
    expect(Object.keys(structured.data.structured!.schema.properties)).toHaveLength(8);
    expect(structured.data.maxTokens).toBe(800);

    // zero_shot: nothing extra
    const zero = await preview(await make("zero", "zero_shot", base, "Posting: {{input}}"));
    expect(zero.data).toMatchObject({ fewShotStyle: "none", maxTokens: 800 });
    expect(zero.data.structured).toBeUndefined();

    // A normal user can't run the probe; GET /models still works.
    const probe = await req.post(`${API}/admin/models/probe`, { data: { modelKey: "fake:text" } });
    expect(probe.status()).toBe(403);
  });
});
