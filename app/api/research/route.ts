import { requireUser } from "@/lib/auth";
import { applyCors } from "@/lib/cors";
import { debitCredits, RESEARCH_CREDIT_COST } from "@/lib/credits";
import { apiError } from "@/lib/http";
import { runResearch } from "@/lib/pipeline";
import { normalizeSourcePolicy } from "@/lib/sources";
import { getSession, listSessionsForUser } from "@/lib/store";
import type { ResearchEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const user = await requireUser();
    return Response.json({ graphs: await listSessionsForUser(user.id) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as {
      query?: string;
      sessionId?: string;
      preferExistingLinks?: boolean;
      sourcePolicy?: unknown;
    };
    const query = (body.query ?? "").trim();
    if (!query) {
      return Response.json({ error: "Query is required" }, { status: 400 });
    }

    const sessionId = body.sessionId?.trim() || undefined;
    if (sessionId) {
      const existing = await getSession(sessionId);
      if (!existing || existing.userId !== user.id) {
        return Response.json({ error: "Research session not found" }, { status: 404 });
      }
    }
    const preferExistingLinks = Boolean(body.preferExistingLinks && sessionId);
    await debitCredits(
      user.id,
      RESEARCH_CREDIT_COST,
      sessionId ? "extend_graph" : "research_run",
      sessionId,
    );

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const emit = (event: ResearchEvent) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };
        try {
          await runResearch(query, emit, sessionId, {
            preferExistingLinks,
            userId: user.id,
            sourcePolicy: normalizeSourcePolicy(body.sourcePolicy),
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Research failed";
          emit({ type: "error", message });
        } finally {
          controller.close();
        }
      },
    });

    const headers = applyCors(
      request,
      new Headers({
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      }),
    );
    return new Response(stream, { headers });
  } catch (error) {
    return apiError(error);
  }
}
