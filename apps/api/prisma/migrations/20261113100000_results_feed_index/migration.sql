-- Phase 21: the error browser's feed orders by (overall_score ASC NULLS FIRST, id): error cells
-- (no score) are the worst and come first. A NULLS LAST index can't serve that order, so the planner
-- sorted every page. Same columns and name as before (Prisma's schema is unchanged); only the null order differs.
DROP INDEX IF EXISTS "results_run_id_variant_id_overall_score_idx";
CREATE INDEX "results_run_id_variant_id_overall_score_idx" ON "results"("run_id", "variant_id", "overall_score" ASC NULLS FIRST);
