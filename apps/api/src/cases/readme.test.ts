import { describe, expect, it } from "vitest";
import { currentBlock, END, headline, PLACEHOLDER, renderBlock, replaceBetweenMarkers, resumeBullet, START, type Snapshot } from "./readme";

const iv = (value: number) => ({ value, ci: [value - 0.05, value + 0.05] as const });
const row = (prompt: string, model: string, ov: number, valid: number, cost: number) => ({
    prompt, model,
    summary: { n: 70, repeats: 3, scored: 210, errors: 0, skipped: 0, errorRate: 0, repeatSpread: null, costUsdPer100: cost, p50Ms: 900, p95Ms: 2000, metrics: { overall: iv(ov), valid_json: iv(valid) } },
});
const snap: Snapshot = {
    runId: "r1", slug: "r_abcdefghij", publicUrl: "https://pl.example/r/r_abcdefghij",
    rows: [row("v1-zero-shot@1", "m-big", 0.612, 0.9, 0.031), row("v5-best@2", "m-big", 0.834, 1, 0.044), row("v1-zero-shot@1", "m-small", 0.55, 0.8, 0.01)],
    meta: { runId: "r1", split: "test", examples: 70, repeats: 3, date: "2026-12-01", pricesCheckedOn: ["2026-11-20"], testReused: false },
};

describe("README results block", () => {
    it("replaces only what is between the markers, and reads it back", () => {
        const readme = `# X\n\n${START}\n${PLACEHOLDER}\n${END}\n\n## Next`;
        const out = replaceBetweenMarkers(readme, renderBlock(snap));
        expect(out.startsWith(`# X\n\n${START}\n| Prompt |`)).toBe(true);
        expect(out.endsWith(`${END}\n\n## Next`)).toBe(true);
        expect(currentBlock(out)).toBe(renderBlock(snap));
        expect(renderBlock(snap)).toContain("[the published run](https://pl.example/r/r_abcdefghij)");
        expect(() => replaceBetweenMarkers("no markers", "x")).toThrow(/markers missing/);
    });

    it("fills the bullet from the best row and the v1 baseline on the same model (1 decimal %, 2 decimals $)", () => {
        expect(headline(snap)).toMatchObject({ X: "61.2%", Y: "83.4%", Z: "100.0%", C: "$0.04" });
        expect(resumeBullet(snap)).toContain("on a 70-example job-posting extraction task");
        expect(resumeBullet(snap)).toContain("raised field accuracy from 61.2% to 83.4% and valid-JSON rate to 100.0% at $0.04 per 100 inputs.");
        expect(resumeBullet(snap)).not.toMatch(/\[|\]/);
    });
});
