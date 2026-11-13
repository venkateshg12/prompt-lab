"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { DemoRunForm } from "@/components/demo/DemoRunForm";
import { useAuthStore } from "@/store/auth.store";

/* Public: try a published run's prompt on a few of its examples with your own key. Nothing is stored. */
function Demo() {
  const params = useSearchParams();
  const user = useAuthStore((s) => s.user);
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-10 sm:px-6">
      <div className="space-y-2">
        <Link href="/" className="text-xl font-bold tracking-tight text-foreground">Prompt<span className="text-primary">Lab</span></Link>
        <h1 className="text-2xl font-semibold tracking-tight">Try it with your own key</h1>
        <p className="text-sm text-muted-foreground">
          Run a published prompt on up to 10 of its public examples. Your key pays the provider for those calls; this server never stores it,
          never logs it, and never falls back to its own keys.
        </p>
        {user && <p className="text-xs text-muted-foreground" data-testid="run-properly">Want to keep the result? <Link href="/runs" className="underline">Run this properly</Link> in your workspace (a stored run on your workspace&apos;s keys and budget).</p>}
      </div>
      <DemoRunForm initialSlug={params.get("run") ?? undefined} />
    </main>
  );
}

export default function DemoPage() {
  return <Suspense fallback={null}><Demo /></Suspense>;
}
