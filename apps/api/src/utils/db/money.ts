/*
  Integer micro-dollars everywhere (no float drift across thousands of calls). A single result's cost fits
  an Int; running totals over a run or a month can pass 2^31 (~$2,147) and are BigInt.
 */
export const toBigMicros = (value: number | bigint | null | undefined): bigint => BigInt(value ?? 0);

export const sumMicros = (values: Iterable<number | bigint | null | undefined>): bigint => {
    let total = 0n;
    for (const v of values) total += toBigMicros(v);
    return total;
};

/** Micro-dollars as a plain dollar number (for display and the API's DTOs only; never for arithmetic). */
export const microsToUsd = (micros: number | bigint): number => Number(micros) / 1_000_000;
