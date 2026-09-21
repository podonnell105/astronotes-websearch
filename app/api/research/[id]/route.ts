import { requireUser } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { getSession, toSessionView } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const session = await getSession(id);
    if (!session || session.userId !== user.id) {
      return Response.json({ error: "Research session not found" }, { status: 404 });
    }
    return Response.json({ session: toSessionView(session) });
  } catch (error) {
    return apiError(error);
  }
}
