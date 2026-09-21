import { hasOpenAI } from "./config";
import { PLAN_MODELS } from "./models";
import { entityMatchesQuery, rankKnownEntities, type KnownEntity } from "./search";
import type { Entity, Relationship } from "./types";

export type NeighborhoodFact = {
  id: string;
  name: string;
  type: string;
  facts: string[];
};

export type ResearchPlan = {
  searchQuery: string;
  allowNewEntities: boolean;
  gaps: string[];
};

const MAX_FOCUS = 3;
const MAX_FACTS = 8;
const QUERY_LIMIT = 400;

export function buildNeighborhood(
  question: string,
  entities: Entity[],
  relationships: Relationship[],
): NeighborhoodFact[] {
  const known: KnownEntity[] = entities.map((entity) => ({
    id: entity.id,
    name: entity.name,
    type: entity.type,
  }));
  const ranked = rankKnownEntities(question, known);
  const mentioned = ranked.filter((entity) => entityMatchesQuery(question, entity.name));
  const focus = (mentioned.length ? mentioned : ranked.slice(0, 2)).slice(0, MAX_FOCUS);
  const nameById = new Map(entities.map((entity) => [entity.id, entity.name]));

  return focus.map((entity) => {
    const facts = relationships
      .filter((rel) => rel.source === entity.id || rel.target === entity.id)
      .slice(0, MAX_FACTS)
      .map((rel) => {
        const outgoing = rel.source === entity.id;
        const peerId = outgoing ? rel.target : rel.source;
        const peer = nameById.get(peerId) ?? peerId;
        return outgoing ? `${rel.type} ${peer}` : `${peer} ${rel.type} this`;
      });
    return {
      id: entity.id,
      name: entity.name,
      type: entity.type,
      facts,
    };
  });
}

export function heuristicResearchPlan(
  question: string,
  neighborhood: NeighborhoodFact[],
  preferExistingLinks = false,
): ResearchPlan {
  void preferExistingLinks;
  const focus = neighborhood[0]?.name ?? "";
  const cleaned = question
    .replace(/\b(research|look up|find out|search for|tell me|give me|an idea of)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const searchQuery = (focus ? `"${focus}" ${cleaned}` : cleaned || question)
    .trim()
    .slice(0, QUERY_LIMIT);

  const allowNewEntities = !isConnectQuestion(question);

  const gaps: string[] = [];
  if (/personal|famil|born|educat|school|spouse/i.test(question)) {
    gaps.push("personal life", "education", "family");
  }
  if (/career|role|job|minister|background|histor/i.test(question)) {
    gaps.push("career history", "other roles");
  }
  if (/how |what (does|is|are)|work|operat/i.test(question)) {
    gaps.push(focus ? `what ${focus} is and how it works` : "what it is and how it works");
  }
  if (gaps.length === 0) {
    gaps.push(focus ? `missing facts about ${focus}` : "missing facts for this question");
  }

  return { searchQuery, allowNewEntities, gaps };
}

function isConnectQuestion(question: string): boolean {
  return /connect|between|link existing|who (links|connects)/i.test(question);
}

export async function planResearch(
  question: string,
  neighborhood: NeighborhoodFact[],
  preferExistingLinks = false,
): Promise<ResearchPlan> {
  const fallback = heuristicResearchPlan(question, neighborhood, preferExistingLinks);
  if (!hasOpenAI() || neighborhood.length === 0) return fallback;

  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const system = `Plan ONE web search to fill gaps in an existing knowledge graph.
Return JSON only:
{"searchQuery":"string","allowNewEntities":true,"gaps":["facet"]}
Rules:
- searchQuery is a single focused web query (not a paragraph). Put the main person/org in quotes.
- Aim at MISSING facets. Do not dump already-known related names into the query.
- allowNewEntities is true whenever the question needs anything new on the map (people, orgs, concepts, processes, services, products, places).
- allowNewEntities is false only when the question is solely about linking entities already in the neighborhood.
- New nodes must use a one-word noun type and attach to an existing entity.
- gaps: 1–4 short missing facets for the extractor.
- Do not answer the question.`;

  const user = JSON.stringify({
    question,
    known: neighborhood,
    preferExistingLinks,
  });

  for (const model of PLAN_MODELS) {
    try {
      const response = await client.responses.create({
        model,
        reasoning: { effort: "low" },
        text: { format: { type: "json_object" } },
        input: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });
      const parsed = parsePlan(response.output_text ?? "{}", fallback, question);
      if (parsed) return parsed;
    } catch {
      try {
        const completion = await client.chat.completions.create({
          model,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        });
        const parsed = parsePlan(
          completion.choices[0]?.message?.content ?? "{}",
          fallback,
          question,
        );
        if (parsed) return parsed;
      } catch {
        /* try next model */
      }
    }
  }

  return fallback;
}

function parsePlan(
  raw: string,
  fallback: ResearchPlan,
  question: string,
): ResearchPlan | null {
  try {
    const rec = JSON.parse(raw) as {
      searchQuery?: string;
      allowNewEntities?: boolean;
      gaps?: unknown;
    };
    const searchQuery = String(rec.searchQuery ?? "").trim().slice(0, QUERY_LIMIT);
    if (!searchQuery) return null;
    const gaps = Array.isArray(rec.gaps)
      ? rec.gaps.map((gap) => String(gap).trim()).filter(Boolean).slice(0, 4)
      : fallback.gaps;
    return {
      searchQuery,
      allowNewEntities: isConnectQuestion(question)
        ? rec.allowNewEntities === true
        : true,
      gaps: gaps.length ? gaps : fallback.gaps,
    };
  } catch {
    return null;
  }
}
