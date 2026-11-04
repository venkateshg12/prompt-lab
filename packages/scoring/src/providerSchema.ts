type Json = Record<string, unknown>;

const walk = (node: Json, fn: (n: Json) => Json): Json => {
    const out = fn({ ...node });
    if (out.properties) {
        out.properties = Object.fromEntries(Object.entries(out.properties as Json).map(([k, v]) => [k, walk(v as Json, fn)]));
    }
    if (out.items) out.items = walk(out.items as Json, fn);
    for (const key of ["anyOf", "oneOf"] as const) {
        if (Array.isArray(out[key])) out[key] = (out[key] as Json[]).map((s) => walk(s, fn));
    }
    return out;
};
const drop = (n: Json, keys: string[]): Json => Object.fromEntries(Object.entries(n).filter(([k]) => !keys.includes(k)));

/*
  OpenAI strict mode: every property in `required`, `additionalProperties: false` on every object,
  an optional key becomes "required but nullable", and format/default/pattern/length keywords are dropped.
 */
export const toOpenAiStrict = (schema: Json): Json =>
    walk(drop(schema, ["$schema"]), (n) => {
        const node = drop(n, ["format", "default", "pattern", "minLength", "maxLength"]);
        if (node.type !== "object") return node;
        const props = (node.properties ?? {}) as Json;
        const required = new Set((node.required as string[]) ?? []);
        const nullable = Object.fromEntries(
            Object.entries(props).map(([k, v]) => {
                const p = v as Json;
                if (required.has(k) || (Array.isArray(p.type) && p.type.includes("null"))) return [k, p];
                return [k, { ...p, type: [p.type, "null"].flat() }];
            })
        );
        return { ...node, properties: nullable, required: Object.keys(props), additionalProperties: false };
    });

/** Anthropic: `additionalProperties: false` on every object (checked against the structured-outputs page, 4 Nov 2026). */
export const toAnthropicSchema = (schema: Json): Json =>
    walk(drop(schema, ["$schema"]), (n) => (n.type === "object" ? { ...n, additionalProperties: false } : n));

/** Gemini accepts a documented subset of JSON Schema. Checked 4 Nov 2026; re-check when you change it. */
export const GEMINI_ALLOWED_KEYS = [
    "type", "properties", "required", "items", "enum", "description", "anyOf", "minimum", "maximum", "minItems", "maxItems", "title",
] as const;
export const toGeminiSchema = (schema: Json): Json =>
    walk(schema, (n) => Object.fromEntries(Object.entries(n).filter(([k]) => (GEMINI_ALLOWED_KEYS as readonly string[]).includes(k))));

/** NVIDIA NIM `nvext.guided_json`: the schema as is, minus `$schema`. */
export const toNimGuided = (schema: Json): Json => drop(schema, ["$schema"]);
