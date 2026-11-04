import { login } from "@/api/auth";
import { useAuthStore } from "@/store/auth.store";
import type { FailureResponse, LoginResponse, SuccessResponse } from "@/types";
import type { LoginInSchema } from "@repo/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";

function sanitizeRedirect(url: string | null): string {
    if (!url) return "/tasks";
    if (url.startsWith("/") && !url.startsWith("//")) {
        return url;
    }
    return "/tasks";
}

export const useLogin = () => {
    const router = useRouter();
    const searchParams = useSearchParams();
    const queryClient = useQueryClient();
    const setUser = useAuthStore((state) => state.setUser);

    return useMutation<
        SuccessResponse<LoginResponse>,
        FailureResponse,
        LoginInSchema
    >({
        mutationFn: login,
        onSuccess: (response) => {
            setUser({
                id: response.data.user.id,
                name: response.data.user.name,
                email: response.data.user.email,
                avatar: response.data.user.avatar,
                role: response.data.user.role,
            });
            queryClient.setQueryData(["profile"], {
                status: "success",
                data: {
                    user: response.data.user,
                },
            });
            const targetPath = sanitizeRedirect(searchParams.get("from"));
            router.replace(targetPath);
        },
    });
};
