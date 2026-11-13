import { catchError } from "../utils/errors";
import { idSchema } from "@repo/types";
import { OK } from "../constants/https";
import { ok } from "../utils/api";
import { runMarkdown, runSummaryCsv, streamResultLines, streamResultsCsv } from "../services/export.service";

const runId = (req: { params: Record<string, unknown> }) => idSchema("run id").parse(req.params.runId);

export const exportResultsJsonlHandler = catchError(async (req, res) => {
    await streamResultLines(runId(req), res);
});

export const exportResultsCsvHandler = catchError(async (req, res) => {
    await streamResultsCsv(runId(req), res, req.query.includeText === "true");
});

export const exportSummaryCsvHandler = catchError(async (req, res) => {
    const id = runId(req);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="run-${id}.summary.csv"`);
    res.status(OK).send(await runSummaryCsv(req.orgId, id));
});

export const exportMarkdownHandler = catchError(async (req, res) => {
    res.status(OK).json(ok({ markdown: await runMarkdown(req.orgId, runId(req)) }));
});
