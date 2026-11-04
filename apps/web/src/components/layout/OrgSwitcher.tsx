"use client";

import { useState, useRef, useEffect } from "react";
import { Building2, Check, ChevronDown, Users } from "lucide-react";
import Link from "next/link";
import { useCurrentOrg } from "@/hooks/org/useCurrentOrg";
import { useOrgStore } from "@/store/org.store";
import { clearUserQueries } from "@/lib/queryClient";
import type { OrgSummary } from "@repo/types";

export function OrgSwitcher() {
  const { org, orgs, role, isLoading } = useCurrentOrg();
  const selectedOrgId = useOrgStore((state) => state.selectedOrgId);
  const setSelectedOrgId = useOrgStore((state) => state.setSelectedOrgId);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);


  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelectOrg = (newOrgId: string) => {
    if (newOrgId !== selectedOrgId) {
      setSelectedOrgId(newOrgId);
      // Immediately clear cached queries so another org's data never flashes
      clearUserQueries();
    }
    setOpen(false);
  };

  const roleBadgeStyle = (r?: string) => {
    switch (r) {
      case "owner":
        return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";
      case "admin":
        return "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20";
      case "reviewer":
        return "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20";
      default:
        return "bg-muted text-muted-foreground border-border";
    }
  };

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/60 hover:bg-muted text-xs font-medium text-foreground border border-border/60 transition-all duration-150 cursor-pointer shadow-xs focus:outline-none focus:ring-2 focus:ring-primary/20"
        aria-expanded={open}
        aria-label="Workspace"
      >
        <Building2 className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="font-semibold truncate max-w-[140px] sm:max-w-[200px]">
          {isLoading ? "Loading..." : org?.name || "Select Workspace"}
        </span>
        {role && (
          <span
            className={`px-1.5 py-0.2 text-[10px] font-semibold uppercase tracking-wider rounded border ${roleBadgeStyle(
              role
            )}`}
          >
            {role}
          </span>
        )}
        <ChevronDown
          className={`h-3 w-3 text-muted-foreground transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div className="absolute left-0 mt-2 w-64 rounded-xl bg-card border border-border/80 shadow-xl py-1.5 z-50 animate-in fade-in-0 zoom-in-95 duration-100">
          <div className="px-3 py-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border/50">
            Workspaces
          </div>

          <div className="max-h-60 overflow-y-auto py-1">
            {orgs.map((o: OrgSummary) => {
              const isSelected = org?.id === o.id || selectedOrgId === o.id;
              return (
                <button
                  key={o.id}
                  onClick={() => handleSelectOrg(o.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 text-xs transition-colors hover:bg-accent cursor-pointer ${
                    isSelected ? "bg-accent/60 font-medium text-primary" : "text-foreground"
                  }`}
                >
                  <div className="flex items-center gap-2 truncate pr-2">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="truncate">{o.name}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className={`text-[9px] uppercase px-1 py-0.5 rounded border ${roleBadgeStyle(
                        o.role
                      )}`}
                    >
                      {o.role}
                    </span>
                    {isSelected && <Check className="h-3.5 w-3.5 text-primary" />}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="border-t border-border/50 pt-1 mt-1">
            <Link
              href="/settings/members"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <Users className="h-3.5 w-3.5" />
              <span>Workspace members</span>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
