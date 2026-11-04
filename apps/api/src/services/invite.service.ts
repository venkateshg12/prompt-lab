import { prisma } from "../db/prisma";
import { EmailProducer } from "../jobs/producers/email.producer";
import { createVerificationToken, hashVerificationToken } from "../utils/auth/verificationToken";
import { runAsSystem } from "../utils/requestContext";
import { recordAudit } from "./audit.service";
import appAssert from "../utils/errors/appAssert";
import { BAD_REQUEST, CONFLICT, FORBIDDEN, NOT_FOUND } from "../constants/https";
import type { InviteSchema, InviteRole, OrgRole, PendingInvite, InvitePreview } from "@repo/types";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface ActorCtx {
    orgId: string;
    userId: string;
    role: OrgRole;
}

// Owners are never invited (they're promoted); an admin can invite only reviewers and viewers;
// only an owner can invite an admin.
const INVITABLE: Record<OrgRole, readonly InviteRole[]> = {
    owner: ["admin", "reviewer", "viewer"],
    admin: ["reviewer", "viewer"],
    reviewer: [],
    viewer: [],
};

const findLiveInvite = (token: string) =>
    prisma.invite.findFirst({
        where: { tokenHash: hashVerificationToken(token), expiresAt: { gt: new Date() } },
    });

export const createInvite = async (
    ctx: ActorCtx,
    { email, role }: InviteSchema
) => {
    appAssert(
        INVITABLE[ctx.role].includes(role),
        FORBIDDEN,
        ctx.role === "admin" ? "Only an owner can invite another admin" : "You can't invite people"
    );
    const normalisedEmail = email.toLowerCase().trim();

    // Check if the user exists and is already in the organisation
    const existingUser = await prisma.user.findUnique({ where: { email: normalisedEmail }, select: { id: true } });
    if (existingUser) {
        const member = await prisma.membership.findUnique({
            where: { orgId_userId: { orgId: ctx.orgId, userId: existingUser.id } },
            select: { id: true },
        });
        appAssert(!member, CONFLICT, "That person is already a member of this workspace");
    }

    // Only the newest invitation for this email in this org is valid
    await prisma.invite.deleteMany({ where: { orgId: ctx.orgId, email: normalisedEmail } });

    const { token, tokenHash } = createVerificationToken();
    const expiresAt = new Date(Date.now() + SEVEN_DAYS_MS);

    const invite = await prisma.invite.create({
        data: {
            orgId: ctx.orgId,
            email: normalisedEmail,
            role,
            tokenHash,
            invitedById: ctx.userId,
            expiresAt,
        },
    });

    const org = await prisma.org.findUnique({ where: { id: ctx.orgId }, select: { name: true } });
    const orgName = org?.name || "a workspace";

    await EmailProducer.sendOrgInvite({
        inviteId: invite.id,
        email: normalisedEmail,
        orgName,
        role,
        token,
    });

    await recordAudit({
        orgId: ctx.orgId,
        actor: { type: "user", id: ctx.userId },
        action: "member.invited",
        target: { type: "user", id: normalisedEmail },
        diff: { role },
    });

    return {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        invitedBy: invite.invitedById,
        expiresAt: invite.expiresAt.toISOString(),
    };
};

export const listPendingInvites = async (orgId: string): Promise<PendingInvite[]> => {
    const invites = await prisma.invite.findMany({
        where: { orgId, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
    });

    return invites.map((inv) => ({
        id: inv.id,
        email: inv.email,
        role: inv.role,
        invitedBy: inv.invitedById,
        expiresAt: inv.expiresAt.toISOString(),
        createdAt: inv.createdAt.toISOString(),
    }));
};

export const revokeInvite = async (orgId: string, inviteId: string, actorUserId: string) => {
    const invite = await prisma.invite.findFirst({ where: { id: inviteId, orgId } });
    appAssert(invite, NOT_FOUND, "Invitation not found");
    const { count } = await prisma.invite.deleteMany({ where: { id: inviteId, orgId } });
    appAssert(count === 1, NOT_FOUND, "Invitation not found");

    await recordAudit({
        orgId,
        actor: { type: "user", id: actorUserId },
        action: "invite.revoked",
        target: { type: "invite", id: inviteId },
        diff: { email: invite.email, role: invite.role },
    });

    return { revoked: true, inviteId };
};

export const maskEmail = (email: string): string => {
    const [namePart, domainPart] = email.split("@");
    if (!namePart || !domainPart) return email;
    const visiblePrefix = namePart.slice(0, 2);
    return `${visiblePrefix}**@${domainPart}`;
};

export const getInvitePreview = async (token: string): Promise<InvitePreview> => {
    return runAsSystem(async () => {
        const invite = await findLiveInvite(token);
        appAssert(invite, BAD_REQUEST, "This invitation has expired or was already used");

        const org = await prisma.org.findUnique({ where: { id: invite.orgId }, select: { name: true } });

        return {
            orgName: org?.name || "Workspace",
            emailMasked: maskEmail(invite.email),
            role: invite.role,
        };
    });
};

/*
  Runs WITHOUT resolveOrg (the user is not an org member yet), so it uses runAsSystem for the
  invite lookup — the token is the scope. The email equality check is what makes a leaked link useless.
 */
export const acceptInvite = async (userId: string, token: string) => {
    return runAsSystem(async () => {
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
        appAssert(user, NOT_FOUND, "User not found");

        const invite = await findLiveInvite(token);
        appAssert(invite, BAD_REQUEST, "This invitation has expired or was already used");
        appAssert(
            user.email.toLowerCase().trim() === invite.email.toLowerCase().trim(),
            FORBIDDEN,
            `This invitation is for ${invite.email}`
        );

        // Single use: only the first of two concurrent accepts deletes the row.
        const { count } = await prisma.invite.deleteMany({ where: { id: invite.id } });
        appAssert(count === 1, BAD_REQUEST, "This invitation has expired or was already used");

        // An existing membership keeps its role; the invite only ever adds one.
        await prisma.membership.upsert({
            where: { orgId_userId: { orgId: invite.orgId, userId } },
            create: { orgId: invite.orgId, userId, role: invite.role },
            update: {},
        });

        await recordAudit({
            orgId: invite.orgId,
            actor: { type: "user", id: userId },
            action: "invite.accepted",
            target: { type: "user", id: userId },
            diff: { email: invite.email, role: invite.role },
        });

        return { orgId: invite.orgId, role: invite.role };
    });
};
