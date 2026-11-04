import { prisma, type Tx } from "../../db/prisma";

/*
  The one way PaperTrail runs a transaction (an interactive Prisma transaction, READ COMMITTED).

  - Use `tx`, never `prisma`, for every read and write inside the callback, or that statement runs
    outside the transaction.
  - Never call an external service (HTTP, queue) from inside it: enqueue AFTER it resolves, or better,
    write an outbox row inside it (Phase 28).
  - Races are settled by the database, not by retrying the callback: conditional updates
    (`updateMany` with the expected state in `where`) and unique constraints (P2002).
 */
export const withTransaction = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> =>
    prisma.$transaction(fn, { timeout: 15_000 });
