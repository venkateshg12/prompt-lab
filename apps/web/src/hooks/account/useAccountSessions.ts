import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSessions, revokeSession } from "@/api/session";
import { useAuthStore } from "@/store/auth.store";
import type { ApiError, FailureResponse, SessionSummary, SuccessResponse, VerifiedResponse } from "@/types";

export function useAccountSessions() {
    const user = useAuthStore((state) => state.user);
    const queryClient = useQueryClient();

    const { data, isLoading, isError } = useQuery<SuccessResponse<SessionSummary[]>, FailureResponse>({
        queryKey: ["sessions"],
        queryFn: getSessions,
        enabled: Boolean(user),
        staleTime: 30 * 1000,
    });

    const revokeMutation = useMutation<SuccessResponse<VerifiedResponse>, ApiError, string>({
        mutationFn: revokeSession,
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sessions"] }),
    });

    return {
        sessions: data?.data ?? [],
        loading: isLoading,
        isError,
        revoke: (sessionId: string) => revokeMutation.mutate(sessionId),
        revokingSessionId: revokeMutation.isPending ? revokeMutation.variables : null,
        revokeError: revokeMutation.error,
    };
}
