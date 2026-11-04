import { renderPrompt } from "@repo/scoring";
import { fieldRulesSchema, type FieldRule, type Technique } from "@repo/types";
import { prisma } from "../db/prisma";
import type { PromptVersion } from "../generated/prisma/client";

/*
  The rendered prompt of one variant, frozen with the run. Cells render only the final user turn, by
  swapping the input into `userTemplate` (everything else was resolved when the run was created), so a
  few-shot label edited mid-run can't change what later cells see, and the error browser can show
  exactly what the model received.
 */
export const INPUT_SENTINEL = "__PL_INPUT__"; // private-use chars: safe in jsonb, never in a posting

export type Turn = { role: "user" | "assistant"; content: string };
export type VariantSnapshot = {
    promptVersionId: string;
    versionId: string; // "v2-few-shot@1"
    technique: Technique;
    system: string;
    priorTurns: Turn[]; // multi-turn few-shot examples
    userTemplate: string; // the final user turn with INPUT_SENTINEL where the input goes
    structured?: { name: string; schema: Record<string, unknown> };
    temperature: number;
    maxTokens: number;
    fewShotStyle: "inline" | "multi_turn" | "none";
    fewShotRefs: string[];
};

export const buildSnapshots = async (
    task: { instructions: string; fields: unknown },
    prompts: PromptVersion[],
    temperature: number
): Promise<Record<string, VariantSnapshot>> => {
    const fields: FieldRule[] = fieldRulesSchema.parse(task.fields);
    const shotIds = [...new Set(prompts.flatMap((p) => p.fewShotExampleIds))];
    // CURRENT labels, read once: the snapshot is what freezes them for this run.
    const shotRows = shotIds.length ? await prisma.example.findMany({ where: { id: { in: shotIds } } }) : [];
    const snapshots: Record<string, VariantSnapshot> = {};
    for (const p of prompts) {
        const fewShots = p.fewShotExampleIds.map((id) => {
            const row = shotRows.find((r) => r.id === id);
            if (!row) throw new Error(`Few-shot example ${id} no longer exists`);
            return { ref: row.ref, split: row.split, input: row.input, expected: row.expected };
        });
        const rendered = renderPrompt({ prompt: p, task: { instructions: task.instructions, fields }, input: INPUT_SENTINEL, fewShots });
        snapshots[p.id] = {
            promptVersionId: p.id,
            versionId: `${p.key}@${p.version}`,
            technique: p.technique,
            system: rendered.system,
            priorTurns: rendered.messages.slice(0, -1),
            userTemplate: rendered.messages[rendered.messages.length - 1]!.content,
            structured: rendered.structured,
            temperature,
            maxTokens: rendered.maxTokens,
            fewShotStyle: rendered.fewShotStyle,
            fewShotRefs: fewShots.map((s) => s.ref),
        };
    }
    return snapshots;
};

/** The final user turn for one example. split/join (not a regex) so the input is inserted verbatim. */
export const userTurnFor = (snapshot: Pick<VariantSnapshot, "userTemplate">, input: string): string =>
    snapshot.userTemplate.split(INPUT_SENTINEL).join(input);
