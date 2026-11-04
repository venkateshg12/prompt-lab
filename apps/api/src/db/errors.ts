import { Prisma } from "../generated/prisma/client";

/** A unique constraint rejected the write (Postgres 23505, Prisma P2002). */
export const isUniqueViolation = (error: unknown): boolean =>
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

/** An update or delete by a unique `where` matched no row (Prisma P2025). */
export const isRecordNotFound = (error: unknown): boolean =>
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";

/** Ids are UUIDs. Anything else can't match a row, so callers answer 404 instead of querying. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string =>
    typeof value === "string" && UUID_PATTERN.test(value);

/**
 * Resolves to null when an update/delete by unique `where` found no row; every other error still
 * throws, so a database outage never turns into a 404.
 */
export const nullIfNotFound = <T>(operation: Promise<T>): Promise<T | null> =>
    operation.catch((error: unknown) => {
        if (isRecordNotFound(error)) return null;
        throw error;
    });
