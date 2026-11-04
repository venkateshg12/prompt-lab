import { z } from "zod";

export interface VerifyEmailPayload {
  userId: string;
  email: string;
  verificationToken: string;
}

export interface PasswordResetPayload {
  userId: string;
  email: string;
  resetToken: string;
}

export interface OrgInvitePayload {
  inviteId: string;
  email: string;
  orgName: string;
  role: "admin" | "reviewer" | "viewer";
  token: string;
}

export const orgInvitePayloadSchema = z.object({
  inviteId: z.string().min(1),
  email: z.string().email(),
  orgName: z.string().min(1),
  role: z.enum(["admin", "reviewer", "viewer"]),
  token: z.string().min(1),
});

// Phase 17: RunFinishedPayload, RunCellPayload
