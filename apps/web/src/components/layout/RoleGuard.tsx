"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth.store";
import type { UserRole } from "@/types";
import RouteFallback from "@/components/common/RouteFallback";

interface RoleGuardProps {
  allow: UserRole[];
  children: ReactNode;
}

export const RoleGuard = ({ allow, children }: RoleGuardProps) => {
  const user = useAuthStore((state) => state.user);
  const isBootstrapped = useAuthStore((state) => state.isBootstrapped);
  const router = useRouter();

  useEffect(() => {
    if (isBootstrapped) {
      if (!user || !allow.includes(user.role)) {
        router.replace("/inbox");
      }
    }
  }, [isBootstrapped, user, allow, router]);

  if (!isBootstrapped || !user || !allow.includes(user.role)) {
    return <RouteFallback />;
  }

  return <>{children}</>;
};

export default RoleGuard;
