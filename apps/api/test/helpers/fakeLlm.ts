// ADAPT of @pt-api/test/helpers/fakeLlm.ts: job-posting answers instead of invoice pages.
import { fakeLlm, type Scripted } from "../../src/ai/providers/fake";
import { answer } from "./db";

export { fakeLlm, type Scripted };

/** A perfect answer for posting `n` (matches seedCaseStudy's labels). */
export const validPostingJson = (n: number) => JSON.stringify(answer(n));

export const pushText = (...texts: string[]) => fakeLlm.push(...texts.map((text) => ({ kind: "text" as const, text })));
