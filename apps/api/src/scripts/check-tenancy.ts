import "dotenv/config";
import { prisma } from "../db/prisma";
import { runWithRequestContext } from "../utils/requestContext";
import { cache } from "../utils/cache";
import { getQueueRedis } from "../config/redis";

const expectThrows = async (label: string, pattern: RegExp, fn: () => Promise<unknown>) => {
    try {
        await fn();
    } catch (error) {
        if (pattern.test((error as Error).message)) return;
        throw new Error(`${label}: threw the wrong error: ${(error as Error).message}`);
    }
    throw new Error(`${label}: did not throw`);
};

const A = "01a1a72d-0000-7000-8000-00000000000a";
const B = "01a1a72d-0000-7000-8000-00000000000b";

async function main() {
    await expectThrows("no scope", /Tenant scope missing/, () => prisma.auditLog.findMany({}));
    await expectThrows("cross-tenant", /Cross-tenant query refused/, () =>
        runWithRequestContext({ requestId: "check", orgId: A }, () => prisma.auditLog.findMany({ where: { orgId: B } }))
    );
    console.log("OK");
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        // Without these the script hangs on open handles.
        await prisma.$disconnect();
        await cache.close();
        await getQueueRedis().quit().catch(() => undefined);
    });
