import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PublishedRunView } from "@/components/published/PublishedRunView";
import { publicUrl, type PublicRun } from "@/api/publish";
import type { SuccessResponse } from "@/types";

/*
  Server-rendered and cached for 60 s (Next's data cache), so a shared link is cheap. An unpublished
  slug can live up to 60 s more here; the page holds nothing that wasn't already public.
 */
const load = async (slug: string): Promise<PublicRun | null> => {
  const res = await fetch(publicUrl(`/runs/${encodeURIComponent(slug)}`), { next: { revalidate: 60 } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Couldn't load this run");
  return ((await res.json()) as SuccessResponse<PublicRun>).data;
};

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const run = await load((await params).slug);
  return { title: run ? `${run.title} · Prompt Lab` : "Not found · Prompt Lab" };
}

export default async function PublishedRunPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params; // params is a Promise since Next 15
  const run = await load(slug);
  if (!run) notFound();
  return <PublishedRunView run={run} />;
}
