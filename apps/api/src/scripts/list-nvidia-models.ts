import "dotenv/config";
import { MODELS } from "../config/models.config";
import { NVIDIA_API_KEY, NVIDIA_BASE_URL } from "../constants/env";

// Prints GET $NVIDIA_BASE_URL/models and marks registry rows missing from it. Needs NVIDIA_API_KEY.
const main = async () => {
    if (!NVIDIA_API_KEY) throw new Error("Set NVIDIA_API_KEY in apps/api/.env first");
    const res = await fetch(`${NVIDIA_BASE_URL}/models`, { headers: { Authorization: `Bearer ${NVIDIA_API_KEY}` } });
    if (!res.ok) throw new Error(`GET /models answered ${res.status}`);
    const ids = ((await res.json()) as { data: { id: string }[] }).data.map((m) => m.id).sort();
    console.log(ids.join("\n"));
    const live = new Set(ids);
    for (const m of MODELS.filter((x) => x.provider === "nvidia")) {
        console.log(`${live.has(m.modelId) ? "listed " : "MISSING"}  ${m.key}`);
    }
};
main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
});
