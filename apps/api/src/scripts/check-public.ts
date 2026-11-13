import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { checkPublic, type CaseLineOut } from "../cases/caseTools";

/*
  check-public.ts <file.jsonl> [--names .private-names.txt]
  The gate before a case file is committed: fails on any email, +91 number, 10-digit run, URL, www., or a
  real company name from the (gitignored) .private-names.txt next to the case folder.
 */
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const main = async () => {
    if (!file) throw new Error("Usage: check-public <file.jsonl> [--names .private-names.txt]");
    const lines = (await readFile(file, "utf8")).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as CaseLineOut);
    const namesIndex = args.indexOf("--names");
    const namesFile = namesIndex !== -1 ? args[namesIndex + 1]! : path.join(path.dirname(file), "..", ".private-names.txt");
    const names = existsSync(namesFile) ? (await readFile(namesFile, "utf8")).split("\n") : [];
    const findings = checkPublic(lines, names);
    for (const f of findings) console.log(`${f.id}: ${f.kind} "${f.match}"`);
    console.log(`${lines.filter((l) => l.publicInput !== false).length} inputs checked, ${findings.length} findings${names.length ? "" : " (no .private-names.txt found)"}`);
    process.exitCode = findings.length ? 1 : 0;
};
main().catch((e) => {
    console.error(e.message ?? e);
    process.exitCode = 1;
});
