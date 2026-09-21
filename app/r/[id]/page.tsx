import { ResearchWorkspace } from "@/components/ResearchWorkspace";
import { getCurrentUser } from "@/lib/auth";
import { stripeEnabled } from "@/lib/credits";
import { getSession, toSessionView } from "@/lib/store";
import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ResearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  if (id === "new") {
    const { q } = await searchParams;
    return (
      <ResearchWorkspace
        user={user}
        stripeEnabled={stripeEnabled()}
        autoStart
        initialQuery={q?.trim() || undefined}
      />
    );
  }
  const session = getSession(id);
  if (!session || session.userId !== user.id) notFound();
  return (
    <ResearchWorkspace
      user={user}
      stripeEnabled={stripeEnabled()}
      initialSession={toSessionView(session)}
    />
  );
}
