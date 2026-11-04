import { createHash } from "node:crypto";

/** sha256 of the examples' (ref, revision) list: if a label or the split changes, the hash changes. */
export const datasetHashOf = (examples: { ref: string; revision: number }[]): string =>
    createHash("sha256").update([...examples].sort((a, b) => (a.ref < b.ref ? -1 : 1)).map((e) => `${e.ref}:${e.revision}`).join("\n")).digest("hex");
