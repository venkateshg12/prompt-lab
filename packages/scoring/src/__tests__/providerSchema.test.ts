import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createTaskSchema, jsonSchemaFor } from "@repo/types";
import { toAnthropicSchema, toGeminiSchema, toNimGuided, toOpenAiStrict } from "../providerSchema";

const task = createTaskSchema.parse(JSON.parse(readFileSync(path.resolve(__dirname, "../../../../cases/job-postings/task.json"), "utf8")));
const schema = jsonSchemaFor(task.fields);

const objects = (n: any): any[] => [
    ...(n.type === "object" ? [n] : []),
    ...Object.values(n.properties ?? {}).flatMap(objects),
    ...(n.items ? objects(n.items) : []),
    ...(n.anyOf ?? []).flatMap(objects),
];

describe("toOpenAiStrict", () => {
    it("requires every key and forbids extras at every depth", () => {
        const out = toOpenAiStrict(schema) as any;
        for (const o of objects(out)) {
            expect(o.additionalProperties).toBe(false);
            expect([...o.required].sort()).toEqual(Object.keys(o.properties).sort());
        }
    });
    it("turns an optional key into a required nullable one and drops format/pattern/default", () => {
        const out = toOpenAiStrict({
            type: "object",
            properties: { a: { type: "string", format: "date", default: "x" }, b: { type: "string" } },
            required: ["b"],
        }) as any;
        expect(out.required).toEqual(["a", "b"]);
        expect(out.properties.a).toEqual({ type: ["string", "null"] });
        expect(out.properties.b).toEqual({ type: "string" });
    });
});

describe("toAnthropicSchema", () => {
    it("adds additionalProperties:false to objects and drops $schema", () => {
        const out = toAnthropicSchema({ $schema: "x", type: "object", properties: { m: { type: "object", properties: {} } } }) as any;
        expect(out.$schema).toBeUndefined();
        expect(out.additionalProperties).toBe(false);
        expect(out.properties.m.additionalProperties).toBe(false);
    });
});

describe("toGeminiSchema", () => {
    it("keeps only the documented subset", () => {
        const out = toGeminiSchema({ $schema: "x", type: "object", additionalProperties: false, properties: { d: { type: "string", format: "date", description: "d" } }, required: ["d"] }) as any;
        expect(out).toEqual({ type: "object", properties: { d: { type: "string", description: "d" } }, required: ["d"] });
    });
});

describe("toNimGuided", () => {
    it("drops only $schema", () => {
        const out = toNimGuided({ $schema: "x", ...schema });
        expect(out.$schema).toBeUndefined();
        expect(out).toEqual(schema);
    });
});
