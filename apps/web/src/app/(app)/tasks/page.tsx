"use client";

import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { NewTaskDialog } from "@/components/tasks/NewTaskDialog";
import { useTasks } from "@/hooks/tasks/useTasks";
import { useCurrentOrg } from "@/hooks/org/useCurrentOrg";

export default function TasksPage() {
  const { data, isLoading, isError } = useTasks();
  const { role } = useCurrentOrg();
  const tasks = data?.data ?? [];
  const canManage = role === "owner" || role === "admin";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Tasks</h1>
        {canManage && <NewTaskDialog />}
      </div>
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2"><Skeleton className="h-32" /><Skeleton className="h-32" /></div>
      ) : isError ? (
        <p className="text-sm text-destructive">Couldn&apos;t load your tasks.</p>
      ) : tasks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center">
          <p className="text-sm text-muted-foreground" data-testid="tasks-empty">
            No tasks yet. A task is the instructions plus the fields you want back, each with a scoring rule.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2" data-testid="task-list">
          {tasks.map((t) => (
            <Link key={t.id} href={`/tasks/${t.id}`} data-testid={`task-card-${t.slug}`} className="rounded-lg border border-border bg-card p-5 hover:border-primary/50 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-semibold text-foreground">{t.name}</h2>
                <span className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">v{t.version}</span>
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{t.description || t.slug}</p>
              <dl className="mt-4 grid grid-cols-4 gap-2 text-xs">
                <div><dt className="text-muted-foreground">Fields</dt><dd className="font-medium text-foreground">{t.fieldCount}</dd></div>
                <div><dt className="text-muted-foreground">Dev / test</dt><dd className="font-medium text-foreground">{t.devCount} / {t.testCount}</dd></div>
                <div><dt className="text-muted-foreground">Prompts</dt><dd className="font-medium text-foreground">{t.promptCount}</dd></div>
                <div><dt className="text-muted-foreground">Latest run</dt><dd className="font-medium text-foreground">{t.latestRun?.status ?? "none"}</dd></div>
              </dl>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
