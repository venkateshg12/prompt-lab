"use client";

import { RunsList } from "@/components/runs/RunsList";

export default function RunsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Runs</h1>
        <p className="text-sm text-muted-foreground">Every benchmark run in this workspace, newest first.</p>
      </div>
      <RunsList />
    </div>
  );
}
