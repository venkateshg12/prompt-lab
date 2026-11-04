import { describe, expect, it } from "vitest";
import { tenantOrgId } from "./prisma";
import { runAsSystem, runWithRequestContext } from "../utils/requestContext";

describe("tenant scope", () => {
    it("throws with no context: a forgotten scope must crash, not leak", () => {
        expect(() => tenantOrgId("Result.findMany")).toThrow(/Tenant scope missing/);
    });
    it("is null inside runAsSystem (explicit cross-workspace work)", () => {
        expect(runAsSystem(() => tenantOrgId("Run.findUnique"))).toBeNull();
    });
    it("is the request's org, lower-cased", () => {
        const id = "0193A2B4-0000-7000-8000-000000000001";
        expect(runWithRequestContext({ requestId: "t", orgId: id }, () => tenantOrgId("x"))).toBe(id.toLowerCase());
    });
});
