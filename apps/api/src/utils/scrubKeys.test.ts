import { describe, expect, it } from "vitest";
import { scrubKeys } from "./scrubKeys";

describe("scrubKeys", () => {
    it("replaces every provider's key shape", () => {
        const text = "a nvapi-AbCdEfGh12345678_- b sk-ant-api03-xyzXYZ123456 c sk-proj-abcdefgh12345 d AIzaSyD-abcdefgh123456789";
        expect(scrubKeys(text)).toBe("a [key] b [key] c [key] d [key]");
    });
    it("leaves ordinary text alone", () => {
        expect(scrubKeys("skills: sk-learn, nvapi docs, AIza")).toBe("skills: sk-learn, nvapi docs, AIza");
    });
});
