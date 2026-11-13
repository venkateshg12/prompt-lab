import "dotenv/config";
import { prisma } from "../db/prisma";
import { runAsSystem } from "../utils/requestContext";
import { closePubSub } from "../utils/events/pubsub";
import { closeAll } from "./closeAll";
import { flag } from "./args";

/*
  pnpm --filter api exec tsx src/scripts/promote-admin.ts --email you@example.com [--create]
  Makes an existing, verified account a PLATFORM admin (models, the probe, and owner runs when
  OWNER_RUNS_REQUIRE_ADMIN=true). Run once after the first deploy, from your machine, with the direct URL.
  --create (CI's throwaway database only): creates a verified account with NO password (it can't sign in).
 */
const main = async () => {
    const args = process.argv.slice(2);
    const email = flag(args, "--email")?.toLowerCase();
    if (!email) throw new Error("Usage: promote-admin --email you@example.com");
    await runAsSystem(async () => {
        const user = (await prisma.user.findUnique({ where: { email } })) ?? (args.includes("--create") ? await prisma.user.create({ data: { email, verified: true } }) : null);
        if (!user) throw new Error(`No account ${email}: sign up first`);
        if (!user.verified) throw new Error(`${email} hasn't verified its email yet`);
        await prisma.user.update({ where: { id: user.id }, data: { role: "admin" } });
        console.log(`${email} is now a platform admin`);
    });
};
main()
    .catch((e) => {
        console.error(e.message ?? e);
        process.exitCode = 1;
    })
    .finally(async () => {
        await closePubSub();
        await closeAll();
    });
