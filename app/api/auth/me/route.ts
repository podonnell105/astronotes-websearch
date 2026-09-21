import { getCurrentUser } from "@/lib/auth";
import { stripeEnabled } from "@/lib/credits";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return Response.json({ user: null, stripe: stripeEnabled() });
    return Response.json({ user, stripe: stripeEnabled() });
  } catch (error) {
    return apiError(error);
  }
}
