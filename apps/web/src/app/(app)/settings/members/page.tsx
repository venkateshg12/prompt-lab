"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Users,
  Trash2,
  AlertCircle,
  CheckCircle2,
  UserCheck,
  Crown,
  ChevronRight,
  UserPlus,
  Mail,
  Clock,
  X,
} from "lucide-react";
import {
  listMembers,
  changeMemberRole,
  removeMember,
  createInvite,
  listPendingInvites,
  revokeInvite,
} from "@/api/org";
import { useCurrentOrg } from "@/hooks/org/useCurrentOrg";
import { useAuthStore } from "@/store/auth.store";
import { Button } from "@/components/ui/button";
import type { OrgRole, MemberSummary, PendingInvite, InviteRole } from "@repo/types";
import { getErrorMessage } from "@/lib/errorMessage";

const ROLE_OPTIONS: { role: OrgRole; label: string; desc: string }[] = [
  { role: "owner", label: "Owner", desc: "Everything, including the budget and deleting the workspace" },
  { role: "admin", label: "Admin", desc: "Tasks, test sets, prompts, runs, publishing and members" },
  { role: "reviewer", label: "Reviewer", desc: "Can add second labels, can't edit your labels or start runs" },
  { role: "viewer", label: "Viewer", desc: "Read-only access to tasks, runs and results" },
];

// Who can invite whom (mirrors the API's INVITABLE: owners are promoted, never invited).
const INVITABLE: Record<OrgRole, InviteRole[]> = {
  owner: ["admin", "reviewer", "viewer"],
  admin: ["reviewer", "viewer"],
  reviewer: [],
  viewer: [],
};

export default function MembersSettingsPage() {
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((state) => state.user);
  const { org, role: currentRole } = useCurrentOrg();

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Invite modal state
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<InviteRole>("reviewer");

  const {
    data: membersData,
    isLoading: membersLoading,
    error: membersError,
  } = useQuery({
    queryKey: ["org", "members", org?.id],
    queryFn: () => listMembers(org!.id),
    enabled: Boolean(org?.id),
  });

  const {
    data: invitesData,
  } = useQuery({
    queryKey: ["org", "invites", org?.id],
    queryFn: () => listPendingInvites(org!.id),
    enabled: Boolean(org?.id && (currentRole === "owner" || currentRole === "admin")),
  });

  const members = membersData?.data?.members || [];
  const pendingInvites = invitesData?.data?.invites || [];

  const changeRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: OrgRole }) =>
      changeMemberRole(org!.id, userId, role),
    onSuccess: () => {
      setErrorMsg(null);
      setSuccessMsg("Member role updated successfully");
      queryClient.invalidateQueries({ queryKey: ["org", "members", org?.id] });
      setTimeout(() => setSuccessMsg(null), 3000);
    },
    onError: (err: unknown) => {
      setSuccessMsg(null);
      setErrorMsg(getErrorMessage(err, "Failed to update member role"));
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => removeMember(org!.id, userId),
    onSuccess: () => {
      setErrorMsg(null);
      setSuccessMsg("Member removed successfully");
      queryClient.invalidateQueries({ queryKey: ["org", "members", org?.id] });
      setTimeout(() => setSuccessMsg(null), 3000);
    },
    onError: (err: unknown) => {
      setSuccessMsg(null);
      setErrorMsg(getErrorMessage(err, "Failed to remove member"));
    },
  });

  const sendInviteMutation = useMutation({
    mutationFn: ({ email, role }: { email: string; role: InviteRole }) =>
      createInvite(org!.id, email, role),
    onSuccess: () => {
      setErrorMsg(null);
      setSuccessMsg(`Invitation sent to ${inviteEmail}`);
      setShowInviteModal(false);
      setInviteEmail("");
      queryClient.invalidateQueries({ queryKey: ["org", "invites", org?.id] });
      setTimeout(() => setSuccessMsg(null), 4000);
    },
    onError: (err: unknown) => {
      setSuccessMsg(null);
      setErrorMsg(getErrorMessage(err, "Failed to send invitation"));
    },
  });

  const revokeInviteMutation = useMutation({
    mutationFn: (id: string) => revokeInvite(org!.id, id),
    onSuccess: () => {
      setErrorMsg(null);
      setSuccessMsg("Invitation revoked");
      queryClient.invalidateQueries({ queryKey: ["org", "invites", org?.id] });
      setTimeout(() => setSuccessMsg(null), 3000);
    },
    onError: (err: unknown) => {
      setSuccessMsg(null);
      setErrorMsg(getErrorMessage(err, "Failed to revoke invitation"));
    },
  });

  const canManageMembers = currentRole === "owner" || currentRole === "admin";
  const invitableRoles = currentRole ? INVITABLE[currentRole] : [];

  const getRoleBadge = (role: string) => {
    switch (role) {
      case "owner":
        return "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30";
      case "admin":
        return "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30";
      case "reviewer":
        return "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30";
      default:
        return "bg-muted text-muted-foreground border-border";
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
          <span>Settings</span>
          <ChevronRight className="h-3 w-3" />
          <span className="text-foreground font-medium">Members</span>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
              <Users className="h-6 w-6 text-primary" />
              Workspace Members
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage member roles and invitations for{" "}
              <span className="font-semibold text-foreground">{org?.name}</span>.
            </p>
          </div>

          {canManageMembers && (
            <Button
              onClick={() => setShowInviteModal(true)}
              className="flex items-center gap-2 cursor-pointer shadow-xs shrink-0 self-start sm:self-auto"
            >
              <UserPlus className="h-4 w-4" />
              <span>Invite Member</span>
            </Button>
          )}
        </div>
      </div>

      {/* Notifications */}
      {errorMsg && (
        <div className="flex items-center gap-2 p-3 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg animate-in fade-in-0 duration-150">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}
      {successMsg && (
        <div className="flex items-center gap-2 p-3 text-sm text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg animate-in fade-in-0 duration-150">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in-0">
          <div className="bg-card border border-border rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4 animate-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="font-bold text-lg text-foreground flex items-center gap-2">
                <Mail className="h-5 w-5 text-primary" />
                Invite to Workspace
              </h3>
              <button
                onClick={() => setShowInviteModal(false)}
                className="text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="text-xs text-muted-foreground">
              An invitation email will be sent with a single-use secure link valid for 7 days.
            </p>

            <div className="space-y-3">
              <div>
                <label htmlFor="invite-email" className="text-xs font-semibold text-foreground block mb-1">
                  Email Address
                </label>
                <input
                  id="invite-email"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="friend@example.com"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div>
                <label htmlFor="invite-role" className="text-xs font-semibold text-foreground block mb-1">Role</label>
                <select
                  id="invite-role"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as InviteRole)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  {ROLE_OPTIONS.filter((o) => (invitableRoles as OrgRole[]).includes(o.role)).map((o) => (
                    <option key={o.role} value={o.role}>
                      {o.label} — {o.desc}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowInviteModal(false)}
                className="cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!inviteEmail || sendInviteMutation.isPending}
                onClick={() =>
                  sendInviteMutation.mutate({ email: inviteEmail, role: inviteRole })
                }
                className="cursor-pointer"
              >
                {sendInviteMutation.isPending ? "Sending..." : "Send Invitation"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Role explanation cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {ROLE_OPTIONS.map((item) => (
          <div
            key={item.role}
            className="p-3.5 rounded-xl border border-border/70 bg-card text-card-foreground shadow-xs flex flex-col justify-between"
          >
            <div>
              <span
                className={`inline-block px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded border ${getRoleBadge(
                  item.role
                )}`}
              >
                {item.label}
              </span>
              <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{item.desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Pending Invites Table (if any) */}
      {canManageMembers && pendingInvites.length > 0 && (
        <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border bg-muted/20 flex items-center justify-between">
            <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              Pending Invitations ({pendingInvites.length})
            </h2>
          </div>
          <div className="divide-y divide-border">
            {pendingInvites.map((invite: PendingInvite) => (
              <div
                key={invite.id}
                className="px-5 py-3 flex items-center justify-between gap-4 hover:bg-muted/30 transition-colors"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-foreground">{invite.email}</span>
                    <span
                      className={`text-[9px] font-semibold uppercase px-1.5 py-0.2 rounded border ${getRoleBadge(
                        invite.role
                      )}`}
                    >
                      {invite.role}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Expires {new Date(invite.expiresAt).toLocaleDateString()}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => revokeInviteMutation.mutate(invite.id)}
                  disabled={revokeInviteMutation.isPending}
                  className="text-xs text-muted-foreground hover:text-destructive h-7 px-2 cursor-pointer"
                >
                  Revoke
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Members List Table */}
      <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-muted-foreground" />
            Active Members ({members.length})
          </h2>
          <span className="text-xs text-muted-foreground">
            Your role:{" "}
            <span className="font-semibold uppercase text-primary">{currentRole}</span>
          </span>
        </div>

        {membersLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground animate-pulse">
            Loading members...
          </div>
        ) : membersError ? (
          <div className="p-8 text-center text-sm text-destructive">
            Failed to load workspace members.
          </div>
        ) : members.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No members found in this workspace.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {members.map((member: MemberSummary) => {
              const isCurrentUser = member.email === currentUser?.email;
              const isTargetOwner = member.role === "owner";
              const canEditThisMember =
                canManageMembers &&
                (currentRole === "owner" || (currentRole === "admin" && !isTargetOwner));
              const canRemoveThisMember =
                canEditThisMember || (isCurrentUser && members.length > 1);

              return (
                <div
                  key={member.userId}
                  className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-sm shrink-0 border border-primary/20">
                      {isTargetOwner ? (
                        <Crown className="h-4 w-4 text-amber-500" />
                      ) : (
                        member.name.charAt(0).toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground truncate">
                          {member.name}
                        </span>
                        {isCurrentUser && (
                          <span className="text-[10px] font-semibold bg-primary/10 text-primary px-1.5 py-0.2 rounded border border-primary/20">
                            You
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                    {/* Role selector or badge */}
                    {canEditThisMember && !isCurrentUser ? (
                      <select
                        value={member.role}
                        onChange={(e) =>
                          changeRoleMutation.mutate({
                            userId: member.userId,
                            role: e.target.value as OrgRole,
                          })
                        }
                        disabled={changeRoleMutation.isPending}
                        className="text-xs rounded-lg border border-border bg-background px-2.5 py-1.5 text-foreground font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
                      >
                        {ROLE_OPTIONS.filter((o) =>
                          currentRole === "owner" ? true : o.role !== "owner"
                        ).map((opt) => (
                          <option key={opt.role} value={opt.role}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span
                        className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded border ${getRoleBadge(
                          member.role
                        )}`}
                      >
                        {member.role}
                      </span>
                    )}

                    {/* Remove/Leave Button */}
                    {canRemoveThisMember && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const confirmMsg = isCurrentUser
                            ? "Are you sure you want to leave this workspace?"
                            : `Are you sure you want to remove ${member.name} from this workspace?`;
                          if (window.confirm(confirmMsg)) {
                            removeMemberMutation.mutate(member.userId);
                          }
                        }}
                        disabled={removeMemberMutation.isPending}
                        className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 h-8 px-2 cursor-pointer"
                        title={isCurrentUser ? "Leave workspace" : "Remove member"}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
