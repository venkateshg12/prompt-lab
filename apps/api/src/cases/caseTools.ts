import { parse } from "csv-parse/sync";
import { seededRandom } from "@repo/scoring";
import { answerSchemaFor, tagSchema, type FieldRule } from "@repo/types";

/*
  Phase 24's dataset tools, pure so they are unit-tested: labelling sheet → case lines, the stratified
  split, the second-labeller sample, and the public-text gate. The scripts in src/scripts/ only read and
  write files around these.
 */

export type CaseLineOut = { id: string; split?: "dev" | "test"; tags: string[]; input: string; expected: Record<string, unknown>; publicInput?: boolean; notes?: string };

/* ── Sheet → case lines ─────────────────────────────────────────────────────────────────────────── */

const MONEY_SHORTHAND = /^(\d+(?:\.\d+)?)?\s*(?:-|–|\.\.)?\s*(\d+(?:\.\d+)?)?\s+([A-Za-z]{3})\s*\/?\s*(hour|day|week|month|year)$/;

/** One sheet cell → the field's value. Empty means null (or [] for a set). Money: JSON, or "600000-800000 INR year", "-25000 INR month" (max only). */
export const parseCell = (rule: FieldRule, raw: string | undefined): unknown => {
    const v = (raw ?? "").trim();
    switch (rule.kind) {
        case "text":
            return v === "" ? null : v;
        case "enum":
            return v;
        case "integer":
            return v === "" ? null : Number(v);
        case "boolean":
            return v === "" ? null : /^(true|yes|y|1)$/i.test(v) ? true : /^(false|no|n|0)$/i.test(v) ? false : v;
        case "set_f1":
            return v === "" ? [] : v.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
        case "money": {
            if (v === "" || v.toLowerCase() === "null") return null;
            if (v.startsWith("{")) return JSON.parse(v);
            const m = MONEY_SHORTHAND.exec(v);
            if (!m) return v; // the schema check reports it
            const [, a, b, currency, period] = m;
            const single = a !== undefined && b === undefined && !/[-–]|\.\./.test(v);
            return { min: a !== undefined ? Number(a) : null, max: single ? Number(a) : b !== undefined ? Number(b) : null, currency: currency!.toUpperCase(), period };
        }
    }
};

export class SheetError extends Error {
    constructor(readonly row: number, readonly id: string, readonly detail: string) {
        super(`row ${row} (${id}): ${detail}`);
    }
}

/**
 * The labelling sheet's CSV (columns: id, split?, tags, input, notes?, publicInput?, then one column per
 * field key) → case lines. Every `expected` is checked against the task's answer schema; the first invalid
 * row throws with its row number and the Zod path.
 */
export const sheetToCaseLines = (csv: string, fields: FieldRule[]): CaseLineOut[] => {
    const records = parse(csv, { columns: true, skip_empty_lines: true, bom: true, info: true }) as { record: Record<string, string>; info: { lines: number } }[];
    const schema = answerSchemaFor(fields);
    const seen = new Set<string>();
    return records.map(({ record, info }) => {
        const id = (record.id ?? "").trim();
        if (!id) throw new SheetError(info.lines, "?", "missing id");
        if (seen.has(id)) throw new SheetError(info.lines, id, "duplicate id");
        seen.add(id);
        for (const f of fields) if (!(f.key in record)) throw new SheetError(info.lines, id, `no column for field "${f.key}"`);
        let expected: Record<string, unknown>;
        try {
            expected = Object.fromEntries(fields.map((f) => [f.key, parseCell(f, record[f.key])]));
        } catch (e) {
            throw new SheetError(info.lines, id, `unreadable cell: ${(e as Error).message}`);
        }
        const checked = schema.safeParse(expected);
        if (!checked.success) {
            const issue = checked.error.issues[0]!;
            throw new SheetError(info.lines, id, `expected.${issue.path.join(".")}: ${issue.message}`);
        }
        const tags = (record.tags ?? "").split(/[;,\s]+/).map((t) => t.trim()).filter(Boolean);
        for (const t of tags) if (!tagSchema.safeParse(t).success) throw new SheetError(info.lines, id, `bad tag "${t}" (a-z, 0-9, _)`);
        const split = record.split?.trim();
        if (split && split !== "dev" && split !== "test") throw new SheetError(info.lines, id, `split must be dev or test, got "${split}"`);
        const input = (record.input ?? "").trim();
        if (!input) throw new SheetError(info.lines, id, "empty input");
        const pub = record.publicInput?.trim();
        return {
            id,
            ...(split ? { split: split as "dev" | "test" } : {}),
            tags,
            input,
            expected,
            ...(pub ? { publicInput: !/^(false|no|0)$/i.test(pub) } : {}),
            ...(record.notes?.trim() ? { notes: record.notes.trim() } : {}),
        };
    });
};

/* ── Stratified split ───────────────────────────────────────────────────────────────────────────── */

const seededShuffle = <T>(xs: T[], seed: number): T[] => {
    const rnd = seededRandom(seed);
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
};

/**
 * Assigns dev/test so that every tag lands in both splits in about the overall proportion. Deterministic
 * for a seed: lines are shuffled with it, the rarest-tagged lines are placed first, and each goes to dev
 * while dev is short and its tags are under their dev target.
 */
export const stratifiedSplit = <T extends { id: string; tags: string[] }>(lines: T[], opts: { dev: number; seed: number }): (T & { split: "dev" | "test" })[] => {
    const share = opts.dev / lines.length;
    const tagCount = new Map<string, number>();
    for (const l of lines) for (const t of l.tags) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
    const rarity = (l: T) => Math.min(...l.tags.map((t) => tagCount.get(t)!), Infinity);
    const order = seededShuffle(lines, opts.seed).sort((a, b) => rarity(a) - rarity(b));
    const devTag = new Map<string, number>();
    const split = new Map<string, "dev" | "test">();
    let dev = 0;
    for (const l of order) {
        // Decided by the line's RAREST tag: summing over all tags let common tags outvote rare ones.
        const rarest = [...l.tags].sort((a, b) => tagCount.get(a)! - tagCount.get(b)!)[0];
        const deficit = rarest === undefined ? 0 : Math.round(tagCount.get(rarest)! * share) - (devTag.get(rarest) ?? 0);
        const remaining = order.length - split.size;
        const mustDev = opts.dev - dev >= remaining; // keep the total exact
        const toDev = dev < opts.dev && (mustDev || deficit > 0 || l.tags.length === 0 && dev / Math.max(split.size, 1) < share);
        split.set(l.id, toDev ? "dev" : "test");
        if (toDev) {
            dev++;
            for (const t of l.tags) devTag.set(t, (devTag.get(t) ?? 0) + 1);
        }
    }
    return lines.map((l) => ({ ...l, split: split.get(l.id)! }));
};

/** Per tag: dev and test counts, and whether test has at least `minTest` (a subset number below that is noise). */
export const splitReport = (lines: { tags: string[]; split?: string }[], minTest = 3) => {
    const rows = new Map<string, { dev: number; test: number }>();
    for (const l of lines) for (const t of l.tags) {
        const r = rows.get(t) ?? { dev: 0, test: 0 };
        if (l.split === "dev") r.dev++;
        else if (l.split === "test") r.test++;
        rows.set(t, r);
    }
    const table = [...rows.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([tag, r]) => ({ tag, ...r, ok: r.test >= minTest }));
    return {
        table,
        dev: lines.filter((l) => l.split === "dev").length,
        test: lines.filter((l) => l.split === "test").length,
        ok: table.every((r) => r.ok),
    };
};

/** The second labeller's sample: `size` refs, `devShare` of them from dev, spread over tags, deterministic. */
export const secondLabelSample = (lines: { id: string; tags: string[]; split?: string }[], opts: { size: number; devShare: number; seed: number }): string[] => {
    const pick = (pool: typeof lines, n: number) => {
        const chosen: string[] = [];
        const covered = new Set<string>();
        const shuffled = seededShuffle(pool, opts.seed);
        // First pass: one per uncovered tag; second pass: fill.
        for (const l of shuffled) if (chosen.length < n && l.tags.some((t) => !covered.has(t))) { chosen.push(l.id); l.tags.forEach((t) => covered.add(t)); }
        for (const l of shuffled) if (chosen.length < n && !chosen.includes(l.id)) chosen.push(l.id);
        return chosen;
    };
    const devN = Math.round(opts.size * opts.devShare);
    return [...pick(lines.filter((l) => l.split === "dev"), devN), ...pick(lines.filter((l) => l.split === "test"), opts.size - devN)].sort();
};

/* ── The public-text gate ───────────────────────────────────────────────────────────────────────── */

export type Finding = { id: string; kind: string; match: string };
const PATTERNS: [string, RegExp][] = [
    ["email", /[A-Za-z0-9._%+-]*@[A-Za-z0-9.-]*/g],
    ["phone_in", /\+91[\s-]?\d[\d\s-]{4,}/g],
    ["digits10", /(?<!\d)\d{10}(?!\d)/g],
    ["url", /https?:\/\/\S+/gi],
    ["www", /www\.\S+/gi],
];

/** Every email, +91 number, 10-digit run, URL, www., or private (real) company name in public inputs. */
export const checkPublic = (lines: { id: string; input: string; publicInput?: boolean }[], privateNames: string[]): Finding[] => {
    const names = privateNames.map((n) => n.trim()).filter(Boolean);
    const out: Finding[] = [];
    for (const l of lines) {
        if (l.publicInput === false) continue; // withheld: never published
        for (const [kind, re] of PATTERNS) for (const m of l.input.matchAll(re)) out.push({ id: l.id, kind, match: m[0] });
        for (const n of names) {
            const re = new RegExp(`(?<![A-Za-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`, "i");
            const m = re.exec(l.input);
            if (m) out.push({ id: l.id, kind: "private_name", match: m[0] });
        }
    }
    return out;
};
