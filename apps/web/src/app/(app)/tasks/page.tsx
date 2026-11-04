"use client";

export default function TasksPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Tasks</h1>
      <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center">
        <p className="text-sm text-muted-foreground" data-testid="tasks-empty">
          No tasks yet. A task is the instructions plus the fields you want back, each with a scoring rule.
        </p>
      </div>
    </div>
  );
}
