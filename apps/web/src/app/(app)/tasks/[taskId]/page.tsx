"use client";

import { Suspense } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { RuleEditor, RulesTable, SchemaViewer } from "@/components/tasks/RulesPanel";
import { ExamplesTab } from "@/components/examples/ExamplesTab";
import { PromptsTab } from "@/components/prompts/PromptsTab";
import { RunsList } from "@/components/runs/RunsList";
import { useTask, useTasks } from "@/hooks/tasks/useTasks";
import { useCurrentOrg } from "@/hooks/org/useCurrentOrg";

const TABS = ["overview", "examples", "prompts", "runs"] as const;

function TaskPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { role } = useCurrentOrg();
  const { data, isLoading, isError } = useTask(taskId);
  const { data: list } = useTasks();
  const tab = (TABS as readonly string[]).includes(params.get("tab") ?? "") ? (params.get("tab") as string) : "overview";
  const hasTestRun = list?.data.find((t) => t.id === taskId)?.latestRun != null;

  const setTab = (next: string) => {
    const p = new URLSearchParams(params.toString());
    p.set("tab", next);
    router.replace(`${pathname}?${p.toString()}`);
  };

  if (isLoading) return <Skeleton className="h-48" />;
  if (isError || !data) return <p className="text-sm text-destructive" data-testid="task-missing">This task doesn&apos;t exist, or you don&apos;t have access to it.</p>;
  const { task, jsonSchema } = data.data;
  const canEdit = role === "owner" || role === "admin";

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs text-muted-foreground">Task · {task.slug}</p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground" data-testid="task-title">{task.name} <span className="text-sm font-normal text-muted-foreground" data-testid="task-version">v{task.version}</span></h1>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="examples" data-testid="tab-examples">Test set</TabsTrigger>
          <TabsTrigger value="prompts" data-testid="tab-prompts">Prompts</TabsTrigger>
          <TabsTrigger value="runs" data-testid="tab-runs">Runs</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="space-y-6 pt-4">
          <section><h2 className="mb-1 text-sm font-semibold text-foreground">Instructions</h2><p className="whitespace-pre-wrap text-sm text-muted-foreground" data-testid="task-instructions">{task.instructions}</p></section>
          <section className="space-y-2"><h2 className="text-sm font-semibold text-foreground">Field rules</h2><RulesTable fields={task.fields} /><RuleEditor key={task.version} task={task} canEdit={canEdit} /></section>
          <section className="space-y-2"><h2 className="text-sm font-semibold text-foreground">JSON Schema <span className="font-normal text-muted-foreground">(sent to structured-output mode)</span></h2><SchemaViewer fields={task.fields} /><span hidden data-testid="schema-props">{Object.keys((jsonSchema as { properties?: object }).properties ?? {}).length}</span></section>
        </TabsContent>
        <TabsContent value="examples" className="pt-4"><ExamplesTab taskId={taskId} fields={task.fields} hasTestRun={hasTestRun} /></TabsContent>
        <TabsContent value="prompts" className="pt-4"><PromptsTab taskId={taskId} /></TabsContent>
        <TabsContent value="runs" className="pt-4"><RunsList taskId={taskId} /></TabsContent>
      </Tabs>
    </div>
  );
}

// useSearchParams needs a Suspense boundary for static prerendering.
export default function Page() {
  return <Suspense fallback={<Skeleton className="h-48" />}><TaskPage /></Suspense>;
}
