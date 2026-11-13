/* eslint-disable */
// A deterministic stand-in for NVIDIA NIM's Chat Completions endpoint, for E2E only: no real model, no cost.
//
// It is an ORACLE. Each test posting carries its answer as a marker, `<<ANS {json} >>`, and the stub replies
// with that JSON. Behaviour markers change HOW it replies, so the real queue, worker, scorer, database and
// SSE can be exercised against known answers:
//   <<MODE prose>>   wraps the JSON in prose                       -> invalid JSON, scored 0
//   <<MODE fence>>   wraps the JSON in a ```json fence             -> valid (a fence is presentation)
//   <<MODE bad>>     replies with text that is not JSON            -> invalid JSON
//   <<MODE 400>>     answers HTTP 400 every time                   -> an `error` cell (never retried)
//   <<MODE 503>>     answers HTTP 503 every time                   -> retried, then an `error` cell
//   <<MODE flaky2>>  answers HTTP 429 twice, then succeeds         -> attempts: 3
//   <<MODE slow>>    waits 400 ms before answering                 -> lets a test cancel mid-run
//   <<MODE alt>>     every 2nd call for the same prompt answers remote "hybrid" -> an inconsistent field across repeats
//   <<PATCH {json} >> (e.g. in a prompt TEMPLATE) is merged into the answer   -> two prompts that answer differently
//   <<MODE 410>>     answers HTTP 410 (a retired model)            -> ModelRetired
//   <<MODE 429>>     answers HTTP 429 every time                   -> retried, then rate-limited
//   <<JUDGE fail|garbage>> when the request is a JUDGE call (system prompt "You are grading…"): the verdict to
//                    give for that posting (default pass); garbage is not JSON        -> judge_error
// GET /__stats -> { calls, byKey: { server, visitor, other } } ; POST /__reset zeroes it.
// Auth: `Bearer e2e-key` (the server's key) or the one demo visitor key below, else 403 (like NIM).
const http = require("node:http");

const PORT = Number(process.env.NIM_STUB_PORT || 5997);
let calls = 0;
const VISITOR_KEY = "nvapi-e2e-visitor-key-0123456789abcdef";
let byKey = { server: 0, visitor: 0, other: 0 };
const seen = new Map(); // `${model}|${posting}` -> times seen (for flaky2)

const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

http
  .createServer((req, res) => {
    if (req.url === "/__health") return send(res, 200, { ok: true });
    if (req.url === "/__stats") return send(res, 200, { calls, byKey });
    if (req.url === "/__reset" && req.method === "POST") {
      calls = 0;
      byKey = { server: 0, visitor: 0, other: 0 };
      seen.clear();
      return send(res, 200, { ok: true });
    }
    if (req.url === "/models") return send(res, 200, { data: [{ id: "openai/gpt-oss-20b" }, { id: "nvidia/nemotron-3-super-120b-a12b" }] });
    if (req.url !== "/chat/completions" || req.method !== "POST") return send(res, 404, { error: "not found" });

    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      calls++;
      const auth = req.headers.authorization;
      byKey[auth === "Bearer e2e-key" ? "server" : auth === `Bearer ${VISITOR_KEY}` ? "visitor" : "other"]++;
      if (auth !== "Bearer e2e-key" && auth !== `Bearer ${VISITOR_KEY}`) return send(res, 403, { error: "forbidden", echo: auth });
      const body = JSON.parse(raw || "{}");
      const last = (body.messages || []).filter((m) => m.role === "user").pop();
      const text = last ? String(last.content) : "";
      const ans = /<<ANS\s*([\s\S]*?)\s*>>/.exec(text);
      const mode = (/<<MODE\s+(\w+)\s*>>/.exec(text) || [])[1];
      const patch = /<<PATCH\s*([\s\S]*?)\s*>>/.exec(text);
      const key0 = `${body.model}|${text}`;
      const n0 = (seen.get(key0) || 0) + 1;
      let json = ans ? ans[1] : "{}";
      if (patch || (mode === "alt" && n0 % 2 === 0)) {
        const obj = { ...JSON.parse(json), ...(patch ? JSON.parse(patch[1]) : {}), ...(mode === "alt" && n0 % 2 === 0 ? { remote: "hybrid" } : {}) };
        json = JSON.stringify(obj);
      }
      const key = `${body.model}|${text}`;
      const n = (seen.get(key) || 0) + 1;
      seen.set(key, n);

      const reply = (content) =>
        send(res, 200, {
          choices: [{ message: { content }, finish_reason: "stop" }],
          usage: { prompt_tokens: 100 + Math.ceil(text.length / 4), completion_tokens: 50 + Math.ceil(content.length / 4) },
        });

      if (mode === "400") return send(res, 400, { error: "bad request" });
      if (mode === "410") return send(res, 410, { error: "gone" });
      if (mode === "429") return send(res, 429, { error: "slow down" });
      if (mode === "503") return send(res, 503, { error: "unavailable" });
      if (mode === "flaky2" && n <= 2) return send(res, 429, { error: "slow down" });
      const system = ((body.messages || []).find((m) => m.role === "system") || {}).content || "";
      if (String(system).startsWith("You are grading")) {
        const verdict = (/<<JUDGE\s+(\w+)\s*>>/.exec(text) || [])[1] || "pass";
        if (verdict === "garbage") return reply("I think it is probably fine?");
        return reply(JSON.stringify({ pass: verdict === "pass", reason: verdict === "pass" ? "Same role." : "A different role." }));
      }
      const respond = () => {
        if (mode === "prose") return reply(`Sure! Here is the extraction: ${json}`);
        if (mode === "fence") return reply("```json\n" + json + "\n```");
        if (mode === "bad") return reply("I could not extract anything.");
        return reply(json);
      };
      if (mode === "slow") return void setTimeout(respond, 400);
      respond();
    });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`nim-stub listening on ${PORT}`));
