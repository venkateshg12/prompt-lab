import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { signupAndVerify } from "./helpers/signup";
import { resetRateLimits } from "./helpers/rateLimits";
import { API, addToWorkspace, firstOrgId, newMember } from "./helpers/workspace";

const taskFile = JSON.parse(readFileSync(path.resolve(__dirname, "../../../cases/job-postings/task.json"), "utf8"));

const posting = (i: number, extra: Record<string, unknown> = {}) => ({
  id: `e2e_${String(i).padStart(3, "0")}`,
  tags: i % 2 ? ["salary_lpa"] : ["salary_hidden"],
  input: `Posting ${i}: hiring an engineer. Skills: react, node.`,
  expected: {
    title: "Engineer", company: `Co${i}`, location: "Pune", remote: "onsite", employment_type: "full_time",
    experience_years_min: 2, skills: ["react", "node.js"], stipend_or_salary: null,
  },
  ...extra,
});
const jsonl = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

test.describe("Phase 12 — test sets (real sessions: owner + invited reviewer)", () => {
  test.beforeEach(async () => {
    await resetRateLimits();
  });

  test("import preview → commit, revisions, auto-split, blind second labels + agreement, export, roles", async ({
    page,
    browser,
  }) => {
    await signupAndVerify(page);
    const owner = page.context().request;
    const orgId = await firstOrgId(owner);
    const task = (await (await owner.post(`${API}/orgs/${orgId}/tasks`, { data: taskFile })).json()) as { data: { task: { id: string } } };
    const E = `${API}/orgs/${orgId}/tasks/${task.data.task.id}/examples`;

    // 1. A dry run reports every bad row by line; committing a file with bad rows writes nothing.
    const bad = jsonl([posting(1), posting(2, { expected: { ...posting(2).expected, remote: "wfh" } })]) + "{broken\n";
    const preview = (await (await owner.post(`${E}/import`, { data: { format: "jsonl", content: bad, dryRun: true } })).json()) as {
      data: { valid: number; invalid: { line: number; issues: string[] }[] };
    };
    expect(preview.data.valid).toBe(1);
    expect(preview.data.invalid.map((i) => i.line)).toEqual([2, 3]);
    const refused = (await (await owner.post(`${E}/import`, { data: { format: "jsonl", content: bad, dryRun: false } })).json()) as { data: { dryRun: boolean } };
    expect(refused.data.dryRun).toBe(true);
    expect(((await (await owner.get(E)).json()) as { data: unknown[] }).data).toHaveLength(0);

    // 2. A good file commits; re-import is a no-op; one edited label is exactly one change + a revision.
    const rows = Array.from({ length: 20 }, (_, i) => posting(i + 1));
    const commit = (content: string) =>
      owner.post(`${E}/import`, { data: { format: "jsonl", content, dryRun: false } }).then((r) => r.json()) as Promise<{
        data: { dryRun: boolean; new: number; changed: number; unchanged: number };
      }>;
    expect((await commit(jsonl(rows))).data).toMatchObject({ dryRun: false, new: 20, changed: 0, unchanged: 0 });
    expect((await commit(jsonl(rows))).data).toMatchObject({ new: 0, changed: 0, unchanged: 20 });
    const edited = rows.map((r) => (r.id === "e2e_003" ? { ...r, expected: { ...r.expected, company: "Renamed Ltd" } } : r));
    expect((await commit(jsonl(edited))).data).toMatchObject({ new: 0, changed: 1, unchanged: 19 });

    type Ex = { id: string; ref: string; revision: number; split: string; tags: string[]; expectedHidden: boolean };
    const list = async (req = owner) => ((await (await req.get(`${E}?limit=100`)).json()) as { data: Ex[] }).data;
    expect((await list()).find((e) => e.ref === "e2e_003")!.revision).toBe(2);

    // 3. Files without a split are marked unsplit; auto-split gives both splits every tag, and is stable.
    const split = (await (await owner.post(`${E}/split`, { data: {} })).json()) as { data: { assigned: number; dev: number; test: number } };
    expect(split.data.assigned).toBe(20);
    expect(split.data.dev).toBeGreaterThanOrEqual(5);
    expect(split.data.test).toBeGreaterThan(split.data.dev);
    const examples = await list();
    for (const tag of ["salary_lpa", "salary_hidden"]) {
      const withTag = examples.filter((e) => e.tags.includes(tag));
      expect(new Set(withTag.map((e) => e.split))).toEqual(new Set(["dev", "test"]));
    }
    const again = (await (await owner.post(`${E}/split`, { data: {} })).json()) as { data: { assigned: number } };
    expect(again.data.assigned).toBe(0); // nothing left unsplit: a re-run never reshuffles

    // 4. A reviewer labels blind: expected is withheld until their own label is in; roles are enforced.
    const reviewer = await newMember(browser);
    await addToWorkspace(owner, orgId, reviewer, "reviewer");
    const blind = await list(reviewer.request);
    expect(blind.every((e) => e.expectedHidden)).toBe(true);
    const target = examples.find((e) => e.ref === "e2e_001")!;
    const own = (await (await owner.get(`${E}/${target.id}`)).json()) as { data: { expected: Record<string, unknown> } };
    const agree = await reviewer.request.put(`${E}/${target.id}/second-label`, { data: { label: own.data.expected } });
    expect(agree.status()).toBe(200);
    const target2 = examples.find((e) => e.ref === "e2e_002")!;
    const own2 = (await (await owner.get(`${E}/${target2.id}`)).json()) as { data: { expected: Record<string, unknown> } };
    await reviewer.request.put(`${E}/${target2.id}/second-label`, { data: { label: { ...own2.data.expected, remote: "hybrid" } } });
    const revealed = (await (await reviewer.request.get(`${E}/${target.id}`)).json()) as { data: { expectedHidden: boolean } };
    expect(revealed.data.expectedHidden).toBe(false);

    const agreement = (await (await owner.get(`${E}/agreement`)).json()) as {
      data: { examples: number; fields: { key: string; agree: number; total: number; disagreements: string[] }[] };
    };
    expect(agreement.data.examples).toBe(2);
    expect(agreement.data.fields.find((f) => f.key === "remote")).toMatchObject({ agree: 1, total: 2, disagreements: ["e2e_002"] });
    expect(agreement.data.fields.find((f) => f.key === "title")).toMatchObject({ agree: 2, total: 2 });

    // A reviewer can add second labels but can't edit labels or import; a label that fails the schema is a 400.
    expect((await reviewer.request.patch(`${E}/${target.id}`, { data: { tags: [] } })).status()).toBe(403);
    expect((await reviewer.request.post(`${E}/import`, { data: { format: "jsonl", content: "", dryRun: true } })).status()).toBe(403);
    expect((await reviewer.request.put(`${E}/${target.id}/second-label`, { data: { label: { remote: "wfh" } } })).status()).toBe(400);

    // 5. Export is the Playbook's case-line shape, and private inputs are hidden in the public export.
    await owner.patch(`${E}/${target.id}`, { data: { publicInput: false } });
    const pub = await (await owner.get(`${E}/export.jsonl?public=true`)).text();
    const lines = pub.trim().split("\n").map((l) => JSON.parse(l) as { id: string; split: string; input: string; tags: string[] });
    expect(lines).toHaveLength(20);
    expect(lines.find((l) => l.id === "e2e_001")!.input).toBe("[hidden]");
    expect(lines.every((l) => ["dev", "test"].includes(l.split) && !l.tags.includes("_unsplit"))).toBe(true);

    // 6. A body over 3 MB is a 413; a stranger's workspace is a 404.
    const huge = `{"format":"jsonl","dryRun":true,"content":"${"a".repeat(4_200_000)}"}`;
    const tooBig = await owner.post(`${E}/import`, { data: huge, headers: { "content-type": "application/json" } });
    expect(tooBig.status()).toBe(413);
    const stranger = await newMember(browser);
    expect((await stranger.request.get(E)).status()).toBe(404);
    await reviewer.ctx.close();
    await stranger.ctx.close();
  });
});
