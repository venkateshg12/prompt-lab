import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Phase 23's leak table: the demo path never writes a row, enqueues a job or caches anything a key touched.
describe("demo.service.ts stays storage-free", () => {
    const src = readFileSync(path.join(__dirname, "demo.service.ts"), "utf8");
    it("has no Prisma writes, no queue, no cache", () => {
        expect(src).not.toMatch(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/);
        expect(src).not.toMatch(/Queue|\.add\(|getOrSet|cache\./);
    });
    it("passes the visitor's key explicitly, so complete() never falls back to the server key", () => {
        expect(src).toMatch(/\{ complete, apiKey, signal \}/);
    });
});
