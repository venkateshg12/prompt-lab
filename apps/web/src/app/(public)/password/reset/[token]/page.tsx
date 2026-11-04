"use client";

import React, { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Loader2, CheckCircle2, Lock, Eye, EyeOff, ArrowLeft } from "lucide-react";
import { useResetPassword } from "@/hooks/auth/useResetPassword";
import { LoadingDots } from "@/components/ui/loading-dots";

export default function ResetPasswordPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const { mutate: reset, isPending, isSuccess, isError, error, data } = useResetPassword();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setValidationError(null);

    if (!password || !confirmPassword) {
      setValidationError("Please fill in all fields.");
      return;
    }

    if (password !== confirmPassword) {
      setValidationError("Passwords do not match.");
      return;
    }

    if (!token) {
      setValidationError("Reset token is missing.");
      return;
    }

    reset(
      { token, password, confirmPassword },
      {
        onSuccess: () => {
          setTimeout(() => {
            router.replace("/login");
          }, 2000);
        },
      }
    );
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 bg-muted/30 font-sans">
      <Card className="relative w-full max-w-md border border-border shadow-xl rounded-2xl bg-card p-6 md:p-8">
        <CardContent className="p-0 flex flex-col items-center text-center">
          {isSuccess ? (
            <>
              <div className="relative mb-5">
                <div className="relative flex items-center justify-center w-14 h-14 rounded-full shadow-md bg-emerald-600 text-white">
                  <CheckCircle2 className="w-7 h-7 text-white" />
                </div>
              </div>
              <div className="space-y-1.5 mb-6">
                <h1 className="text-xl font-bold tracking-tight text-foreground">
                  Password Reset Successful
                </h1>
                <p className="text-muted-foreground text-sm leading-relaxed max-w-[90%] mx-auto font-medium">
                  {data?.data?.message ||
                    "Your password has been successfully reset! Redirecting to login..."}
                </p>
              </div>
              <div className="py-2 mb-4">
                <LoadingDots />
              </div>
              <Button
                onClick={() => router.replace("/login")}
                className="w-full font-bold cursor-pointer"
              >
                Go to Login
              </Button>
            </>
          ) : (
            <>
              <div className="relative mb-5">
                <div className="relative flex items-center justify-center w-14 h-14 rounded-full shadow-md bg-primary text-primary-foreground">
                  <Lock className="w-7 h-7" />
                </div>
              </div>

              <div className="space-y-1.5 mb-4">
                <h1 className="text-xl font-bold tracking-tight text-foreground">
                  Reset Password
                </h1>
                <p className="text-muted-foreground text-sm leading-relaxed max-w-[90%] mx-auto font-medium">
                  Please enter your new password below.
                </p>
              </div>

              {(validationError || isError) && (
                <div className="w-full p-3.5 rounded-xl text-xs font-semibold mb-4 text-center border bg-destructive/10 border-destructive/20 text-destructive">
                  <p className="mt-1 font-medium">
                    {validationError ||
                      error?.errors?.[0]?.message ||
                      "Something went wrong. Please try again."}
                  </p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="w-full space-y-4 text-left">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="password"
                    className="font-semibold text-xs md:text-sm text-foreground"
                  >
                    New Password
                  </Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Enter new password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="pr-10"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0 text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label
                    htmlFor="confirmPassword"
                    className="font-semibold text-xs md:text-sm text-foreground"
                  >
                    Confirm Password
                  </Label>
                  <div className="relative">
                    <Input
                      id="confirmPassword"
                      type={showConfirmPassword ? "text" : "password"}
                      placeholder="Confirm new password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      className="pr-10"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0 text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={isPending}
                  className="w-full font-bold cursor-pointer flex items-center justify-center gap-2"
                >
                  {isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    "Reset Password"
                  )}
                </Button>
              </form>

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
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
