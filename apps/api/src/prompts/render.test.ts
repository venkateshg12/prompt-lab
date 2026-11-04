import { describe, expect, it } from "vitest";
import { renderPrompt, renderTemplate } from "./render";

// The renderer's behaviour is tested in packages/scoring; this only guards that the API's re-export works.
describe("prompts/render re-export", () => {
    it("exposes the shared renderer", () => {
        expect(renderTemplate("{{input}}", { input: "ok" })).toBe("ok");
        expect(typeof renderPrompt).toBe("function");
    });
});
