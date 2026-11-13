import { summaryMarkdown, type SummaryRow } from "./summaryTable";

export type MarkdownMeta = {
    runId: string;
    split: "dev" | "test";
    /** distinct examples in the run */
    examples: number;
    repeats: number;
    /** the run's date, "YYYY-MM-DD" (passed in: this module never reads the clock) */
    date: string;
    /** "YYYY-MM-DD" per model, from the run's price snapshot */
    pricesCheckedOn: string[];
    priceNotes?: string[];
    testReused: boolean;
    /** the run's notes; only the "re-scored …" lines are quoted */
    notes?: string | null;
};

export type MarkdownRow = SummaryRow & { naReason?: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11-03" → "3 Nov 2026" (no Date, no locale: identical everywhere). */
export const humanDate = (iso: string): string => {
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : iso;
};

/*
  The README table: summaryMarkdown + a caption that says what the numbers are (run, split, n, repeats,
  date, price dates) + the notes a reader needs (test reused, re-scored, n/a rows, errors). Generated
  from a stored run, never typed. The CLI and the web "Copy Markdown" print this same string.
 */
export const exportMarkdown = (rows: MarkdownRow[], meta: MarkdownMeta): string => {
    const prices = [...new Set(meta.pricesCheckedOn)].sort().map(humanDate).join(", ");
    const caption =
        `*Run ${meta.runId} · ${meta.split} split, ${meta.examples} example${meta.examples === 1 ? "" : "s"} × ${meta.repeats} repeat${meta.repeats === 1 ? "" : "s"}` +
        ` (n = ${meta.examples * meta.repeats} per row) · ${humanDate(meta.date)} · prices checked ${prices || "n/a"}` +
        `${meta.priceNotes?.length ? ` · ${[...new Set(meta.priceNotes)].join("; ")}` : ""}*`;
    const notes: string[] = [];
    if (meta.testReused) notes.push("**Test reused:** this test set was already used by an earlier run, so these are not clean final numbers.");
    for (const line of (meta.notes ?? "").split("\n")) if (line.startsWith("re-scored")) notes.push(`Re-scored from stored outputs (no model calls): ${line.replace(/^re-scored /, "")}.`);
    for (const r of rows) if (!r.summary.metrics.overall) notes.push(`${r.prompt} × ${r.model}: n/a${r.naReason ? ` (${r.naReason})` : " (nothing scored)"}.`);
    const errors = rows.reduce((n, r) => n + r.summary.errors, 0);
    if (errors > 0) notes.push(`${errors} call${errors === 1 ? "" : "s"} failed (errors are counted apart, never scored as 0).`);
    return [summaryMarkdown(rows), "", caption, ...(notes.length ? ["", ...notes.map((n) => `- ${n}`)] : [])].join("\n") + "\n";
};
