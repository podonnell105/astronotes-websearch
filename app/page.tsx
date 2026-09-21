import { availableDataSources } from "@/lib/config";
import { HomeScreen } from "@/components/HomeScreen";
import { getCurrentUser } from "@/lib/auth";
import { stripeEnabled } from "@/lib/credits";
import { listSessionsForUser } from "@/lib/store";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <HomeScreen
      user={user}
      stripeEnabled={stripeEnabled()}
      graphs={await listSessionsForUser(user.id)}
      availableDataSources={availableDataSources()}
    />
  );
}
