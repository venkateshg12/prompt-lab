import { z } from "zod";
import type { ModelConfig } from "../config/models.config";
import { complete, priceOf } from "../ai/complete";
import { setStructuredSupport } from "./model.service";
import type { Model } from "../generated/prisma/client";

export const PROBE_VERSION = "probe@1";

// A tiny schema and a prompt designed to tempt prose: "Explain your reasoning, then answer".
export const PROBE_SCHEMA = {
    type: "object",
    properties: { colour: { type: "string", enum: ["red", "blue"] }, sure: { type: "boolean" } },
    required: ["colour", "sure"],
    additionalProperties: false,
} as const;
const PROBE_PROMPT = "Explain your reasoning in a sentence, then answer: is the sky on a clear day red or blue?";
const probeAnswer = z.object({ colour: z.enum(["red", "blue"]), sure: z.boolean() }).strict();

/** The WHOLE text must be a JSON object that matches the schema: no prose, no fences. */
export const isBareSchemaValid = (text: string): boolean => {
    try {
        return probeAnswer.safeParse(JSON.parse(text)).success;
    } catch {
        return false;
    }
};

export const modeOf = (provider: ModelConfig["provider"], support: "supported" | "unsupported" | "untested") =>
    support === "unsupported" ? "none" : provider === "nvidia" ? "guided_json" : "native";

export type ProbeRow = { model: string; support: "supported" | "unsupported" | "untested"; mode: string; probed_on: string; probe_version: string; note?: string };

/*
  3/3 bare, schema-valid JSON → supported; anything else → unsupported; a transport error (410, 401,
  429, network…) leaves the model `untested` and says why. A result is never overwritten with `untested`.
 */
export const probeModel = async (config: ModelConfig, row: Pick<Model, "inputUsdMicrosPerMTok" | "outputUsdMicrosPerMTok">): Promise<ProbeRow> => {
    let ok = 0;
    let transportError: string | null = null;
    for (let i = 0; i < 3; i++) {
        try {
            const r = await complete(config, priceOf(row), {
                system: "Answer the question.",
                messages: [{ role: "user", content: PROBE_PROMPT }],
                structured: { name: "probe", schema: PROBE_SCHEMA as unknown as Record<string, unknown> },
                temperature: 0,
                maxTokens: 100,
            });
            if (isBareSchemaValid(r.text)) ok++;
        } catch (e) {
            transportError = `${(e as Error).name}: ${String((e as Error).message).slice(0, 200)}`;
            break;
        }
    }
    const support = transportError ? "untested" : ok === 3 ? "supported" : "unsupported";
    const mode = modeOf(config.provider, support);
    const probedOn = new Date().toISOString().slice(0, 10);
    if (support !== "untested") await setStructuredSupport(config.key, support, mode, new Date());
    return { model: config.key, support, mode, probed_on: probedOn, probe_version: PROBE_VERSION, ...(transportError ? { note: transportError } : {}) };
};

export const probeCsv = (rows: ProbeRow[]): string =>
    ["model,support,mode,probed_on,probe_version", ...rows.map((r) => [r.model, r.support, r.mode, r.probed_on, r.probe_version].join(","))].join("\n") + "\n";
