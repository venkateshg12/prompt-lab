import { randomUUID } from "node:crypto";
import request from "supertest";
import { getApp } from "./app";
import { prisma } from "../../src/db/prisma";
import { hashValue } from "../../src/utils/auth/bcrypt";
import { signToken } from "../../src/utils/auth/jwt";
import { thirtyDaysFromNow } from "../../src/utils/date";
import type { OrgRole } from "@repo/types";
import type { Membership, Org, Session, User } from "../../src/generated/prisma/client";

export type TestActor = {
  user: User;
  session: Session;
  org: Org;
  membership: Membership;
  token: string;
  agent: ReturnType<typeof request.agent>;
};

// Hashed once: bcrypt per actor would dominate the suite's run time.
const passwordHash = hashValue("TestPassword123!");

/** A verified user with a live session and a membership, plus a supertest agent signed in as them. */
export const createActorWithRole = async (
  role: OrgRole = "owner",
  customOrg?: Org
): Promise<TestActor> => {
  const user = await prisma.user.create({
    data: {
      email: `test-${randomUUID()}@promptlab.test`,
      password: await passwordHash,
      role: "user",
      verified: true,
    },
  });

  const org =
    customOrg ??
    (await prisma.org.create({ data: { name: `Test Workspace ${randomUUID()}`, createdById: user.id } }));

  const session = await prisma.session.create({
    data: { userId: user.id, userAgent: "Vitest Agent", expiresAt: thirtyDaysFromNow() },
  });

  const membership = await prisma.membership.create({ data: { orgId: org.id, userId: user.id, role } });

  const token = signToken({ userId: user.id, sessionId: session.id, role: user.role });

  const agent = request.agent(getApp());
  agent.set("Authorization", `Bearer ${token}`);
  agent.set("x-org-id", org.id);

  return { user, session, org, membership, token, agent };
};

export const signedInOwner = (org?: Org) => createActorWithRole("owner", org);
export const signedInAdmin = (org?: Org) => createActorWithRole("admin", org);
export const signedInReviewer = (org?: Org) => createActorWithRole("reviewer", org);
export const signedInViewer = (org?: Org) => createActorWithRole("viewer", org);
