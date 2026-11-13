import { describe, expect, it } from "vitest";
import { parseNotebook } from "./notebook";

const md = `# Experiment
Run A: 01a1d4f6-d984-778c-b94f-cb197104828d (dev)
Lesson 7 picks: 2026-11-14T10:30:00+05:30 · jp_004, jp_011, jp_019
### C1: LPA rule
- Hypothesis: LPA read as monthly
- Change: explicit conversion rule
- Delta: salary +12.0 pts (01A1D4F6-D984-778C-B94F-CB197104828D vs 01a1d4f8-b30c-75c8-9236-a8da8b7e6bd5)
- Decision: keep
### C2: think carefully
- Hypothesis: more care helps
- Change: added "think carefully"
- Decision: maybe
### Notes
not a change`;

describe("parseNotebook", () => {
    it("collects run ids, the timestamped picks and every change's missing parts", () => {
        const n = parseNotebook(md);
        expect(n.runIds).toEqual(["01a1d4f6-d984-778c-b94f-cb197104828d", "01a1d4f8-b30c-75c8-9236-a8da8b7e6bd5"]);
        expect(n.picks).toEqual({ at: new Date("2026-11-14T05:00:00Z"), refs: ["jp_004", "jp_011", "jp_019"] });
        expect(n.changes).toEqual([
            { title: "C1: LPA rule", missing: [], decision: "keep" },
            { title: "C2: think carefully", missing: ["Delta", "Decision (keep | revert)"], decision: null },
        ]);
    });
    it("has no picks when the line is missing or the time is unreadable", () => {
        expect(parseNotebook("nothing").picks).toBeNull();
        expect(parseNotebook("Lesson 7 picks: yesterday · jp_1").picks).toBeNull();
    });
});
