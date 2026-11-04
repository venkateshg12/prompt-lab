import { z } from "zod";

export const orgRoleSchema = z.enum(["owner", "admin", "reviewer", "viewer"]);
export type OrgRole = z.infer<typeof orgRoleSchema>;

export const updateOrgSchema = z.object({
    name: z.string().trim().min(2).max(120).optional(),
    monthlyBudgetUsd: z.number().min(0).max(1000).optional(), // owner only (budget.manage), checked in the service
});
export type UpdateOrgSchema = z.infer<typeof updateOrgSchema>;

export const deleteOrgSchema = z.object({ confirmName: z.string() });
export type DeleteOrgSchema = z.infer<typeof deleteOrgSchema>;

// A workspace as the API returns it (the code says Org, the UI says workspace).
export const orgSummarySchema = z.object({
    id: z.string(),
    name: z.string(),
    role: orgRoleSchema,
    monthlyBudgetUsd: z.number().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
});
export type OrgSummary = z.infer<typeof orgSummarySchema>;

/*
  Prompt Lab's permissions (architecture.md §3):
  - tasks.read / runs.read: tasks, examples, prompts, runs, results (everyone)
  - examples.second_label: write Example.secondLabel only (reviewer and up)
  - examples.manage: import, edit `expected`, split, tags, delete
  - tasks.manage, prompts.manage, runs.start, runs.publish, members.manage, org.update (admin and up)
  - org.delete, budget.manage (owner only)
 */
export const orgPermissionSchema = z.enum([
    "tasks.read",
    "runs.read",
    "examples.second_label",
    "examples.manage",
    "tasks.manage",
    "prompts.manage",
    "runs.start",
    "runs.publish",
    "members.manage",
    "org.update",
    "org.delete",
    "budget.manage",
]);
export type OrgPermission = z.infer<typeof orgPermissionSchema>;

export const changeMemberRoleSchema = z.object({
    role: orgRoleSchema,
});
export type ChangeMemberRoleInput = z.infer<typeof changeMemberRoleSchema>;

export const memberSummarySchema = z.object({
    userId: z.string(),
    email: z.string(),
    name: z.string(),
    role: orgRoleSchema,
    joinedAt: z.string().optional(),
});
export type MemberSummary = z.infer<typeof memberSummarySchema>;

export const inviteRoleSchema = z.enum(["admin", "reviewer", "viewer"]);
export type InviteRole = z.infer<typeof inviteRoleSchema>;

export const inviteSchema = z.object({
    email: z.string().trim().toLowerCase().email(),
    role: inviteRoleSchema,
});
export type InviteSchema = z.infer<typeof inviteSchema>;

// The invitation token travels in a URL fragment and in POST bodies, never in a path.
export const inviteTokenSchema = z.object({ token: z.string().min(20).max(200) });
export type InviteTokenSchema = z.infer<typeof inviteTokenSchema>;

export const pendingInviteSchema = z.object({
    id: z.string(),
    email: z.string(),
    role: inviteRoleSchema,
    invitedBy: z.string(),
    expiresAt: z.string(),
    createdAt: z.string().optional(),
});
export type PendingInvite = z.infer<typeof pendingInviteSchema>;

export const invitePreviewSchema = z.object({
    orgName: z.string(),
    emailMasked: z.string(),
    role: inviteRoleSchema,
});
export type InvitePreview = z.infer<typeof invitePreviewSchema>;
