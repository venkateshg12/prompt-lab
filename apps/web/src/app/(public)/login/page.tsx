"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff } from "lucide-react";
import { useLogin } from "@/hooks/auth/useLogin";
import { AlertPopup } from "@/components/ui/alert-popup";
import { LoadingDots } from "@/components/ui/loading-dots";
import GoogleSignInButton from "@/components/auth/GoogleSignInButton";
import type { AlertType, FailureResponse } from "@/types";

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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

  const { mutate: signIn, isPending } = useLogin();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    signIn(
      {
        email,
        password,
      },
      {
        onError: (error: FailureResponse) => {
          setPopup({
            isOpen: true,
            type: "error",
            title: "Error Occurred",
            description:
              error.errors?.[0]?.message || "Invalid credentials. Please try again.",
          });
        },
      }
    );
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
            Login to your account
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <div className="grid flex-col gap-5">
              <div className="grid gap-1.5">
                <Label htmlFor="email" className="font-semibold text-sm">
                  Email
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
              <div className="grid gap-1.5">
                <Label htmlFor="password" className="font-semibold text-sm">
                  Password
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    onChange={(e) => setPassword(e.target.value)}
                    value={password}
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    className="pr-10"
                    required
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <div className="flex justify-end">
                  <Link
                    href="/password/forgot"
                    className="text-xs font-semibold text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
                  >
                    Forgot your password?
                  </Link>
                </div>
              </div>
            </div>
            <div className="grid gap-3 mt-6">
              <Button
                type="submit"
                disabled={isPending}
                className="w-full cursor-pointer font-semibold"
              >
                {isPending ? <LoadingDots /> : "Sign in"}
              </Button>
              <div className="flex items-center gap-2 justify-center my-1">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">Or</span>
                <div className="h-px flex-1 bg-border" />
              </div>
              <GoogleSignInButton />
            </div>
            <div className="flex justify-center mt-6 text-sm text-muted-foreground">
              <p>Don&apos;t have an account?&nbsp;</p>
              <Link
                href="/register"
                className="font-semibold text-primary underline-offset-4 hover:underline"
              >
                Sign up
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
        onClose={() => setPopup((prev) => ({ ...prev, isOpen: false }))}
        onAction={popup.onAction}
      />
    </div>
  );
}
