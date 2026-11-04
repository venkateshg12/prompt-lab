import { prisma } from "../db/prisma";
import { runAsSystem } from "../utils/requestContext";

const CASE_ORG_NAME = "Case studies";

export const flag = (args: string[], name: string): string | undefined => {
    const index = args.indexOf(name);
    return index !== -1 ? args[index + 1] : undefined; // check -1 first: args[indexOf + 1] reads args[0] when absent
};

/*
  Which workspace a CLI script acts in: --org <id>, or --email <user> (that user's first owned workspace),
  or the "Case studies" workspace owned by the first platform admin. Every Prisma call the script makes
  then runs inside runWithRequestContext({ orgId }), scoped exactly like a request.
 */
export const resolveOrgId = async (opts: { orgId?: string; email?: string }): Promise<string> => {
    if (opts.orgId) return opts.orgId;
    return runAsSystem(async () => {
        if (opts.email) {
            const user = await prisma.user.findUnique({ where: { email: opts.email.toLowerCase() } });
            if (!user) throw new Error(`No user ${opts.email}`);
            const membership = await prisma.membership.findFirst({ where: { userId: user.id, role: "owner" }, orderBy: { createdAt: "asc" } });
            if (!membership) throw new Error(`${opts.email} owns no workspace`);
            return membership.orgId;
        }
        const admin = await prisma.user.findFirst({ where: { role: "admin" }, orderBy: { createdAt: "asc" } });
        if (!admin) throw new Error('No platform admin to own the "Case studies" workspace: pass --org <orgId> or --email <you>');
        const existing = await prisma.org.findFirst({ where: { name: CASE_ORG_NAME, createdById: admin.id } });
        if (existing) return existing.id;
        const org = await prisma.org.create({ data: { name: CASE_ORG_NAME, createdById: admin.id } });
        await prisma.membership.create({ data: { orgId: org.id, userId: admin.id, role: "owner" } });
        return org.id;
    });
};

/** The workspace owner: a CLI --save run is started on their behalf. */
export const ownerOf = (orgId: string) =>
    runAsSystem(async () => {
        const m = await prisma.membership.findFirst({ where: { orgId, role: "owner" }, orderBy: { createdAt: "asc" } });
        if (!m) throw new Error("Workspace has no owner");
        return m.userId;
    });
