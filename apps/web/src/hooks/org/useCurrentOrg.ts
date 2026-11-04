import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { listMyOrgs } from "@/api/org";
import { useOrgStore } from "@/store/org.store";
import { useAuthStore } from "@/store/auth.store";
import type { FailureResponse, SuccessResponse } from "@/types";
import type { OrgSummary } from "@repo/types";

/*
  The signed-in user's workspaces and the selected one. The selection lives in the org store (and is
  sent as X-Org-Id); if it isn't in the list (a new account, or you were removed from it), the first
  workspace is selected, so every page always has a workspace to name in its URL.
 */
export function useCurrentOrg() {
    const user = useAuthStore((state) => state.user);
    const selectedOrgId = useOrgStore((state) => state.selectedOrgId);
    const setSelectedOrgId = useOrgStore((state) => state.setSelectedOrgId);

    const query = useQuery<SuccessResponse<OrgSummary[]>, FailureResponse>({
        queryKey: ["org", "list"],
        queryFn: listMyOrgs,
        enabled: Boolean(user),
        staleTime: 60 * 1000,
    });

    const orgs = query.data?.data ?? [];
    const selected = orgs.find((o) => o.id === selectedOrgId);
    const current = selected ?? orgs[0];

    useEffect(() => {
        if (current && current.id !== selectedOrgId) setSelectedOrgId(current.id);
    }, [current, selectedOrgId, setSelectedOrgId]);

    return {
        org: current,
        orgs,
        role: current?.role,
        isLoading: query.isLoading,
        isError: query.isError,
        error: query.error,
        setSelectedOrgId,
        refetch: query.refetch,
    };
}
