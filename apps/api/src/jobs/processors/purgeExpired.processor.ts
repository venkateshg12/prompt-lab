import { prisma } from "../../db/prisma";
import { runAsSystem } from "../../utils/requestContext";

/*
  PostgreSQL has no TTL indexes, so this hourly job deletes expired rows. Reads never depend on it
  having run: every lookup of these rows also checks expiry itself. Deleting expired sessions
  directly (not via revokeSessions) is the one allowed exception: an expired session already fails
  authenticate's database check, and its cache key lives at most 60 s.
 */
export async function processPurgeExpired(now = new Date()) {
    return runAsSystem(async () => {
        const [sessions, verificationLinks, invites] = await Promise.all([
            prisma.session.deleteMany({ where: { expiresAt: { lt: now } } }),
            prisma.verificationLink.deleteMany({ where: { expiresAt: { lt: now } } }),
            prisma.invite.deleteMany({ where: { expiresAt: { lt: now } } }),
        ]);
        return { sessions: sessions.count, verificationLinks: verificationLinks.count, invites: invites.count };
    });
}
