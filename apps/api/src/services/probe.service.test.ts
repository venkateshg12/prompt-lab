import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../ai/concurrency", () => ({
    withLease: async (_m: string, fn: () => Promise<unknown>) => fn(),
    assertRpmBudget: async () => undefined,
}));
const { setStructuredSupport } = vi.hoisted(() => ({ setStructuredSupport: vi.fn(async () => undefined) }));
vi.mock("./model.service", () => ({ setStructuredSupport, markRetired: async () => undefined }));

import { isBareSchemaValid, modeOf, probeCsv, probeModel } from "./probe.service";
import { fakeLlm } from "../ai/providers/fake";
import { resetBreakers } from "../ai/breakers";
import { ProviderHttpError } from "../ai/errors";
import { modelConfigByKey } from "../config/models.config";

const config = modelConfigByKey("fake:text")!;
const row = { inputUsdMicrosPerMTok: 1, outputUsdMicrosPerMTok: 1 };

beforeEach(() => {
    fakeLlm.reset();
    resetBreakers();
    setStructuredSupport.mockClear();
    vi.spyOn(Math, "random").mockReturnValue(0);
});

describe("isBareSchemaValid", () => {
    it("accepts only the whole text as a schema-valid object", () => {
        expect(isBareSchemaValid('{"colour":"blue","sure":true}')).toBe(true);
        expect(isBareSchemaValid('Sure! {"colour":"blue","sure":true}')).toBe(false);
        expect(isBareSchemaValid('```json\n{"colour":"blue","sure":true}\n```')).toBe(false);
        expect(isBareSchemaValid('{"colour":"green","sure":true}')).toBe(false);
        expect(isBareSchemaValid('{"colour":"blue","sure":true,"extra":1}')).toBe(false);
    });
});

describe("probeModel", () => {
    it("3/3 bare valid answers → supported, and writes the registry", async () => {
        fakeLlm.alwaysReturn('{"colour":"blue","sure":true}');
        const r = await probeModel(config, row);
        expect(r).toMatchObject({ support: "supported", mode: "native" });
        expect(setStructuredSupport).toHaveBeenCalledWith("fake:text", "supported", "native", expect.any(Date));
    });
    it("a model that wraps the JSON in prose → unsupported", async () => {
        fakeLlm.alwaysReturn('The sky is blue. {"colour":"blue","sure":true}');
        const r = await probeModel(config, row);
        expect(r).toMatchObject({ support: "unsupported", mode: "none" });
        expect(setStructuredSupport).toHaveBeenCalledWith("fake:text", "unsupported", "none", expect.any(Date));
    });
    it("a transport error leaves it untested and never writes", async () => {
        fakeLlm.push({ kind: "error", error: new ProviderHttpError("fake:text", 401, "no") });
        const r = await probeModel(config, row);
        expect(r.support).toBe("untested");
        expect(r.note).toMatch(/ProviderHttpError/);
        expect(setStructuredSupport).not.toHaveBeenCalled();
    });
});

describe("modeOf / probeCsv", () => {
    it("guided_json for NVIDIA, native otherwise, none when unsupported", () => {
        expect(modeOf("nvidia", "supported")).toBe("guided_json");
        expect(modeOf("openai", "supported")).toBe("native");
        expect(modeOf("nvidia", "unsupported")).toBe("none");
    });
    it("writes the header the Playbook imports", () => {
        const csv = probeCsv([{ model: "m", support: "supported", mode: "native", probed_on: "2026-11-04", probe_version: "probe@1" }]);
        expect(csv.split("\n")[0]).toBe("model,support,mode,probed_on,probe_version");
        expect(csv.split("\n")[1]).toBe("m,supported,native,2026-11-04,probe@1");
    });
});
