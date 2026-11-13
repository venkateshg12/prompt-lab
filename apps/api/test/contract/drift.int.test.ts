import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The copy must equal the Playbook's source. CI has no sibling repo, so the test SKIPS there, visibly.
const PLAYBOOK_ROOT = process.env.PLAYBOOK_ROOT ?? path.join(os.homedir(), "Code/prompt-engineering-playbook");
const SOURCE = path.join(PLAYBOOK_ROOT, "packages/types/src/importContracts.ts");
const present = existsSync(SOURCE);

/** The text of one `export const <name> = z.object({ … });` declaration, whitespace-normalised. */
const declaration = (text: string, name: string) => {
    const start = text.indexOf(`export const ${name}`);
    if (start === -1) throw new Error(`${name} not found`);
    const end = text.indexOf("});", start);
    return text.slice(start, end + 3).replace(/\s+/g, " ").trim();
};

describe(`Playbook contract drift${present ? "" : ` (skipped: Playbook not found at ${PLAYBOOK_ROOT})`}`, () => {
    it.skipIf(!present)("importContracts.copy.ts matches the Playbook's source", () => {
        const source = readFileSync(SOURCE, "utf8");
        const copy = readFileSync(path.join(__dirname, "importContracts.copy.ts"), "utf8");
        for (const name of ["promptLabResultLineSchema", "promptLabCaseLineSchema"]) {
            expect(declaration(copy, name)).toBe(declaration(source, name));
        }
    });
});
