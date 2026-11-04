import { PLACEHOLDER_RE, fieldsList, type FieldRule, type Placeholder } from "@repo/types";

export { fieldsList };

// One pass over the TEMPLATE: substituted values are never scanned again, so a posting that contains
// the text `{{instructions}}` is not expanded.
export const renderTemplate = (template: string, values: Partial<Record<Placeholder, string>>) =>
    template.replace(PLACEHOLDER_RE, (_m, name: string) => values[name as Placeholder] ?? "");

export type FewShot = { input: string; expected: unknown };

// Generic block. Phase 15 wraps it per technique (CoT shows the reasoning tag format).
export const examplesBlock = (shots: FewShot[]) =>
    shots
        .map((s, i) => `Example ${i + 1}\nInput:\n"""\n${s.input}\n"""\nOutput:\n${JSON.stringify(s.expected)}`)
        .join("\n\n");

export const renderPrompt = (
    prompt: { system: string; template: string },
    task: { instructions: string; fields: FieldRule[] },
    input: string,
    shots: FewShot[]
) => {
    const shared = { instructions: task.instructions, fields: fieldsList(task.fields), examples: examplesBlock(shots) };
    return {
        system: renderTemplate(prompt.system, shared), // no {{input}} in system: it would be ignored
        messages: [{ role: "user" as const, content: renderTemplate(prompt.template, { ...shared, input }) }],
    };
};
