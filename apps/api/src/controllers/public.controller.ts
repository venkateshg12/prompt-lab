import { z } from "zod";
import { cursorQuerySchema, idSchema, publishedSlugSchema, tagSchema } from "@repo/types";
import { NOT_FOUND, OK } from "../constants/https";
import { ok } from "../utils/api";
import { AppError, catchError } from "../utils/errors";
import { getPublicResults, getPublicRun, listPublicRuns } from "../services/publish.service";

/* A malformed slug is the same 404 as an unknown one: no hint about which slugs exist. */
const slugOf = (req: { params: Record<string, unknown> }) => {
    const parsed = publishedSlugSchema.safeParse(req.params.slug);
    if (!parsed.success) throw new AppError(NOT_FOUND, "Not found");
    return parsed.data;
};

export const listPublicRunsHandler = catchError(async (_req, res) => {
    res.status(OK).json(ok(await listPublicRuns()));
});

export const getPublicRunHandler = catchError(async (req, res) => {
    res.status(OK).json(ok(await getPublicRun(slugOf(req))));
});

export const getPublicResultsHandler = catchError(async (req, res) => {
    const slug = slugOf(req);
    const q = cursorQuerySchema
        .extend({
            variant: idSchema("variant id").optional(),
            field: z.string().regex(/^[a-z][a-z0-9_]{0,40}$/).optional(),
            reason: z.enum(["match", "mismatch", "partial", "missing", "wrong_type", "null_expected", "null_predicted", "currency_mismatch", "out_of_tolerance"]).optional(),
            tag: tagSchema.optional(),
            failedOnly: z.enum(["true", "false"]).optional(),
        })
        .parse(req.query);
    const { items, meta } = await getPublicResults(slug, { ...q, failedOnly: q.failedOnly === "true" });
    res.status(OK).json(ok(items, meta));
});
