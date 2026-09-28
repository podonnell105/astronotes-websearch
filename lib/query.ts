import { hasOpenAI } from "./config";
import { compactGraph } from "./graph";
import { QUERY_MODELS } from "./models";
import { annotateEntityMentions } from "./entityLinks";
import { getSession } from "./store";
import type { GraphEdgeReference, GraphQueryResponse } from "./types";

type CompactGraph = ReturnType<typeof compactGraph>;

export async function queryGraph(
  sessionId: string,
  question: string,
): Promise<GraphQueryResponse> {
  const session = await getSession(sessionId);
  if (!session) {
    throw new Error("Research session not found. Run research again.");
  }

  const graph = compactGraph(session);
  if (!hasOpenAI()) {
    return mockGraphAnswer(question, graph);
  }

  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const prompt = {
    system: `Answer using only the supplied knowledge graph. Return JSON:
{"answer":"markdown-free prose","entityIds":["id"],"relationshipIds":["id"]}
When you mention a graph entity, wrap that mention as [[id|Display Name]] using the entity's exact id and name. Write normal sentences; the wrappers become in-text links to those nodes.
Cite entities by name. entityIds and relationshipIds must be ids from the graph.
Include every relationship you used as context in relationshipIds.
If the graph cannot answer, say so.
Relationships may have knowledge fact, derived, inferred, uncertain, or contradicted, and basis recorded, extracted, or inferred. Inferred possible_overlap edges are possible connections with a reasoning chain — never describe them as proof of misconduct, a conflict of interest finding, or wrongdoing. Never treat inferred or uncertain edges as equivalent to facts.`,
    user: JSON.stringify({ question, graph }),
  };

  let raw = "{}";
  let lastError: unknown;
  for (const model of QUERY_MODELS) {
    try {
      const response = await client.responses.create({
        model,
        reasoning: { effort: "low" },
        text: { format: { type: "json_object" } },
        input: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
      });
      raw = response.output_text ?? "{}";
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      try {
        const completion = await client.chat.completions.create({
          model,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
          ],
        });
        raw = completion.choices[0]?.message?.content ?? "{}";
        lastError = undefined;
        break;
      } catch (chatError) {
        lastError = chatError;
      }
    }
  }
  if (lastError) {
    throw lastError;
  }

  const parsed = JSON.parse(raw) as {
    answer?: string;
    entityIds?: string[];
    relationshipIds?: string[];
  };

  const knownEntities = new Map(graph.entities.map((e) => [e.id, e.name]));
  const references = (parsed.entityIds ?? [])
    .filter((id) => knownEntities.has(id))
    .map((id) => ({ entityId: id, name: knownEntities.get(id) as string }));

  return {
    answer: annotateEntityMentions(
      parsed.answer || "The graph does not contain enough information to answer.",
      graph.entities,
      references.map((ref) => ref.entityId),
    ),
    references,
    edgeReferences: resolveEdgeReferences(
      graph,
      parsed.relationshipIds ?? [],
      references.map((ref) => ref.entityId),
    ),
    model: "openai",
  };
}

function mockGraphAnswer(
  question: string,
  graph: CompactGraph,
): GraphQueryResponse {
  const q = question.toLowerCase();
  const mentioned = graph.entities.filter((e) =>
    q.includes(e.name.toLowerCase()),
  );
  const names = mentioned.map((e) => e.name);
  const mentionedIds = new Set(mentioned.map((e) => e.id));

  let hops = graph.relationships.filter(
    (rel) => rel.validation?.decision !== "CONTRADICTED",
  );

  if (mentionedIds.size >= 2) {
    const neighbors = (id: string) =>
      new Set(
        hops
          .filter((rel) => rel.source === id || rel.target === id)
          .flatMap((rel) => [rel.source, rel.target]),
      );
    const ids = [...mentionedIds];
    const shared = ids.reduce<Set<string> | null>((acc, id) => {
      const n = neighbors(id);
      if (!acc) return n;
      return new Set([...acc].filter((x) => n.has(x)));
    }, null);
    const focusIds = new Set([...(shared ?? []), ...mentionedIds]);
    hops = hops.filter(
      (rel) => focusIds.has(rel.source) && focusIds.has(rel.target),
    );
  } else if (mentionedIds.size === 1) {
    hops = hops.filter(
      (rel) => mentionedIds.has(rel.source) || mentionedIds.has(rel.target),
    );
  } else {
    hops = hops.filter((rel) =>
      ["nasa", "nokia", "spacex"].includes(rel.source) ||
      ["nasa", "nokia", "spacex"].includes(rel.target),
    );
  }

  const used = hops.slice(0, 4);
  const lines = used.map((rel) => {
    const from = graph.entities.find((e) => e.id === rel.source)?.name ?? rel.source;
    const to = graph.entities.find((e) => e.id === rel.target)?.name ?? rel.target;
    return `${from} → ${rel.type} → ${to}`;
  });

  const title =
    names.length > 0
      ? `${names.join(" and ")} appear in this research graph.`
      : "The demo graph covers lunar communications actors.";

  const answer = [
    title,
    lines.length ? lines.join("\n") : "No connecting relationships were found.",
    "The underlying evidence is available in the graph.",
  ].join("\n\n");

  const referencedIds = new Set<string>(mentionedIds);
  for (const rel of used) {
    referencedIds.add(rel.source);
    referencedIds.add(rel.target);
  }

  return {
    answer: annotateEntityMentions(answer, graph.entities, [...referencedIds]),
    references: graph.entities
      .filter((e) => referencedIds.has(e.id))
      .map((e) => ({ entityId: e.id, name: e.name })),
    edgeReferences: used.map((rel) => toEdgeReference(graph, rel)),
    model: "mock",
  };
}

function resolveEdgeReferences(
  graph: CompactGraph,
  relationshipIds: string[],
  entityIds: string[],
): GraphEdgeReference[] {
  const byId = new Map(graph.relationships.map((rel) => [rel.id, rel]));
  const seen = new Set<string>();
  const selected: CompactGraph["relationships"] = [];

  for (const id of relationshipIds) {
    const rel = byId.get(id);
    if (!rel || seen.has(rel.id)) continue;
    seen.add(rel.id);
    selected.push(rel);
  }

  if (selected.length === 0 && entityIds.length > 0) {
    const focus = new Set(entityIds);
    for (const rel of graph.relationships) {
      if (seen.has(rel.id)) continue;
      const bothEnds = focus.has(rel.source) && focus.has(rel.target);
      const incident = focus.has(rel.source) || focus.has(rel.target);
      if (entityIds.length >= 2 ? bothEnds : incident) {
        seen.add(rel.id);
        selected.push(rel);
      }
    }
  }

  return selected.map((rel) => toEdgeReference(graph, rel));
}

function toEdgeReference(
  graph: CompactGraph,
  rel: CompactGraph["relationships"][number],
): GraphEdgeReference {
  const sourceName =
    graph.entities.find((e) => e.id === rel.source)?.name ?? rel.source;
  const targetName =
    graph.entities.find((e) => e.id === rel.target)?.name ?? rel.target;
  return {
    relationshipId: rel.id,
    type: rel.type,
    sourceId: rel.source,
    targetId: rel.target,
    sourceName,
    targetName,
  };
}
