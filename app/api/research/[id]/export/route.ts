import { requireUser } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { buildPackCsv, buildPackMarkdown } from "@/lib/pack";
import { getSession, toSessionView } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const session = getSession(id);
    if (!session || session.userId !== user.id) {
      return Response.json({ error: "Research session not found" }, { status: 404 });
    }
    const format = new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "md";
    const view = toSessionView(session);
    const stamp = (view.frozenAt ?? view.createdAt).toString();
    if (format === "csv") {
      return new Response(buildPackCsv(view), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="astronotes-${id.slice(0, 8)}.csv"`,
        },
      });
    }
    return new Response(buildPackMarkdown(view), {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="astronotes-${id.slice(0, 8)}-${stamp}.md"`,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
