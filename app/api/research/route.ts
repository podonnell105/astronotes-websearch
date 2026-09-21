import { runResearch } from "@/lib/pipeline";
import { getSession } from "@/lib/store";
import type { ResearchEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const body = (await request.json()) as {
    query?: string;
    sessionId?: string;
    preferExistingLinks?: boolean;
  };
  const query = (body.query ?? "").trim();
  if (!query) {
    return Response.json({ error: "Query is required" }, { status: 400 });
  }

  const sessionId = body.sessionId?.trim() || undefined;
  if (sessionId && !getSession(sessionId)) {
    return Response.json({ error: "Research session not found" }, { status: 404 });
  }
  const preferExistingLinks = Boolean(body.preferExistingLinks && sessionId);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: ResearchEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      try {
        await runResearch(query, emit, sessionId, { preferExistingLinks });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Research failed";
        emit({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
