import { logout } from "@/api/auth";
import { clearUserQueries } from "@/lib/queryClient";
import { useAuthStore } from "@/store/auth.store";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

export const useLogout = () => {
    const router = useRouter();
    const queryClient = useQueryClient();
    const clearAuth = useAuthStore((state) => state.clearAuth);

    return useMutation({
        mutationFn: logout,
        onSuccess: () => {
            queryClient.setQueryData(["profile"], null);
            clearAuth();
            clearUserQueries();
            router.replace("/login");
        },
    });
};
