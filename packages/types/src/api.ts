import { z } from "zod";

export const envelopeSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    status: z.literal("success"),
    data: dataSchema,
    meta: z.record(z.string(), z.unknown()).optional(),
  });

export const paginatedEnvelopeSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    status: z.literal("success"),
    data: z.array(itemSchema),
    meta: z
      .object({
        nextCursor: z.string().nullable().optional(),
        hasMore: z.boolean(),
      })
      .passthrough()
      .optional(),
  });

export const errorDetailSchema = z.object({
  message: z.string(),
  code: z.string().optional(),
  path: z.string().optional(),
});

export const errorEnvelopeSchema = z.object({
  status: z.literal("error"),
  data: z.null(),
  errors: z.array(errorDetailSchema).optional(),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
