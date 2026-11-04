import type { Technique } from "@repo/types";

const FENCE = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;
const stripFence = (text: string): string => {
    const m = text.trim().match(FENCE);
    return m ? m[1]! : text.trim();
};

/*
  The text the scorer will try to parse. A code fence is presentation, so it is removed; anything else
  is repair, so it is not: prose around an object, a missing bracket or a trailing comma all stay as
  they are. For chain-of-thought the answer is the LAST <json>…</json> block, so a model that drafts an
  answer and then corrects it is judged on its final one. No block → null.
 */
export const extractCandidate = (rawText: string, technique: Technique): string | null => {
    if (technique === "cot") {
        const blocks = [...rawText.matchAll(/<json>\s*([\s\S]*?)\s*<\/json>/gi)];
        return blocks.length === 0 ? null : stripFence(blocks[blocks.length - 1]![1]!);
    }
    return stripFence(rawText);
};

/** A JSON OBJECT, or null (arrays, scalars and non-JSON are all "not valid"). */
export const parseObject = (candidate: string | null): Record<string, unknown> | null => {
    if (candidate === null) return null;
    try {
        const v: unknown = JSON.parse(candidate);
        return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
        return null;
    }
};
