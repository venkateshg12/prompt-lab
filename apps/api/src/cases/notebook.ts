/*
  EXPERIMENT.md, the lab notebook (Phase 25), has three machine-checked parts:
    - run ids (any UUID in the text) must exist;
    - every "### C<n>: …" change block has Hypothesis, Change, Delta and Decision (keep | revert) lines;
    - "Lesson 7 picks: <ISO time> · ref, ref, …" exists and predates the first run that used v1-thorough.
  This module only parses; check-notebook.ts asks the database.
 */
export type NotebookChange = { title: string; missing: string[]; decision: "keep" | "revert" | null };
export type Notebook = { runIds: string[]; picks: { at: Date; refs: string[] } | null; changes: NotebookChange[] };

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const FIELDS = ["Hypothesis", "Change", "Delta", "Decision"] as const;

export const parseNotebook = (md: string): Notebook => {
    const runIds = [...new Set((md.match(UUID) ?? []).map((u) => u.toLowerCase()))];
    const pickLine = /^Lesson 7 picks:\s*(\S+)\s*·\s*(.+)$/m.exec(md);
    const at = pickLine ? new Date(pickLine[1]!) : null;
    const picks = pickLine && at && !isNaN(at.getTime()) ? { at, refs: pickLine[2]!.split(",").map((r) => r.trim()).filter(Boolean) } : null;
    const blocks = md.split(/^### /m).slice(1).filter((b) => /^C\d+:/.test(b));
    const changes = blocks.map((b) => {
        const title = b.split("\n")[0]!.trim();
        const has = (f: string) => new RegExp(`^-?\\s*${f}:\\s*\\S`, "m").test(b);
        const decision = /^-?\s*Decision:\s*(keep|revert)\b/im.exec(b)?.[1]?.toLowerCase() as "keep" | "revert" | undefined;
        const missing = FIELDS.filter((f) => !has(f));
        if (has("Decision") && !decision) missing.push("Decision (keep | revert)" as never);
        return { title, missing, decision: decision ?? null };
    });
    return { runIds, picks, changes };
};
