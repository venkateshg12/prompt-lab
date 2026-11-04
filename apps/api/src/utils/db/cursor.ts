import { isUuid } from "../../db/errors";

export type Cursor = { createdAt: string; id: string };

export const encodeCursor = (row: { createdAt: Date; id: string }) =>
  Buffer.from(
    JSON.stringify({
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : new Date(row.createdAt).toISOString(),
      id: row.id,
    })
  ).toString("base64url");

/** null for a missing or malformed cursor — a junk cursor restarts the list rather than erroring. */
export const decodeCursor = (raw?: string): Cursor | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof parsed.createdAt !== "string" || !isUuid(parsed.id)) return null;
    const date = new Date(parsed.createdAt);
    if (isNaN(date.getTime())) return null;
    return parsed;
  } catch {
    return null;
  }
};

/** Rows strictly after the cursor in (createdAt desc, id desc) order, as a Prisma `where`. */
export const afterCursor = (cursor: Cursor | null) =>
  cursor
    ? {
        OR: [
          { createdAt: { lt: new Date(cursor.createdAt) } },
          { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
        ],
      }
    : {};

/** The order every cursor list uses; it matches the (org_id, created_at desc, id desc) indexes. */
export const cursorOrder = [{ createdAt: "desc" as const }, { id: "desc" as const }];

/** Fetch limit+1 to know whether there is another page without a count query. */
export const pageOf = <T extends { createdAt: Date; id: string }>(rows: T[], limit: number) => {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    items,
    meta: {
      hasMore,
      nextCursor: hasMore && items.length > 0 ? encodeCursor(items[items.length - 1]) : null,
    },
  };
};
