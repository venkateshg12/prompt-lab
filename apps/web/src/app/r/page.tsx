import Link from "next/link";
import { PublishedList } from "@/components/published/PublishedList";
import { publicUrl, type PublicRunListItem } from "@/api/publish";
import type { SuccessResponse } from "@/types";

/*
  Prerendered at build time, when the API may not be reachable (Vercel builds before the API is up): an
  unreachable API renders an empty list, and the 60 s revalidation fills it in on the next request.
 */
const load = async (): Promise<PublicRunListItem[]> => {
  try {
    const res = await fetch(publicUrl("/runs"), { next: { revalidate: 60 } });
    return res.ok ? ((await res.json()) as SuccessResponse<PublicRunListItem[]>).data : [];
  } catch {
    return [];
  }
};

export default async function PublishedRunsPage() {
  const runs = await load();
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-10 sm:px-6">
      <div>
        <Link href="/" className="text-xl font-bold tracking-tight text-foreground">Prompt<span className="text-primary">Lab</span></Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Published results</h1>
      </div>
      <PublishedList runs={runs} />
    </main>
  );
}
