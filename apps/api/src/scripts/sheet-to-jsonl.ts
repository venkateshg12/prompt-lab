import { readFile, writeFile } from "node:fs/promises";
import { createTaskSchema } from "@repo/types";
import { sheetToCaseLines, SheetError } from "../cases/caseTools";
import { flag } from "./args";

/*
  pnpm --filter api exec tsx src/scripts/sheet-to-jsonl.ts --in ~/labels.csv \
    --task ../../cases/job-postings/task.json --out ../../cases/job-postings/data/job_postings.jsonl
  The labelling sheet (CSV: id, split?, tags, input, notes?, publicInput?, one column per field) → case
  lines. Every `expected` is validated against the task's rules; the first invalid row stops the file.
 */
const args = process.argv.slice(2);
const [input, taskFile, out] = [flag(args, "--in"), flag(args, "--task"), flag(args, "--out")];
if (!input || !taskFile || !out) {
    console.error("Usage: sheet-to-jsonl --in labels.csv --task task.json --out data/job_postings.jsonl");
    process.exit(2);
}
const main = async () => {
    const task = createTaskSchema.parse(JSON.parse(await readFile(taskFile, "utf8")));
    try {
        const lines = sheetToCaseLines(await readFile(input, "utf8"), task.fields);
        await writeFile(out, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
        console.log(`${lines.length} case lines written to ${out}`);
    } catch (e) {
        if (e instanceof SheetError) {
            console.error(`Refused: ${e.message}`);
            process.exit(1);
        }
        throw e;
    }
};
void main();
