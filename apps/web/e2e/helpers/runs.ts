import { type APIRequestContext, type Page, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { API, firstOrgId } from "./workspace";

export const NIM = "http://127.0.0.1:5997";
export const MODEL_A = "nvidia:openai/gpt-oss-20b";
export const MODEL_B = "nvidia:nvidia/nemotron-3-super-120b-a12b";
const taskFile = JSON.parse(readFileSync(path.resolve(__dirname, "../../../../cases/job-postings/task.json"), "utf8"));

export const answer = (n: number, over: Record<string, unknown> = {}) => ({
  title: "Engineer", company: `Co${n}`, location: "Pune", remote: "onsite", employment_type: "full_time",
  experience_years_min: 2, skills: ["react", "node.js"], stipend_or_salary: null, ...over,
});

/** A test posting whose model answer is embedded as a marker (see e2e/stubs/nim-stub.js). */
export const posting = (n: number, opts: { mode?: string; give?: Record<string, unknown> } = {}) =>
  `Posting ${n}: we are hiring.\n<<ANS ${JSON.stringify(answer(n, opts.give))} >>${opts.mode ? `\n<<MODE ${opts.mode} >>` : ""}`;

export const stubStats = async (): Promise<{ calls: number; byKey: { server: number; visitor: number; other: number } }> =>
  (await fetch(`${NIM}/__stats`)).json() as Promise<{ calls: number; byKey: { server: number; visitor: number; other: number } }>;
export const VISITOR_KEY = "nvapi-e2e-visitor-key-0123456789abcdef";
export const stubReset = () => fetch(`${NIM}/__reset`, { method: "POST" });

export interface Setup {
  orgId: string;
  taskId: string;
  T: string; // /orgs/:orgId/tasks/:taskId
  exampleIds: Record<string, string>;
}

export async function createTaskWithExamples(
  req: APIRequestContext,
  examples: { id: string; split?: "dev" | "test"; input: string; expected: unknown }[]
): Promise<Setup> {
  const orgId = await firstOrgId(req);
  const task = (await (await req.post(`${API}/orgs/${orgId}/tasks`, { data: taskFile })).json()) as { data: { task: { id: string } } };
  const T = `${API}/orgs/${orgId}/tasks/${task.data.task.id}`;
  const content = examples.map((e) => JSON.stringify({ id: e.id, split: e.split ?? "dev", tags: [], input: e.input, expected: e.expected })).join("\n");
  const imported = (await (await req.post(`${T}/examples/import`, { data: { format: "jsonl", content, dryRun: false } })).json()) as { data: { new: number; invalid: unknown[] } };
  expect(imported.data.invalid).toHaveLength(0);
  const list = ((await (await req.get(`${T}/examples?limit=100`)).json()) as { data: { id: string; ref: string }[] }).data;
  return { orgId, taskId: task.data.task.id, T, exampleIds: Object.fromEntries(list.map((e) => [e.ref, e.id])) };
}

export async function createPrompt(req: APIRequestContext, T: string, key: string, template: string, technique = "zero_shot"): Promise<string> {
  const res = await req.post(`${T}/prompts`, {
    data: { key, technique, system: "{{instructions}}\n\nFields:\n{{fields}}", template },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { data: { id: string } }).data.id;
}

export interface RunDto {
  id: string; status: string; totalCells: number; doneCells: number; errorCells: number; testReused: boolean;
  variants: { id: string; versionId: string; modelKey: string; scored: number; errors: number; skipped: number }[];
  progressByModel: { modelKey: string; done: number; errors: number }[];
}

export async function waitForRun(req: APIRequestContext, orgId: string, runId: string, until: (r: RunDto) => boolean, timeoutMs = 90_000): Promise<RunDto> {
  const deadline = Date.now() + timeoutMs;
  let last: RunDto | undefined;
  while (Date.now() < deadline) {
    last = ((await (await req.get(`${API}/orgs/${orgId}/runs/${runId}`)).json()) as { data: RunDto }).data;
    if (until(last)) return last;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Run ${runId} did not reach the expected state in ${timeoutMs} ms; last: ${JSON.stringify(last)}`);
}

/** Opens the run's SSE stream inside the page (cookies + CORS like the real UI) and returns every message until `until`. */
export async function collectProgress(page: Page, orgId: string, runId: string, terminal: string[] = ["completed"]) {
  return page.evaluate(
    ({ url, terminal }) =>
      new Promise<{ status: string; doneCells: number; totalCells: number }[]>((resolve, reject) => {
        const seen: { status: string; doneCells: number; totalCells: number }[] = [];
        const es = new EventSource(url, { withCredentials: true });
        const timer = setTimeout(() => { es.close(); reject(new Error("SSE timeout")); }, 90_000);
        es.addEventListener("progress", (e) => {
          const m = JSON.parse((e as MessageEvent).data);
          seen.push({ status: m.status, doneCells: m.doneCells, totalCells: m.totalCells });
          if (terminal.includes(m.status)) { clearTimeout(timer); es.close(); resolve(seen); }
        });
        es.onerror = () => { /* EventSource reconnects by itself */ };
      }),
    { url: `${API}/orgs/${orgId}/runs/${runId}/events`, terminal }
  );
}
