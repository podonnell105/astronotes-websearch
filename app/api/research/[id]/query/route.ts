import { queryGraph } from "@/lib/query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const body = (await request.json()) as { question?: string };
  const question = (body.question ?? "").trim();
  if (!question) {
    return Response.json({ error: "Question is required" }, { status: 400 });
  }

  try {
    const result = await queryGraph(id, question);
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Query failed";
    return Response.json({ error: message }, { status: 404 });
  }
}
