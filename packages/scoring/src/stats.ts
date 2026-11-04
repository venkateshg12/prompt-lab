/** Wilson score interval (95 %) for k successes in n trials. Behaves well for small n. */
export const wilson = (k: number, n: number, z = 1.96): readonly [number, number] => {
    if (n === 0) return [0, 0];
    const p = k / n;
    const d = 1 + (z * z) / n;
    const centre = (p + (z * z) / (2 * n)) / d;
    const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
    return [Math.max(0, centre - half), Math.min(1, centre + half)];
};

export type NumFormat = "pct" | "usd" | "ms" | "count" | "raw";

/** Display rules from the writing guide: no decimals for n < 100, one decimal otherwise. */
export const formatValue = (value: number, format: NumFormat, n?: number): string => {
    switch (format) {
        case "pct":
            return `${(value * 100).toFixed(n !== undefined && n >= 100 ? 1 : 0)}%`;
        case "usd":
            return `$${value.toPrecision(3)}`;
        case "ms":
            return `${(value / 1000).toFixed(1)} s`;
        case "count":
            return Math.round(value).toLocaleString("en-IN");
        case "raw":
            return String(value);
    }
};

/** Deterministic PRNG (mulberry32), so a bootstrap interval is the same on every re-import. */
export const seededRandom = (seed: number) => {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

export const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length);

/** Nearest-rank percentile (Prompt Lab Phase 17): sort, take the value at ceil(p × n) − 1. */
export const percentile = (xs: number[], p: number): number | undefined => {
    if (xs.length === 0) return undefined;
    const sorted = [...xs].sort((a, b) => a - b);
    return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
};

/** 95 % percentile-bootstrap interval for a mean, over `resamples` resamples with a fixed seed. */
export const bootstrapMean = (
    xs: number[],
    { resamples = 1000, seed = 1 }: { resamples?: number; seed?: number } = {}
): readonly [number, number] => {
    if (xs.length === 0) return [0, 0];
    const rand = seededRandom(seed);
    const means: number[] = [];
    for (let i = 0; i < resamples; i++) {
        let sum = 0;
        for (let j = 0; j < xs.length; j++) sum += xs[Math.floor(rand() * xs.length)]!;
        means.push(sum / xs.length);
    }
    return [percentile(means, 0.025)!, percentile(means, 0.975)!];
};
