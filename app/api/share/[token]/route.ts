import { apiError } from "@/lib/http";
import { getShare } from "@/lib/share";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await context.params;
    const session = await getShare(token);
    if (!session) {
      return Response.json({ error: "Share not found" }, { status: 404 });
    }
    return Response.json({ session });
  } catch (error) {
    return apiError(error);
  }
}
