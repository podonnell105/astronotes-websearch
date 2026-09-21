import { requireUser } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { createShare } from "@/lib/share";
import { getSession } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const session = getSession(id);
    if (!session || session.userId !== user.id) {
      return Response.json({ error: "Research session not found" }, { status: 404 });
    }
    const share = createShare(session);
    return Response.json(share);
  } catch (error) {
    return apiError(error);
  }
}
