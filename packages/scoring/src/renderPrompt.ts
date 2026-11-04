import { MAX_TOKENS_BY_TECHNIQUE, fieldsList, jsonSchemaFor, type FieldRule, type Technique } from "@repo/types";
import { renderTemplate } from "./template";

export type FewShot = { ref: string; split: "dev" | "test"; input: string; expected: unknown };
export type RenderInput = {
    prompt: { technique: Technique; system: string; template: string; maxTokens?: number; temperature?: number };
    task: { instructions: string; fields: FieldRule[] };
    input: string;
    fewShots: FewShot[];
};
export type Turn = { role: "user" | "assistant"; content: string };
export type RenderedRequest = {
    system: string;
    messages: Turn[];
    structured?: { name: string; schema: Record<string, unknown> };
    temperature: number;
    maxTokens: number;
    fewShotStyle: "inline" | "multi_turn" | "none";
};

/** The expected answer with keys in field order, 2-space indent: the examples also teach the exact shape. */
export const canonical = (fields: FieldRule[], value: unknown): string =>
    JSON.stringify(
        Object.fromEntries(fields.map((f) => [f.key, (value as Record<string, unknown> | null)?.[f.key] ?? null])),
        null,
        2
    );

const EXAMPLES = /{{\s*examples\s*}}/;

/*
  Turns (prompt version, task, example) into the exact request a provider receives. The differences
  between techniques live only here and in the prompt text. Output length follows the technique
  (MAX_TOKENS_BY_TECHNIQUE: a CoT answer cut off early would be measured as invalid JSON, a budget bug
  rather than a technique result).
 */
export const renderPrompt = ({ prompt, task, input, fewShots }: RenderInput): RenderedRequest => {
    if (fewShots.some((s) => s.split !== "dev")) throw new Error("few-shot examples must come from the dev split");
    const inline = EXAMPLES.test(prompt.system + prompt.template);
    const examples = fewShots
        .map((ex, i) => `Example ${i + 1}\nInput:\n"""\n${ex.input}\n"""\nJSON:\n${canonical(task.fields, ex.expected)}`)
        .join("\n\n");
    const shared = { instructions: task.instructions, fields: fieldsList(task.fields), examples: inline ? examples : "" };
    const user = (text: string) => renderTemplate(prompt.template, { ...shared, input: text });

    // Multi-turn few-shot: each example is a user turn followed by an assistant turn with its expected JSON.
    const prior: Turn[] =
        !inline && prompt.technique === "few_shot"
            ? fewShots.flatMap((ex) => [
                  { role: "user" as const, content: user(ex.input) },
                  { role: "assistant" as const, content: canonical(task.fields, ex.expected) },
              ])
            : [];

    return {
        system: renderTemplate(prompt.system, shared),
        messages: [...prior, { role: "user", content: user(input) }],
        structured: prompt.technique === "structured" ? { name: "answer", schema: jsonSchemaFor(task.fields) } : undefined,
        temperature: prompt.temperature ?? 0,
        maxTokens: prompt.maxTokens ?? MAX_TOKENS_BY_TECHNIQUE[prompt.technique],
        fewShotStyle: fewShots.length === 0 ? "none" : inline ? "inline" : "multi_turn",
    };
};
