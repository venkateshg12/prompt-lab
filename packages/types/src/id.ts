import { z } from "zod";

/*
  A row id as it travels over the wire: a UUID (the API generates time-ordered v7 ids). Validated in
  the shared schema so a malformed id is a 400 from Zod, never a database error on a uuid column, and
  the client gets the same rule.
 */
export const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const idSchema = (label = "id") =>
    z.string().regex(ID_PATTERN, { message: `Invalid ${label}` }).transform((id) => id.toLowerCase());

export const optionalId = (label: string) =>
    z.preprocess(
        (value) => (value === "" ? undefined : value),
        idSchema(label).optional()
    );

export const idParamSchema = z.object({ id: idSchema() });
