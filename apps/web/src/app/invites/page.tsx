"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Building2, AlertCircle, LogIn, UserPlus, ArrowRight } from "lucide-react";
import Link from "next/link";
import { previewInvite, acceptInvite } from "@/api/org";
import { useAuthStore } from "@/store/auth.store";
import { useOrgStore } from "@/store/org.store";
import { clearUserQueries } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/lib/errorMessage";
import { clearPendingInvite, readPendingToken, storePendingToken } from "@/lib/pendingInvite";

export default function InviteAcceptPage() {
  const router = useRouter();
  const currentUser = useAuthStore((state) => state.user);
  const setSelectedOrgId = useOrgStore((state) => state.setSelectedOrgId);

  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const fromFragment = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token");
    if (fromFragment) {
      storePendingToken(fromFragment);
      // Drop the fragment from the address bar and history.
      window.history.replaceState(null, "", "/invites");
      setToken(fromFragment);
    } else {
      setToken(readPendingToken());
    }
    setReady(true);
  }, []);

  const {
    data: previewData,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["invite", "preview", token],
    queryFn: () => previewInvite(token as string),
    enabled: Boolean(token),
    retry: false,
  });

  const preview = previewData?.data;

  const acceptMutation = useMutation({
    mutationFn: () => acceptInvite(token as string),
    onSuccess: (res) => {
      clearPendingInvite();
      if (res.data?.orgId) {
        setSelectedOrgId(res.data.orgId);
        clearUserQueries();
      }
      router.push("/tasks");
    },
    onError: (err: unknown) => {
      setErrorMsg(getErrorMessage(err, "Failed to accept invitation"));
    },
  });

  if (!ready || (token && isLoading)) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="p-8 rounded-2xl border border-border bg-card shadow-lg text-center max-w-md w-full animate-pulse">
          <Building2 className="h-10 w-10 text-muted-foreground mx-auto mb-4 animate-bounce" />
          <h2 className="text-lg font-bold text-foreground">Loading invitation...</h2>
          <p className="text-xs text-muted-foreground mt-1">Verifying your secure link</p>
        </div>
      </div>
    );
  }

  if (!token || isError || !preview) {
    const message = token
      ? getErrorMessage(error, "This invitation link is invalid, has expired, or was already accepted.")
      : "This invitation link is missing its token. Open the link from your email again.";

    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="p-8 rounded-2xl border border-destructive/30 bg-card shadow-lg text-center max-w-md w-full space-y-4">
          <div className="h-12 w-12 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto">
            <AlertCircle className="h-6 w-6" />
          </div>
          <h2 className="text-xl font-bold text-foreground">Invitation unavailable</h2>
          <p className="text-sm text-muted-foreground" data-testid="invite-error">{message}</p>
          <div className="pt-2">
            <Link href="/login">
              <Button variant="outline" className="w-full cursor-pointer">
                Return to login
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-md w-full p-8 rounded-2xl border border-border bg-card shadow-xl space-y-6 text-center animate-in fade-in-0 duration-200">
        <div className="h-14 w-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto text-primary">
          <Building2 className="h-7 w-7" />
        </div>

        <div>
          <span className="text-xs font-semibold text-primary uppercase tracking-wider">
            Workspace invitation
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-foreground mt-1">
            Join {preview.orgName}
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            You have been invited to collaborate as a{" "}
            <span className="font-semibold text-foreground uppercase">{preview.role}</span>.
          </p>
        </div>

        {errorMsg && (
          <div className="p-3 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg text-left flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span data-testid="invite-accept-error">{errorMsg}</span>
          </div>
        )}

        {currentUser ? (
          <div className="space-y-4 pt-2">
            <div className="p-3.5 rounded-xl bg-muted/40 border border-border/70 text-xs text-left">
              <p className="text-muted-foreground">
                Signed in as: <span className="font-semibold text-foreground">{currentUser.email}</span>
              </p>
              <p className="text-muted-foreground mt-0.5">
                Invited address: <span className="font-semibold text-foreground">{preview.emailMasked}</span>
              </p>
            </div>

            <Button
              onClick={() => acceptMutation.mutate()}
              disabled={acceptMutation.isPending}
              className="w-full flex items-center justify-center gap-2 py-5 text-sm font-semibold cursor-pointer shadow-md"
            >
              <span>{acceptMutation.isPending ? "Joining workspace..." : "Accept & join workspace"}</span>
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="space-y-4 pt-2">
            <p className="text-xs text-muted-foreground">
              Sign in or create an account with{" "}
              <span className="font-semibold text-foreground">{preview.emailMasked}</span> to accept
              this invitation.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <Link href="/login?from=/invites" className="w-full">
                <Button variant="outline" className="w-full flex items-center justify-center gap-1.5 cursor-pointer">
                  <LogIn className="h-4 w-4" />
                  <span>Sign in</span>
                </Button>
              </Link>
              <Link href="/register?from=/invites" className="w-full">
                <Button className="w-full flex items-center justify-center gap-1.5 cursor-pointer">
                  <UserPlus className="h-4 w-4" />
                  <span>Create account</span>
                </Button>
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
