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

export interface RunFinishedPayload {
  runId: string;
  orgId: string;
  startedById: string;
  taskName: string;
  status: "completed" | "cancelled";
  totalCells: number;
  errorCells: number;
}

export const runFinishedPayloadSchema = z.object({
  runId: z.string().min(1),
  orgId: z.string().min(1),
  startedById: z.string().min(1),
  taskName: z.string().min(1),
  status: z.enum(["completed", "cancelled"]),
  totalCells: z.number().int(),
  errorCells: z.number().int(),
});
// Cell and finalize payloads live in @repo/types (cellPayloadSchema, finalizePayloadSchema).
