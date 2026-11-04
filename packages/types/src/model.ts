import { z } from "zod";

export const PROVIDERS = ["nvidia", "openai", "anthropic", "gemini", "fake"] as const;
export type ProviderName = (typeof PROVIDERS)[number];
export const STRUCTURED_SUPPORT = ["supported", "unsupported", "untested"] as const;
export type StructuredSupport = (typeof STRUCTURED_SUPPORT)[number];

/** A registry model as the API returns it (prices carry their date and note; the UI prints both). */
export const modelDtoSchema = z.object({
    id: z.string(),
    key: z.string(),
    provider: z.enum(PROVIDERS),
    modelId: z.string(),
    label: z.string(),
    contextTokens: z.number().nullable(),
    inputUsdMicrosPerMTok: z.number(),
    outputUsdMicrosPerMTok: z.number(),
    priceNote: z.string().nullable(),
    priceCheckedOn: z.string(),
    structured: z.enum(STRUCTURED_SUPPORT),
    structuredMode: z.string().nullable(),
    structuredProbedAt: z.string().nullable(),
    active: z.boolean(),
    enabled: z.boolean(), // its provider's key is set on the server
});
export type ModelDto = z.infer<typeof modelDtoSchema>;
