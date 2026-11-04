import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Provider, CompleteRequest } from "../types";
import type { ModelConfig } from "../../config/models.config";
import { FAKE_LLM_FIXTURES, FAKE_LLM_SCRIPT } from "../../constants/env";
import { FAKE_SCRIPTS, type Scripted } from "./fakeScripts";

export type { Scripted };

const queue: Scripted[] = [];
let always: string | null = null;
let scriptLoaded = false;
const calls: { model: string; system: string; messages: CompleteRequest["messages"]; temperature: number; maxTokens: number }[] = [];

// Test controls. Each scripted item answers exactly one call, in order.
export const fakeLlm = {
    push: (...items: Scripted[]) => queue.push(...items),
    /** Every call answers `text` once the queue is empty. */
    alwaysReturn: (text: string | null) => {
        always = text;
    },
    reset: () => {
        queue.length = 0;
        calls.length = 0;
        always = null;
        scriptLoaded = false;
    },
    calls: () => [...calls],
};

/** The key a recorded answer is stored under. The system prompt is part of it. */
export const requestKey = (model: ModelConfig, req: Pick<CompleteRequest, "system" | "messages" | "temperature" | "maxTokens" | "structured">) =>
    createHash("sha256")
        .update(
            model.key +
                JSON.stringify({
                    system: req.system,
                    messages: req.messages,
                    temperature: req.temperature,
                    maxTokens: req.maxTokens,
                    structured: req.structured,
                })
        )
        .digest("hex");

const loadScript = () => {
    if (scriptLoaded) return;
    scriptLoaded = true;
    if (FAKE_LLM_SCRIPT) {
        const script = FAKE_SCRIPTS[FAKE_LLM_SCRIPT];
        if (!script) throw new Error(`Unknown FAKE_LLM_SCRIPT "${FAKE_LLM_SCRIPT}"`);
        queue.push(...script());
    }
};

export const fakeProvider: Provider = {
    async complete(model, req) {
        loadScript();
        calls.push({ model: model.key, system: req.system, messages: req.messages, temperature: req.temperature, maxTokens: req.maxTokens });
        const item = queue.shift();
        if (item?.kind === "error") throw item.error;
        let text = "{}";
        if (item?.kind === "text") {
            text = item.text;
        } else if (always !== null) {
            text = always;
        } else if (FAKE_LLM_FIXTURES) {
            const file = path.resolve(FAKE_LLM_FIXTURES, `${requestKey(model, req)}.json`);
            if (fs.existsSync(file)) text = (JSON.parse(fs.readFileSync(file, "utf8")) as { text: string }).text;
        }
        return { text, usage: { inputTokens: 1000, outputTokens: 200 }, finishReason: "stop" };
    },
};
