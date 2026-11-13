import { catchError, AppError } from "../utils/errors";
import { demoRunRequestSchema, publishedSlugSchema } from "@repo/types";
import { NOT_FOUND, OK } from "../constants/https";
import { ok } from "../utils/api";
import { demoOptions, runDemo } from "../services/demo.service";

export const demoRunHandler = catchError(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const input = demoRunRequestSchema.parse(req.body);
    res.status(OK).json(ok(await runDemo(input, res.locals.providerKey as string)));
});

export const demoOptionsHandler = catchError(async (req, res) => {
    const slug = publishedSlugSchema.safeParse(req.params.slug);
    if (!slug.success) throw new AppError(NOT_FOUND, "Demo not found");
    res.status(OK).json(ok(await demoOptions(slug.data)));
});
