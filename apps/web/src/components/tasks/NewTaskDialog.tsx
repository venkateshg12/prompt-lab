"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createTaskSchema, fieldRulesSchema } from "@repo/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCreateTask } from "@/hooks/tasks/useTasks";
import { getErrorMessage } from "@/lib/errorMessage";

// The case study's rules, so a new workspace can start from a working example (cases/job-postings/task.json).
const JOB_POSTINGS = {
  slug: "job-postings",
  name: "Job Posting Extractor",
  instructions:
    'Extract the job posting into the JSON fields described. Use null for anything the posting does not state. Never guess a salary: words like "competitive" mean null.',
  fields: [
    { kind: "text", key: "title" },
    { kind: "text", key: "company" },
    { kind: "text", key: "location" },
    { kind: "enum", key: "remote", values: ["remote", "hybrid", "onsite", "unknown"] },
    { kind: "enum", key: "employment_type", values: ["full_time", "part_time", "internship", "contract", "unknown"] },
    { kind: "integer", key: "experience_years_min", min: 0, max: 40 },
    { kind: "set_f1", key: "skills", synonyms: { js: "javascript", ts: "typescript", reactjs: "react", "react.js": "react", node: "node.js", nodejs: "node.js", postgres: "postgresql" } },
    { kind: "money", key: "stipend_or_salary", tolerance: 0.05 },
  ],
};

export function NewTaskDialog() {
  const router = useRouter();
  const create = useCreateTask();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [instructions, setInstructions] = useState("");
  const [rules, setRules] = useState("[\n  { \"kind\": \"text\", \"key\": \"title\" }\n]");
  const [error, setError] = useState<string | null>(null);

  const parsed = (() => {
    try {
      return fieldRulesSchema.safeParse(JSON.parse(rules));
    } catch (e) {
      return { success: false as const, error: { issues: [{ path: [], message: (e as Error).message }] } };
    }
  })();
  const rulesError = parsed.success ? null : parsed.error.issues.map((i) => `${i.path.join(".") || "rules"}: ${i.message}`).join("; ");

  const submit = () => {
    setError(null);
    const body = createTaskSchema.safeParse({ slug, name, instructions, fields: parsed.success ? parsed.data : [] });
    if (!body.success) return setError(body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    create.mutate(body.data, {
      onSuccess: (res) => {
        setOpen(false);
        router.push(`/tasks/${res.data.task.id}`);
      },
      onError: (e) => setError(getErrorMessage(e, "Could not create the task")),
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="cursor-pointer" data-testid="new-task"><Plus className="h-4 w-4" /> New task</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>A task is the instructions plus the fields you want back, each with a scoring rule.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Button type="button" variant="outline" size="sm" className="cursor-pointer" data-testid="load-example" onClick={() => { setName(JOB_POSTINGS.name); setSlug(JOB_POSTINGS.slug); setInstructions(JOB_POSTINGS.instructions); setRules(JSON.stringify(JOB_POSTINGS.fields, null, 2)); }}>
            Load the job-postings example
          </Button>
          <div className="grid grid-cols-2 gap-3">
            <Input aria-label="Name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <Input aria-label="Slug" placeholder="slug (lower-case, dashes)" value={slug} onChange={(e) => setSlug(e.target.value)} />
          </div>
          <Textarea aria-label="Instructions" placeholder="Instructions shared by every prompt ({{instructions}})" rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
          <Textarea aria-label="Field rules (JSON)" rows={10} className="font-mono text-xs" value={rules} onChange={(e) => setRules(e.target.value)} />
          {rulesError ? <p className="text-xs text-destructive" data-testid="rules-error">{rulesError}</p> : <p className="text-xs text-muted-foreground">{parsed.success ? parsed.data.length : 0} valid field rule(s)</p>}
          {error && <p className="text-xs text-destructive" data-testid="task-error">{error}</p>}
        </div>
        <DialogFooter>
          <Button disabled={create.isPending || !parsed.success || !name || !slug || !instructions} onClick={submit} className="cursor-pointer" data-testid="create-task">Create task</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
