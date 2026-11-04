"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import RouteFallback from "@/components/common/RouteFallback";
import { useAuthStore } from "@/store/auth.store";

function sanitizeRedirectUrl(url: string | null): string {
  if (!url) return "/tasks";
  // Open redirect guard: must start with / and not //
  if (url.startsWith("/") && !url.startsWith("//")) {
    return url;
  }
  return "/tasks";
}

const GuestOnly = ({ children }: { children: ReactNode }) => {
  const user = useAuthStore((state) => state.user);
  const isBootstrapped = useAuthStore((state) => state.isBootstrapped);
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (isBootstrapped && user) {
      const fromParam = searchParams.get("from");
      const target = sanitizeRedirectUrl(fromParam);
      router.replace(target);
    }
  }, [isBootstrapped, user, router, searchParams]);

  if (!isBootstrapped || user) return <RouteFallback />;
  return <>{children}</>;
};

export default GuestOnly;
