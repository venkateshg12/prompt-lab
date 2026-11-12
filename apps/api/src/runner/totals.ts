import { prisma } from "../db/prisma";

/** Cost so far and skipped count, counted from the stored results (never from adding up messages). */
export const runTotals = async (runId: string): Promise<{ costUsdMicros: number; skippedCells: number }> => {
    const [cost, skipped] = await Promise.all([
        prisma.result.aggregate({ where: { runId }, _sum: { costUsdMicros: true } }),
        prisma.result.count({ where: { runId, status: "skipped" } }),
    ]);
    return { costUsdMicros: cost._sum.costUsdMicros ?? 0, skippedCells: skipped };
};
