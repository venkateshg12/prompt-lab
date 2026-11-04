import { z } from "zod";

export const cursorQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
});
export type CursorQuery = z.infer<typeof cursorQuerySchema>;

// What a cursor-paginated list puts in the envelope's `meta`, next to the rows in `data`.
export type CursorMeta = { nextCursor: string | null; hasMore: boolean };
