"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useForgotPassword } from "@/hooks/auth/useForgotPassword";
import { AlertPopup } from "@/components/ui/alert-popup";
import { LoadingDots } from "@/components/ui/loading-dots";
import type { AlertType, FailureResponse } from "@/types";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [popup, setPopup] = useState<{
    isOpen: boolean;
    type: AlertType;
    title: string;
    description: string;
    onAction?: () => void;
  }>({
    isOpen: false,
    type: "info",
    title: "",
    description: "",
  });

  const { mutate: sendResetEmail, isPending } = useForgotPassword();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!email.trim()) return;

    sendResetEmail(email.trim(), {
      onSuccess: (response) => {
        setPopup({
          isOpen: true,
          type: "success",
          title: "Email Sent",
          description:
            response?.data?.message ||
            "Password reset link sent to your email. Please check your spam folder too.",
          onAction: () => {
            router.push("/login");
          },
        });
      },
      onError: (error: FailureResponse) => {
        const errorMsg =
          error?.errors?.[0]?.message ||
          "Something went wrong. Please try again.";
        setPopup({
          isOpen: true,
          type: "error",
          title: "Error Occurred",
          description: errorMsg,
        });
      },
    });
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-muted/30">
      <Card className="max-w-sm w-full rounded-xl shadow-lg border border-border bg-card">
        <CardHeader>
          <div className="text-center mb-2">
            <span className="text-2xl font-bold tracking-tight text-foreground">
              Prompt<span className="text-primary">Lab</span>
            </span>
          </div>
          <CardTitle className="text-center font-semibold tracking-wide text-foreground">
            Forgot Password
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <div className="grid flex-col gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="email" className="font-semibold text-sm">
                  Email Address
                </Label>
                <Input
                  id="email"
                  onChange={(e) => setEmail(e.target.value)}
                  value={email}
                  type="email"
                  placeholder="Enter your email"
                  required
                />
              </div>
            </div>
            <div className="grid gap-3 mt-6">
              <Button
                type="submit"
                disabled={isPending}
                className="w-full cursor-pointer font-semibold"
              >
                {isPending ? <LoadingDots /> : "Reset Password"}
              </Button>
            </div>
            <div className="flex justify-center mt-6 text-sm text-muted-foreground">
              <Link
                href="/login"
                className="font-semibold text-primary underline-offset-4 hover:underline"
              >
                Back to Login
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
      <AlertPopup
        isOpen={popup.isOpen}
        type={popup.type}
        title={popup.title}
        description={popup.description}
        onClose={() => {
          setPopup((prev) => ({ ...prev, isOpen: false }));
          if (popup.type === "success") {
            router.push("/login");
          }
        }}
      />
    </div>
  );
}
