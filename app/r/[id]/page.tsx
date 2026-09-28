import { ResearchWorkspace } from "@/components/ResearchWorkspace";
import { getCurrentUser } from "@/lib/auth";
import { stripeEnabled } from "@/lib/credits";
import { remoteSessionView, useRemoteStore } from "@/lib/remote";
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
    const query = await searchParams;
    return (
      <ResearchWorkspace
        user={user}
        stripeEnabled={stripeEnabled()}
        autoStart
        initialQuery={query.q?.trim() || undefined}
      />
    );
  }
  const initialSession = useRemoteStore()
    ? await remoteSessionView(id)
    : await (async () => {
        const session = await getSession(id);
        if (!session || session.userId !== user.id) return null;
        return toSessionView(session);
      })();
  if (!initialSession) notFound();
  return (
    <ResearchWorkspace
      user={user}
      stripeEnabled={stripeEnabled()}
      initialSession={initialSession}
    />
  );
}
