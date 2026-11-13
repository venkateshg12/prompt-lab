"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { PublishedList } from "@/components/published/PublishedList";
import { publicUrl, type PublicRunListItem } from "@/api/publish";
import type { SuccessResponse } from "@/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth.store";
import { Button } from "@/components/ui/button";

export default function RootPage() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const isBootstrapped = useAuthStore((state) => state.isBootstrapped);
  const published = useQuery({
    queryKey: ["public-runs"],
    queryFn: async () => ((await (await fetch(publicUrl("/runs"))).json()) as SuccessResponse<PublicRunListItem[]>).data,
  });

  // A signed-in user goes straight to the app; everyone else sees the landing page.
  useEffect(() => {
    if (isBootstrapped && user) {
      router.replace("/tasks");
    }
  }, [isBootstrapped, user, router]);

  return (
    <main className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="max-w-2xl w-full space-y-8">
        <div className="space-y-3">
          <p className="text-xl font-bold tracking-tight text-foreground">
            Prompt<span className="text-primary">Lab</span>
          </p>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-foreground">
            Which prompt, on which model, gives the best results, and at what cost and speed?
          </h1>
        </div>
        <ul className="space-y-2 text-muted-foreground">
          <li>A hand-labelled test set, split into dev and test.</li>
          <li>Every output scored by code, never by eye.</li>
          <li>Results you can open down to the single wrong field.</li>
        </ul>
        {published.data && published.data.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-medium text-foreground">Latest published results</h2>
            <PublishedList runs={published.data.slice(0, 5)} />
          </section>
        )}
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/r">See published results</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/demo">Try it with your own key</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
