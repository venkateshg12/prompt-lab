import { z } from "zod";

/*
  The LLM judge (Phase 26): one BINARY question per result, stored apart from the deterministic scores,
  never part of `overall`, and not trusted until validated against human labels.
 */
export const DEFAULT_JUDGE_QUESTION =
    "Does the extracted title describe the same role as the posting, even if it is worded differently from the label?";

/** What the judge model must answer. Parsed without repair: anything else is a judge_error. */
export const judgeVerdictSchema = z.object({ pass: z.boolean(), reason: z.string().max(200) }).strict();
export type JudgeVerdict = z.infer<typeof judgeVerdictSchema>;

/** POST /orgs/:orgId/runs/:runId/judge */
export const startJudgeSchema = z.object({
    modelKey: z.string().min(3).max(200),
    question: z.string().trim().min(10).max(500).default(DEFAULT_JUDGE_QUESTION),
    limit: z.number().int().min(1).max(2000).default(2000),
    allowSameFamily: z.boolean().default(false),
});
export type StartJudgeBody = z.infer<typeof startJudgeSchema>;

/** PATCH …/judge/:resultId/human: the owner's (or a reviewer's) own verdict, for validation. */
export const judgeHumanSchema = z.object({ pass: z.boolean() });

/** Result.judge */
export type StoredJudge = {
    model: string;
    question: string;
    status: "ok" | "judge_error";
    pass: boolean | null;
    reason: string | null;
    raw: string | null;
    costUsdMicros: number | null;
    sameFamily: boolean;
    at: string;
    human?: { pass: boolean; by: string; at: string };
};

/** BullMQ payload: ids only. */
export const judgePayloadSchema = z.object({ orgId: z.string().uuid(), runId: z.string().uuid(), resultId: z.string().uuid(), modelKey: z.string(), question: z.string(), sameFamily: z.boolean() });
export type JudgePayload = z.infer<typeof judgePayloadSchema>;
