"use client";

import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { getQueryClient } from "@/lib/queryClient";
import QueryDevtools from "@/components/common/QueryDevtools";
import ServerWakeNotice from "@/components/common/ServerWakeNotice";
import AuthLoader from "@/components/auth/AuthLoader";

export function Providers({ children }: { children: ReactNode }) {
    return (
        <QueryClientProvider client={getQueryClient()}>
            <QueryDevtools />
            <ServerWakeNotice />
            <AuthLoader>{children}</AuthLoader>
        </QueryClientProvider>
    );
}
