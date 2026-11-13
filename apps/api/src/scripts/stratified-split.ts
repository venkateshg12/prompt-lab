import { readFile, writeFile } from "node:fs/promises";
import { secondLabelSample, splitReport, stratifiedSplit, type CaseLineOut } from "../cases/caseTools";
import { flag } from "./args";

/*
  stratified-split.ts <file.jsonl> --dev 30 --seed 20261103   writes `split` into every line (deterministic)
  stratified-split.ts <file.jsonl> --report                    tag × split table; exit 1 if a tag has < 3 test examples
  stratified-split.ts <file.jsonl> --sample 20 --dev-share 0.4 [--seed n]   refs for the second labeller
 */
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--") && !/^\d|^0\./.test(a));
const main = async () => {
    if (!file) throw new Error("Usage: stratified-split <file.jsonl> (--dev 30 --seed n | --report | --sample 20 --dev-share 0.4)");
    const lines = (await readFile(file, "utf8")).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as CaseLineOut);
    const seed = Number(flag(args, "--seed") ?? 20261103);
    const print = (r: ReturnType<typeof splitReport>) => {
        console.log("tag".padEnd(20) + "dev".padStart(5) + "test".padStart(6));
        for (const row of r.table) console.log(`${row.tag.padEnd(20)}${String(row.dev).padStart(5)}${String(row.test).padStart(6)}${row.ok ? "" : "   ← test < 3"}`);
        console.log(`${"total".padEnd(20)}${String(r.dev).padStart(5)}${String(r.test).padStart(6)}`);
    };
    if (args.includes("--report")) {
        const r = splitReport(lines);
        print(r);
        process.exitCode = r.ok ? 0 : 1;
        return;
    }
    if (flag(args, "--sample")) {
        const refs = secondLabelSample(lines, { size: Number(flag(args, "--sample")), devShare: Number(flag(args, "--dev-share") ?? 0.4), seed });
        console.log(refs.join("\n"));
        return;
    }
    const dev = Number(flag(args, "--dev"));
    if (!dev) throw new Error("--dev <n> is required");
    const split = stratifiedSplit(lines, { dev, seed });
    await writeFile(file, split.map((l) => JSON.stringify(l)).join("\n") + "\n");
    print(splitReport(split));
};
main().catch((e) => {
    console.error(e.message ?? e);
    process.exitCode = 1;
});
