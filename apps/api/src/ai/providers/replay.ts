import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CompleteResult, Provider } from "../types";
import { ReplayMiss } from "../errors";
import { requestKey } from "./fake";
import { REPLAY_DIR } from "../../constants/env";

export type ReplayOptions = { dir?: string; fallback?: Provider; recordOnMiss?: boolean };

/*
  Answers from recorded files: same layout as the fake provider's fixtures, `{ text, usage, finishReason }`
  under sha256(model.key + request), where the request includes the SYSTEM prompt (changing only the
  system prompt must be a miss). With a fallback and `recordOnMiss`, real answers are recorded (Phase 29).
 */
export const createReplayProvider = (options: ReplayOptions = {}): Provider => ({
    async complete(model, req, apiKey) {
        const dir = options.dir ?? REPLAY_DIR;
        const key = requestKey(model, req);
        const file = join(dir, `${key}.json`);
        if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as CompleteResult;
        if (!options.fallback) throw new ReplayMiss(key);
        const result = await options.fallback.complete(model, req, apiKey);
        if (options.recordOnMiss) {
            mkdirSync(dir, { recursive: true });
            writeFileSync(file, JSON.stringify(result, null, 2));
        }
        return result;
    },
});

export const replayProvider = createReplayProvider();
