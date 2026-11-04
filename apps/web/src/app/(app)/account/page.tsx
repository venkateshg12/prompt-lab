"use client";

import React, { useState } from "react";
import { useAuthStore } from "@/store/auth.store";
import { useQueryClient } from "@tanstack/react-query";
import { updateProfile, changePassword } from "@/api/auth";
import { useAccountSessions } from "@/hooks/account/useAccountSessions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertPopup } from "@/components/ui/alert-popup";
import { LoadingDots } from "@/components/ui/loading-dots";
import { Laptop, ShieldCheck, User, Lock } from "lucide-react";
import type { AlertType, FailureResponse, SessionSummary } from "@/types";

const describeDevice = (userAgent?: string) => {
  if (!userAgent) return "Unknown device";

  const browser =
    /edg/i.test(userAgent) ? "Edge"
    : /chrome|crios/i.test(userAgent) ? "Chrome"
    : /firefox|fxios/i.test(userAgent) ? "Firefox"
    : /safari/i.test(userAgent) ? "Safari"
    : "Browser";

  const platform =
    /android/i.test(userAgent) ? "Android"
    : /iphone|ipad|ipod/i.test(userAgent) ? "iOS"
    : /windows/i.test(userAgent) ? "Windows"
    : /mac os/i.test(userAgent) ? "macOS"
    : /linux/i.test(userAgent) ? "Linux"
    : "";

  return platform ? `${browser} on ${platform}` : browser;
};

const formatSignedIn = (value: string) => {
  const date = new Date(value);
  return isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      });
};

function SessionRow({
  session,
  onRevoke,
  isRevoking,
}: {
  session: SessionSummary;
  onRevoke: (sessionId: string) => void;
  isRevoking: boolean;
}) {
  return (
    <li className="flex items-center justify-between p-4 border border-border rounded-lg bg-card/50">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
          <Laptop className="h-5 w-5" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-foreground">
              {describeDevice(session.userAgent)}
            </p>
            {session.isCurrent && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-primary/10 text-primary">
                This device
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Signed in {formatSignedIn(session.createdAt)}
          </p>
        </div>
      </div>

      {!session.isCurrent && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="cursor-pointer text-xs"
          disabled={isRevoking}
          onClick={() => onRevoke(session.id)}
        >
          {isRevoking ? "Signing out..." : "Sign out"}
        </Button>
      )}
    </li>
  );
}

export default function AccountPage() {
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const queryClient = useQueryClient();

  // Name state
  const [name, setName] = useState(user?.name || "");
  const [isUpdatingName, setIsUpdatingName] = useState(false);

  // Password state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  // Popup state
  const [popup, setPopup] = useState<{
    isOpen: boolean;
    type: AlertType;
    title: string;
    description: string;
  }>({
    isOpen: false,
    type: "info",
    title: "",
    description: "",
  });

  // Sessions hook
  const { sessions, loading: sessionsLoading, isError: sessionsError, revoke, revokingSessionId, revokeError } =
    useAccountSessions();

  const handleUpdateName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setIsUpdatingName(true);
    try {
      const res = await updateProfile({ name: name.trim() });
      if (res.data?.user) {
        setUser({
          id: res.data.user.id,
          name: res.data.user.name,
          email: res.data.user.email,
          avatar: res.data.user.avatar,
          role: res.data.user.role,
        });
        queryClient.setQueryData(["profile"], {
          status: "success",
          data: { user: res.data.user },
        });
      }
      setPopup({
        isOpen: true,
        type: "success",
        title: "Profile Updated",
        description: "Your profile name has been updated.",
      });
    } catch (err: unknown) {
      const error = err as FailureResponse;
      setPopup({
        isOpen: true,
        type: "error",
        title: "Update Failed",
        description: error?.errors?.[0]?.message || "Could not update name.",
      });
    } finally {
      setIsUpdatingName(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmNewPassword) {
      setPopup({
        isOpen: true,
        type: "error",
        title: "Mismatch",
        description: "New password and confirmation do not match.",
      });
      return;
    }
    setIsChangingPassword(true);
    try {
      await changePassword({ currentPassword, newPassword, confirmNewPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      setPopup({
        isOpen: true,
        type: "success",
        title: "Password Changed",
        description: "Your password has been changed successfully.",
      });
    } catch (err: unknown) {
      const error = err as FailureResponse;
      setPopup({
        isOpen: true,
        type: "error",
        title: "Change Failed",
        description: error?.errors?.[0]?.message || "Could not change password.",
      });
    } finally {
      setIsChangingPassword(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Account Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your profile, credentials, and active sessions.
        </p>
      </div>

      {/* Profile Name Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <User className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Profile Details</CardTitle>
          </div>
          <CardDescription>Update your personal information</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleUpdateName} className="space-y-4 max-w-md">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs font-semibold">
                Email
              </Label>
              <Input id="email" value={user?.email || ""} disabled className="bg-muted text-muted-foreground" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="role" className="text-xs font-semibold">
                Role
              </Label>
              <Input id="role" value={user?.role || "user"} disabled className="bg-muted text-muted-foreground" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="name" className="text-xs font-semibold">
                Full Name
              </Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter your name"
                required
              />
            </div>
            <Button type="submit" disabled={isUpdatingName} className="cursor-pointer">
              {isUpdatingName ? <LoadingDots /> : "Save Changes"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Change Password Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Change Password</CardTitle>
          </div>
          <CardDescription>Ensure your account is using a secure password</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleChangePassword} className="space-y-4 max-w-md">
            <div className="space-y-1.5">
              <Label htmlFor="currentPassword" className="text-xs font-semibold">
                Current Password
              </Label>
              <Input
                id="currentPassword"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="newPassword" className="text-xs font-semibold">
                New Password
              </Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirmNewPassword" className="text-xs font-semibold">
                Confirm New Password
              </Label>
              <Input
                id="confirmNewPassword"
                type="password"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={isChangingPassword} className="cursor-pointer">
              {isChangingPassword ? <LoadingDots /> : "Update Password"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Active Sessions Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Where you&apos;re signed in</CardTitle>
          </div>
          <CardDescription>
            Every device signed in to this account. Sign one out if you don&apos;t recognise it — it loses access immediately.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {revokeError && (
            <div className="p-3 mb-4 rounded-lg text-xs font-medium border bg-destructive/10 border-destructive/20 text-destructive">
              {revokeError.message || "Couldn&apos;t sign that device out. Please try again."}
            </div>
          )}

          {sessionsError ? (
            <div className="p-3 rounded-lg text-xs font-medium border bg-destructive/10 border-destructive/20 text-destructive">
              Couldn&apos;t load your devices. Please refresh and try again.
            </div>
          ) : sessionsLoading ? (
            <div className="py-4">
              <LoadingDots />
            </div>
          ) : (
            <ul className="space-y-3">
              {sessions.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  onRevoke={revoke}
                  isRevoking={revokingSessionId === session.id}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <AlertPopup
        isOpen={popup.isOpen}
        type={popup.type}
        title={popup.title}
        description={popup.description}
        onClose={() => setPopup((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
