import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { prisma } from "../db/prisma";
import { MODELS, modelConfigByKey } from "../config/models.config";
import { isEnabled } from "../ai/enabled";
import { probeCsv, probeModel, type ProbeRow } from "../services/probe.service";
import { closeAll } from "./closeAll";

/*
  pnpm --filter api exec tsx src/scripts/probe-structured.ts (--model <key> | --all) [--csv <file>]

  Checks, per model, whether schema mode is really honoured, and writes models.structured. With --csv it
  also writes the file the Playbook's Lesson 4 imports: model,support,mode,probed_on,probe_version.
 */
const flag = (name: string): string | undefined => {
    const args = process.argv.slice(2);
    const index = args.indexOf(name);
    return index !== -1 ? args[index + 1] : undefined; // check -1 first: args[indexOf + 1] reads args[0] when absent
};

const main = async () => {
    const one = flag("--model");
    const all = process.argv.includes("--all");
    if (!one && !all) throw new Error("Pass --model <key> or --all");
    const targets = one
        ? [modelConfigByKey(one) ?? (() => { throw new Error(`Unknown model ${one}`); })()]
        : MODELS.filter((m) => m.provider !== "fake");

    const rows: ProbeRow[] = [];
    for (const config of targets) {
        const row = await prisma.model.findUnique({ where: { key: config.key } });
        if (!row || !row.active) {
            rows.push({ model: config.key, support: "untested", mode: "none", probed_on: new Date().toISOString().slice(0, 10), probe_version: "probe@1", note: row ? "inactive" : "not seeded" });
            continue;
        }
        if (!isEnabled(config)) {
            rows.push({ model: config.key, support: "untested", mode: "none", probed_on: new Date().toISOString().slice(0, 10), probe_version: "probe@1", note: "no API key set for this provider" });
            continue;
        }
        rows.push(await probeModel(config, row));
    }

    console.table(rows.map(({ model, support, mode, note }) => ({ model, support, mode, note: note ?? "" })));
    const csv = flag("--csv");
    if (csv) {
        await writeFile(csv, probeCsv(rows));
        console.log(`wrote ${csv}`);
    }
};

main()
    .catch((e) => {
        console.error(e.message);
        process.exitCode = 1;
    })
    .finally(() => closeAll());
