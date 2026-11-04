import { prisma } from "../db/prisma";
import { MODELS as REGISTRY_SEED, type ModelConfig } from "../config/models.config";
import { MODELS_SEED, NODE_ENV } from "../constants/env";
import { isEnabled } from "../ai/enabled";
import { logger } from "../utils/logger";
import type { Model } from "../generated/prisma/client";
import type { ModelDto } from "@repo/types";

export const toModelDto = (m: Model): ModelDto => ({
    id: m.id,
    key: m.key,
    provider: m.provider,
    modelId: m.modelId,
    label: m.label,
    contextTokens: m.contextTokens,
    inputUsdMicrosPerMTok: m.inputUsdMicrosPerMTok,
    outputUsdMicrosPerMTok: m.outputUsdMicrosPerMTok,
    priceNote: m.priceNote,
    priceCheckedOn: m.priceCheckedOn.toISOString().slice(0, 10),
    structured: m.structured,
    structuredMode: m.structuredMode,
    structuredProbedAt: m.structuredProbedAt?.toISOString() ?? null,
    active: m.active,
    enabled: isEnabled({ provider: m.provider } as ModelConfig),
});

const seedRows = (): ModelConfig[] => (MODELS_SEED === "test" ? REGISTRY_SEED.filter((m) => m.provider === "fake") : REGISTRY_SEED);

/*
  Upserts the registry by `key`. It NEVER touches `structured*` (Phase 15's probe owns them) or
  re-activates a row marked retired. Returns what changed, for the script to print.
 */
export const seedModels = async () => {
    const result = { created: 0, updated: 0, unchanged: 0 };
    for (const m of seedRows()) {
        const data = {
            provider: m.provider,
            modelId: m.modelId,
            label: m.label,
            contextTokens: m.contextTokens ?? null,
            inputUsdMicrosPerMTok: Math.round(m.price.inputPerMTokUsd * 1e6),
            outputUsdMicrosPerMTok: Math.round(m.price.outputPerMTokUsd * 1e6),
            priceNote: m.price.note ?? null,
            priceCheckedOn: new Date(m.price.checkedOn),
        };
        const existing = await prisma.model.findUnique({ where: { key: m.key } });
        if (!existing) {
            await prisma.model.create({ data: { key: m.key, ...data } });
            result.created++;
            continue;
        }
        const same =
            existing.provider === data.provider &&
            existing.modelId === data.modelId &&
            existing.label === data.label &&
            existing.contextTokens === data.contextTokens &&
            existing.inputUsdMicrosPerMTok === data.inputUsdMicrosPerMTok &&
            existing.outputUsdMicrosPerMTok === data.outputUsdMicrosPerMTok &&
            existing.priceNote === data.priceNote &&
            existing.priceCheckedOn.getTime() === data.priceCheckedOn.getTime();
        if (same) {
            result.unchanged++;
        } else {
            await prisma.model.update({ where: { key: m.key }, data });
            result.updated++;
        }
    }
    return result;
};

/** Active models whose provider key is set (the fake model only outside production). */
export const listEnabledModels = async () => {
    const rows = await prisma.model.findMany({ where: { active: true }, orderBy: [{ provider: "asc" }, { label: "asc" }] });
    return rows
        .filter((m) => isEnabled({ provider: m.provider } as ModelConfig))
        .filter((m) => m.provider !== "fake" || NODE_ENV !== "production")
        .map(toModelDto);
};

export const getModelByKey = (key: string) => prisma.model.findUnique({ where: { key } });

/** A 410 means the provider retired this id: the launcher stops offering it. */
export const markRetired = async (key: string) => {
    await prisma.model.updateMany({ where: { key }, data: { active: false } });
    logger.warn({ model: key }, "model retired by provider (410): deactivated");
};

