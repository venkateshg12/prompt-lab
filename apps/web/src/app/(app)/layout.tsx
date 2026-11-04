"use client";

import Link from "next/link";
import RequireAuth from "@/components/auth/RequireAuth";
import { useAuthStore } from "@/store/auth.store";
import { useLogout } from "@/hooks/auth/useLogout";
import { Button } from "@/components/ui/button";
import { LogOut, User as UserIcon } from "lucide-react";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((state) => state.user);
  const { mutate: logout, isPending } = useLogout();

  return (
    <RequireAuth>
      <div className="min-h-screen bg-background flex flex-col">
        <header className="border-b border-border bg-card">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            <div className="flex items-center gap-5">
              <Link href="/tasks" className="text-xl font-bold tracking-tight text-foreground">
                Prompt<span className="text-primary">Lab</span>
              </Link>
              {/* Phase 10: <OrgSwitcher /> */}
              <nav className="flex items-center gap-4 text-sm font-medium">
                <Link href="/tasks" className="text-muted-foreground hover:text-foreground transition-colors">
                  Tasks
                </Link>
                <Link href="/runs" className="text-muted-foreground hover:text-foreground transition-colors">
                  Runs
                </Link>
                <Link href="/settings/published" className="text-muted-foreground hover:text-foreground transition-colors">
                  Published
                </Link>
                <Link href="/account" className="text-muted-foreground hover:text-foreground transition-colors">
                  Account
                </Link>
              </nav>
            </div>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <UserIcon className="h-4 w-4" />
                <span>{user?.name || user?.email}</span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => logout()}
                disabled={isPending}
                className="flex items-center gap-1.5 text-muted-foreground hover:text-destructive cursor-pointer"
              >
                <LogOut className="h-4 w-4" />
                <span>Sign out</span>
              </Button>
            </div>
          </div>
        </header>
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>
      </div>
    </RequireAuth>
  );
}
