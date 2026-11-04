import { prisma } from "../db/prisma";
import { fieldRulesSchema, type CellPayload, type FieldRule } from "@repo/types";
import { modelConfigByKey, type ModelConfig } from "../config/models.config";
import { DEFAULT_MODEL_LIMIT } from "../constants/llm";
import type { Model } from "../generated/prisma/client";
import type { CellContext } from "./executeCell";
import type { VariantSnapshot } from "./snapshot";
import type { Price } from "../utils/cost";

/** The registry config for a DB row; a model in the table but not in models.config gets safe defaults. */
export const toModelConfig = (row: Model): ModelConfig =>
    modelConfigByKey(row.key) ?? {
        key: row.key,
        provider: row.provider,
        modelId: row.modelId,
        label: row.label,
        price: { inputPerMTokUsd: row.inputUsdMicrosPerMTok / 1e6, outputPerMTokUsd: row.outputUsdMicrosPerMTok / 1e6, checkedOn: row.priceCheckedOn.toISOString().slice(0, 10) },
        limits: DEFAULT_MODEL_LIMIT,
    };

type RunLevel = {
    status: string;
    snapshots: Record<string, VariantSnapshot>;
    prices: Record<string, Price>;
    fields: FieldRule[];
    variants: Map<string, { promptVersionId: string; model: Model }>;
    expiresAt: number;
};

// Run-level data never changes during a run, so a cell doesn't re-read it: 3,000 cells = 1 read, not 3,000.
const cache = new Map<string, RunLevel>();
const TTL_MS = 30_000;

const loadRunLevel = async (p: CellPayload): Promise<RunLevel | null> => {
    const hit = cache.get(p.runId);
    if (hit && hit.expiresAt > Date.now()) return hit;
    const run = await prisma.run.findUnique({ where: { id: p.runId }, include: { task: true, variants: { include: { model: true } } } });
    if (!run) return null;
    const level: RunLevel = {
        status: run.status,
        snapshots: run.promptSnapshots as unknown as Record<string, VariantSnapshot>,
        prices: run.pricesSnapshot as unknown as Record<string, Price>,
        fields: fieldRulesSchema.parse(run.task.fields),
        variants: new Map(run.variants.map((v) => [v.id, { promptVersionId: v.promptVersionId, model: v.model }])),
        expiresAt: Date.now() + TTL_MS,
    };
    cache.set(p.runId, level);
    return level;
};

export const clearCellContextCache = () => cache.clear();

/** The run's CURRENT status: cancel must take effect within seconds, so this is never cached. */
export const currentRunStatus = async (runId: string): Promise<string | null> =>
    (await prisma.run.findUnique({ where: { id: runId }, select: { status: true } }))?.status ?? null;

/** Everything a cell needs, or null when the run, variant or example was deleted. */
export const loadCellContext = async (p: CellPayload): Promise<CellContext | null> => {
    const level = await loadRunLevel(p);
    if (!level) return null;
    const variant = level.variants.get(p.variantId);
    const snapshot = variant && level.snapshots[variant.promptVersionId];
    const example = await prisma.example.findUnique({ where: { id: p.exampleId } });
    if (!variant || !snapshot || !example) return null;
    return {
        model: toModelConfig(variant.model),
        modelStructured: variant.model.structured,
        price: level.prices[variant.model.key]!,
        snapshot,
        fields: level.fields,
        input: example.input,
        expected: example.expected as Record<string, unknown>,
    };
};
