import "dotenv/config";
import { closeAll } from "./closeAll";
import { MODELS, modelConfigByKey } from "../config/models.config";
import { complete, priceOf } from "../ai/complete";
import { getModelByKey } from "../services/model.service";

// pnpm --filter api exec tsx src/scripts/try-model.ts <key> 'Reply with {"hi":true}'
// One real call: prints the text VERBATIM, usage, latency, attempts and cost.
const main = async () => {
    const [key, prompt = 'Reply with {"hi":true}'] = process.argv.slice(2);
    const config = key ? modelConfigByKey(key) : undefined;
    if (!config) throw new Error(`Unknown model key. Registered: ${MODELS.map((m) => m.key).join(", ")}`);
    const row = await getModelByKey(config.key);
    if (!row) throw new Error("Not seeded: run `pnpm --filter api db:seed-models`");
    try {
        const out = await complete(config, priceOf(row), { system: "You are a terse assistant.", messages: [{ role: "user", content: prompt }], temperature: 0, maxTokens: 200 });
        console.log("text:", JSON.stringify(out.text));
        console.log({ usage: out.usage, finishReason: out.finishReason, latencyMs: out.latencyMs, attempts: out.attempts, costUsdMicros: out.costUsdMicros });
    } catch (e) {
        console.log(`FAILED ${(e as Error).name}: ${(e as Error).message}`);
        process.exitCode = 1;
    }
};
main()
    .catch((e) => {
        console.error(e.message);
        process.exitCode = 1;
    })
    .finally(() => closeAll());
