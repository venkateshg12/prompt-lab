import { create } from "zustand";
import { persist } from "zustand/middleware";

interface OrgState {
    selectedOrgId: string | null;
    setSelectedOrgId: (id: string | null) => void;
    clearOrg: () => void;
}

export const useOrgStore = create<OrgState>()(
    persist(
        (set) => ({
            selectedOrgId: null,
            setSelectedOrgId: (id: string | null) => set({ selectedOrgId: id }),
            clearOrg: () => set({ selectedOrgId: null }),
        }),
        {
            name: "promptlab-org-store",
        }
    )
);
