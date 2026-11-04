"use client";

import { useEffect, useRef } from "react";
import { useGoogleLogin } from "@/hooks/auth/useGoogleLogin";
import { GOOGLE_CLIENT_ID } from "@/constants/env";
import type { GoogleCredentialResponse } from "@/lib/google/google";
import { loadGoogleSdk } from "@/lib/google/loadGsi";

function isGoogleSdkReady(): boolean {
  return Boolean(window.google?.accounts?.id);
}

function initializeGoogleSignIn(
  buttonContainer: HTMLDivElement,
  onCredential: (response: GoogleCredentialResponse) => void
): void {
  if (!isGoogleSdkReady()) {
    return;
  }

  window.google!.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: onCredential,
    auto_select: false,
    error_callback: (error: unknown) => {
      console.error("[Google Identity Services Error]:", error);
    },
  });

  window.google!.accounts.id.renderButton(buttonContainer, {
    theme: "filled_blue",
    size: "medium",
    text: "continue_with",
    shape: "rectangular",
    width: buttonContainer.clientWidth || 300,
  });
}

export const GoogleSignInButton = () => {
  const buttonRef = useRef<HTMLDivElement>(null);
  const { mutate: loginWithGoogle } = useGoogleLogin();

  useEffect(() => {
    const handleCredentialResponse = (response: GoogleCredentialResponse) => {
      if (response.credential) {
        loginWithGoogle(response.credential);
      }
    };

    let cancelled = false;

    loadGoogleSdk()
      .then(() => {
        if (!cancelled && buttonRef.current) {
          initializeGoogleSignIn(buttonRef.current, handleCredentialResponse);
        }
      })
      .catch((err) => {
        console.error(err);
      });

    return () => {
      cancelled = true;
    };
  }, [loginWithGoogle]);

  return (
    <div className="w-full flex rounded-lg">
      <div
        ref={buttonRef}
        className="w-full flex"
        style={{ minHeight: "36px" }}
      />
    </div>
  );
};

export default GoogleSignInButton;
