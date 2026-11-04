"use client";

import { Suspense } from "react";
import GuestOnly from "@/components/auth/GuestOnly";
import RouteFallback from "@/components/common/RouteFallback";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
    return (
        <Suspense fallback={<RouteFallback />}>
            <GuestOnly>{children}</GuestOnly>
        </Suspense>
    );
}
