import { clearAuthCookie } from "@/lib/auth";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await clearAuthCookie();
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
