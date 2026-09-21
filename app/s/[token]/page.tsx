import { ResearchWorkspace } from "@/components/ResearchWorkspace";
import { getShare } from "@/lib/share";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const view = getShare(token);
  if (!view) notFound();
  return <ResearchWorkspace initialSession={view} readOnly />;
}
