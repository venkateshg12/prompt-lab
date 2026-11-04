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
// GET /__stats -> { calls } ; POST /__reset zeroes it. Auth: `Bearer e2e-key`, else 403 (like NIM).
const http = require("node:http");

const PORT = Number(process.env.NIM_STUB_PORT || 5997);
let calls = 0;
const seen = new Map(); // `${model}|${posting}` -> times seen (for flaky2)

const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

http
  .createServer((req, res) => {
    if (req.url === "/__health") return send(res, 200, { ok: true });
    if (req.url === "/__stats") return send(res, 200, { calls });
    if (req.url === "/__reset" && req.method === "POST") {
      calls = 0;
      seen.clear();
      return send(res, 200, { ok: true });
    }
    if (req.url === "/models") return send(res, 200, { data: [{ id: "openai/gpt-oss-20b" }, { id: "nvidia/nemotron-3-super-120b-a12b" }] });
    if (req.url !== "/chat/completions" || req.method !== "POST") return send(res, 404, { error: "not found" });

    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      calls++;
      if (req.headers.authorization !== "Bearer e2e-key") return send(res, 403, { error: "forbidden" });
      const body = JSON.parse(raw || "{}");
      const last = (body.messages || []).filter((m) => m.role === "user").pop();
      const text = last ? String(last.content) : "";
      const ans = /<<ANS\s*([\s\S]*?)\s*>>/.exec(text);
      const mode = (/<<MODE\s+(\w+)\s*>>/.exec(text) || [])[1];
      const json = ans ? ans[1] : "{}";
      const key = `${body.model}|${text}`;
      const n = (seen.get(key) || 0) + 1;
      seen.set(key, n);

      const reply = (content) =>
        send(res, 200, {
          choices: [{ message: { content }, finish_reason: "stop" }],
          usage: { prompt_tokens: 100 + Math.ceil(text.length / 4), completion_tokens: 50 + Math.ceil(content.length / 4) },
        });

      if (mode === "400") return send(res, 400, { error: "bad request" });
      if (mode === "503") return send(res, 503, { error: "unavailable" });
      if (mode === "flaky2" && n <= 2) return send(res, 429, { error: "slow down" });
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
