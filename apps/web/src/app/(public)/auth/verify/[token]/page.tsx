"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { verifyEmail, resendVerificationEmail } from "@/api/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Loader2, X, Lightbulb, Mail, SendHorizontal, ArrowLeft, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { LoadingDots } from "@/components/ui/loading-dots";
import type { FailureResponse, SuccessResponse, VerifiedResponse } from "@/types";

export default function VerifyEmailPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;
  const router = useRouter();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");

  const {
    mutate: verify,
    isPending,
    isSuccess,
    isError,
    error,
    data,
  } = useMutation<SuccessResponse<VerifiedResponse>, FailureResponse, string>({
    mutationFn: verifyEmail,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      setTimeout(() => {
        router.replace("/tasks");
      }, 1500);
    },
  });

  useEffect(() => {
    if (token) {
      verify(token);
    }
  }, [token, verify]);

  const {
    mutate: resend,
    isPending: isResending,
    isSuccess: resendSuccess,
    isError: resendError,
    error: resendFailure,
    data: resendData,
  } = useMutation<SuccessResponse<VerifiedResponse>, FailureResponse, string>({
    mutationFn: resendVerificationEmail,
  });

  const handleResend = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (email.trim()) {
      resend(email.trim());
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 bg-muted/30 font-sans">
      <Card className="relative w-full max-w-md border border-border shadow-xl rounded-2xl bg-card p-6 md:p-8">
        <CardContent className="p-0 flex flex-col items-center text-center">
          {/* 1. Loading/Pending State */}
          {isPending && (
            <>
              <div className="relative mb-5">
                <div className="relative flex items-center justify-center w-14 h-14 rounded-full shadow-md bg-primary text-primary-foreground">
                  <Loader2 className="w-7 h-7 animate-spin" />
                </div>
              </div>
              <div className="space-y-1.5 mb-6">
                <h1 className="text-xl font-bold tracking-tight text-foreground">
                  Verifying Email
                </h1>
                <p className="text-muted-foreground text-sm leading-relaxed max-w-[90%] mx-auto font-medium">
                  Please wait while we confirm your email address.
                </p>
              </div>
              <div className="py-2 mb-4">
                <LoadingDots />
              </div>
            </>
          )}

          {/* 2. Success State */}
          {isSuccess && (
            <>
              <div className="relative mb-5">
                <div className="relative flex items-center justify-center w-14 h-14 rounded-full shadow-md bg-emerald-600 text-white">
                  <CheckCircle2 className="w-7 h-7" />
                </div>
              </div>
              <div className="space-y-1.5 mb-6">
                <h1 className="text-xl font-bold tracking-tight text-foreground">
                  Account Verified
                </h1>
                <p className="text-muted-foreground text-sm leading-relaxed max-w-[90%] mx-auto font-medium">
                  {data?.data?.message || "Your email has been successfully verified! Redirecting ..."}
                </p>
              </div>
              <div className="py-2 mb-4">
                <LoadingDots />
              </div>
            </>
          )}

          {/* 3. Error/Expired State */}
          {isError && (
            <>
              <div className="relative mb-4">
                <div className="relative flex items-center justify-center w-14 h-14 rounded-full shadow-md bg-destructive text-destructive-foreground">
                  <X className="w-7 h-7 stroke-[3px]" />
                </div>
              </div>

              <div className="space-y-1.5 mb-4">
                <h1 className="text-xl font-bold tracking-tight text-foreground">
                  Verification Link Expired
                </h1>
                <p className="text-muted-foreground text-sm leading-relaxed max-w-[90%] mx-auto font-medium">
                  {error?.errors?.[0]?.message ||
                    "This verification link is no longer valid. It may have expired or has already been used."}
                </p>
              </div>

              <div className="flex items-center gap-3 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-left mb-6">
                <div className="shrink-0 w-7 h-7 rounded-full bg-background flex items-center justify-center shadow-xs">
                  <Lightbulb className="w-4 h-4 text-amber-500" />
                </div>
                <p className="text-xs leading-tight font-medium text-foreground">
                  Don&apos;t worry! Enter your email below to get a new activation link.
                </p>
              </div>

              {/* Resend Status Inline Message Box */}
              {(isResending || resendSuccess || resendError) && (
                <div
                  className={cn(
                    "w-full p-3.5 rounded-xl text-xs font-semibold mb-6 text-left border transition-all duration-300",
                    isResending && "bg-primary/10 border-primary/20 text-primary",
                    resendSuccess && "bg-emerald-500/10 border-emerald-500/20 text-emerald-600",
                    resendError && "bg-destructive/10 border-destructive/20 text-destructive"
                  )}
                >
                  {isResending ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                      Sending verification email...
                    </span>
                  ) : resendSuccess ? (
                    <>
                      <p className="font-bold">Email Sent</p>
                      <p className="mt-1 font-medium">
                        {resendData?.data?.message ||
                          "A new verification link has been sent to your inbox. Please check your spam folder too."}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-bold">Failed to Resend</p>
                      <p className="mt-1 font-medium">
                        {resendFailure?.errors?.[0]?.message ||
                          "Something went wrong. Please try again."}
                      </p>
                    </>
                  )}
                </div>
              )}

              <div className="w-full space-y-4">
                <div className="relative flex items-center justify-center">
                  <Separator className="w-full" />
                  <span className="absolute px-3 bg-card text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                    Resend Verification Email
                  </span>
                </div>

                <form onSubmit={handleResend} className="space-y-3">
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      type="email"
                      placeholder="Enter your registered email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="pl-10 pr-4"
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={isResending}
                    className="w-full font-bold cursor-pointer flex items-center justify-center gap-2"
                  >
                    {isResending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <SendHorizontal className="w-4 h-4" />
                        Send New Link
                      </>
                    )}
                  </Button>
                </form>
              </div>
            </>
          )}

          {/* Footer Navigation */}
          <div className="w-full mt-6 space-y-4">
            <Separator className="w-full" />
            <Button
              variant="ghost"
              className="w-full border border-border text-muted-foreground hover:text-foreground font-semibold flex items-center justify-center gap-2 text-sm cursor-pointer"
              onClick={() => router.push("/login")}
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Login
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
