import { requireUser } from "@/lib/auth";
import { queryGraph } from "@/lib/query";
import { appendChat, getSession } from "@/lib/store";
import type { ChatTurn, GraphQueryResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
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
    const body = (await request.json()) as { question?: string };
    const question = (body.question ?? "").trim();
    if (!question) {
      return Response.json({ error: "Question is required" }, { status: 400 });
    }

    const result = await queryGraph(id, question);
    const turns: ChatTurn[] = [
      { id: `user-${Date.now()}`, role: "user", text: question },
      {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        text: result.answer,
        model: result.model,
        references: result.references,
        edgeReferences: result.edgeReferences,
      },
    ];
    appendChat(session, turns);
    return Response.json(result satisfies GraphQueryResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Query failed";
    const status = message.includes("not found") ? 404 : 500;
    return Response.json({ error: message }, { status });
  }
}
