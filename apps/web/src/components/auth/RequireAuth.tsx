"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import RouteFallback from "@/components/common/RouteFallback";
import { useAuthStore } from "@/store/auth.store";

const RequireAuth = ({ children }: { children: ReactNode }) => {
    const user = useAuthStore((state) => state.user);
    const isBootstrapped = useAuthStore((state) => state.isBootstrapped);
    const router = useRouter();
    const pathname = usePathname();

    useEffect(() => {
        if (isBootstrapped && !user) {
            router.replace(`/login?from=${encodeURIComponent(pathname)}`);
        }
    }, [isBootstrapped, user, router, pathname]);

    if (!isBootstrapped || !user) return <RouteFallback />;
    return <>{children}</>;
};

export default RequireAuth;
