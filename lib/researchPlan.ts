import { hasOpenAI } from "./config";
import { PLAN_MODELS } from "./models";
import { entityMatchesQuery, rankKnownEntities, strategicSearchQuery, type KnownEntity } from "./search";
import { formatEpisodeTime } from "./timeline";
import type { Entity, Relationship } from "./types";

export type NeighborhoodFact = {
  id: string;
  name: string;
  type: string;
  facts: string[];
};

export type ResearchPlan = {
  searchQuery: string;
  queries: string[];
  subjects: string[];
  allowNewEntities: boolean;
  gaps: string[];
};

const MAX_FOCUS = 3;
const MAX_FACTS = 8;
const QUERY_LIMIT = 120;
const MAX_QUERIES = 4;

const SKIP_FOCUS = new Set([
  "a",
  "an",
  "how",
  "i",
  "i'm",
  "im",
  "my",
  "our",
  "the",
  "their",
  "these",
  "this",
  "that",
  "those",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
]);

type FacetId = "jobs" | "hires" | "product" | "funding" | "timeline";

const FACETS: { id: FacetId; test: RegExp; gap: (subject: string) => string }[] = [
  {
    id: "timeline",
    test: /\b(timeline|history|career|lived|founded|acquired|biography|background|born)\b/i,
    gap: (subject) => `when ${subject} lived, founded companies, or was acquired`,
  },
  {
    id: "jobs",
    test: /\b(job postings?|jobs|hiring|careers?|openings?|recruit)/i,
    gap: (subject) => `open roles and job postings at ${subject}`,
  },
  {
    id: "hires",
    test: /\b(recent hires?|hired|joined|appointment|new (cmo|cto|ceo|head|vp))\b/i,
    gap: (subject) => `recent hires and leadership changes at ${subject}`,
  },
  {
    id: "product",
    test: /\b(building next|roadmap|what are they building|product|shipping|launching)\b/i,
    gap: (subject) => `what ${subject} is building next`,
  },
  {
    id: "funding",
    test: /\b(raised|funding|investors?|series [a-d]|valuation)\b/i,
    gap: (subject) => `funding and investors for ${subject}`,
  },
];

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
        const when = formatEpisodeTime(rel.time);
        const fact = outgoing ? `${rel.type} ${peer}` : `${peer} ${rel.type} this`;
        return when ? `${fact} (${when})` : fact;
      });
    return {
      id: entity.id,
      name: entity.name,
      type: entity.type,
      facts,
    };
  });
}

export function extractFocusSubjects(question: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();

  const add = (raw: string) => {
    const name = raw.replace(/\s+/g, " ").trim().replace(/[.,;:]+$/g, "");
    if (name.length < 2 || /[.?!]/.test(name)) return;
    const key = name.toLowerCase();
    if (seen.has(key) || SKIP_FOCUS.has(key)) return;
    if (key.split(/\s+/).some((word) => SKIP_FOCUS.has(word))) return;
    seen.add(key);
    found.push(name);
  };

  for (const match of question.matchAll(/"([^"]{2,80})"/g)) add(match[1]);

  const about = question.match(/\babout\s+([A-Z][^.?!\n]{1,80}?)(?=\s*[.?!]|$)/);
  if (about) {
    const phrase = about[1].match(/^((?:[A-Z][A-Za-z0-9&-]+\s*){1,5})/);
    if (phrase) add(phrase[1]);
  }

  for (const match of question.matchAll(
    /\b([A-Z][A-Za-z0-9&-]+(?:\s+[A-Z][A-Za-z0-9&-]+){0,4})\b/g,
  )) {
    const first = match[1].split(/\s+/)[0].toLowerCase();
    if (SKIP_FOCUS.has(first)) continue;
    add(match[1]);
  }

  const product = question.match(
    /\b(?:their|the|its)\s+([A-Za-z][A-Za-z0-9-]{1,40})\s+product\b/i,
  );
  if (product) add(product[1]);

  return found.slice(0, 5);
}

export function detectFacets(question: string): FacetId[] {
  return FACETS.filter((facet) => facet.test.test(question)).map((facet) => facet.id);
}

export function isComplexQuestion(question: string): boolean {
  const facets = detectFacets(question);
  if (facets.length >= 2) return true;
  if (question.trim().length > 140) return true;
  if ((question.match(/[.?!]/g) ?? []).length >= 2) return true;
  return false;
}

export function heuristicResearchPlan(
  question: string,
  neighborhood: NeighborhoodFact[],
  preferExistingLinks = false,
): ResearchPlan {
  void preferExistingLinks;
  const extracted = extractFocusSubjects(question);
  const focus = neighborhood[0]?.name ?? extracted[0] ?? "";
  const subjects = uniqueNames([
    focus,
    ...extracted,
    ...neighborhood.map((item) => item.name),
  ]).slice(0, 5);

  const queries = buildResearchQueries(question, subjects);
  const allowNewEntities = !isConnectQuestion(question);
  const gaps = gapsFromQuestion(question, focus || subjects[0] || "this subject");

  return {
    searchQuery: queries[0],
    queries,
    subjects,
    allowNewEntities,
    gaps,
  };
}

export function buildResearchQueries(question: string, subjects: string[]): string[] {
  const focus = subjects[0] ?? "";
  const extras = subjects.slice(1);
  if (!focus) return [strategicSearchQuery(question)];

  const quoted = `"${focus}"`;
  if (!isComplexQuestion(question)) {
    const compact = strategicSearchQuery(question);
    if (/\bbiograph/i.test(compact) || isHistoryQuestion(question)) {
      return [`${quoted} biography founded lived dates`.slice(0, QUERY_LIMIT)];
    }
    return [quoted.slice(0, QUERY_LIMIT)];
  }

  const facets = detectFacets(question);
  const queries =
    facets.includes("timeline") || isHistoryQuestion(question)
      ? [`${quoted} founded lived acquired dates`]
      : [quoted];
  if (facets.includes("product")) {
    const product = extras.find(
      (name) => !name.toLowerCase().includes(focus.toLowerCase()),
    );
    queries.push(
      product ? `${quoted} ${product} product` : `${quoted} product roadmap`,
    );
  }
  if (facets.includes("jobs")) {
    queries.push(`${quoted} jobs hiring careers`);
  }
  if (facets.includes("hires")) {
    queries.push(`${quoted} recent hires joined`);
  }
  if (facets.includes("funding")) {
    queries.push(`${quoted} funding investors`);
  }

  return uniqueNames(queries.map((query) => query.trim().slice(0, QUERY_LIMIT))).slice(
    0,
    MAX_QUERIES,
  );
}

function gapsFromQuestion(question: string, subject: string): string[] {
  const facets = detectFacets(question);
  const gaps = [
    `when ${subject} lived, founded companies, or was acquired`,
    ...FACETS.filter((facet) => facets.includes(facet.id)).map((facet) =>
      facet.gap(subject),
    ),
  ];
  if (/personal|famil|born|educat|school|spouse/i.test(question)) {
    gaps.push("personal life", "education", "family");
  }
  if (/career|role|minister|background|histor/i.test(question) && !facets.includes("hires")) {
    gaps.push("career history", "other roles");
  }
  if (/how |what (does|is|are)|work|operat/i.test(question) && gaps.length === 0) {
    gaps.push(`what ${subject} is and how it works`);
  }
  if (gaps.length === 0) {
    gaps.push(`missing facts about ${subject}`);
  }
  return uniqueNames(gaps).slice(0, 4);
}

function isHistoryQuestion(question: string): boolean {
  return /\b(timeline|history|career|lived|founded|acquired|biography|background|born)\b/i.test(
    question,
  );
}

function isConnectQuestion(question: string): boolean {
  return /connect|between|link existing|who (links|connects)/i.test(question);
}

function uniqueNames(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const name = value.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export async function planResearch(
  question: string,
  neighborhood: NeighborhoodFact[],
  preferExistingLinks = false,
): Promise<ResearchPlan> {
  const fallback = heuristicResearchPlan(question, neighborhood, preferExistingLinks);
  if (!hasOpenAI()) return fallback;

  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const extending = neighborhood.length > 0;
  const system = extending
    ? `Plan 1–3 web searches to fill gaps in an existing knowledge graph.
Return JSON only:
{"subjects":["Name"],"queries":["\\"Name\\" facet"],"allowNewEntities":true,"gaps":["facet"]}
Rules:
- Each query is a short web query (under 80 chars), not a paragraph. Put the main person/org in quotes.
- One facet per query. Aim at MISSING facets, including when they lived, founded, or were acquired. Do not dump already-known related names into the query.
- allowNewEntities is true whenever the question needs anything new on the map.
- allowNewEntities is false only when the question is solely about linking entities already in the neighborhood.
- gaps: 1–4 short missing facets for the extractor.
- Do not answer the question.`
    : `Decompose this research question into 1–4 focused web search queries.
Return JSON only:
{"subjects":["Triumph Arcade"],"queries":["\\"Triumph Arcade\\" Rips product"],"allowNewEntities":true,"gaps":["product roadmap"]}
Rules:
- subjects are the real-world people, companies, or products the question is about.
- Each query is under 80 characters. Put the main person/org in quotes.
- One facet per query (overview, chronology, product, hiring, jobs, funding). Include a chronology query when the subject is a person or company.
- Never copy the user's paragraph or conversational filler.
- For multi-part questions, emit a separate query per facet.
- Do not answer the question.`;

  const user = JSON.stringify({
    question,
    known: neighborhood,
    preferExistingLinks,
    heuristic: fallback,
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
      queries?: unknown;
      subjects?: unknown;
      allowNewEntities?: boolean;
      gaps?: unknown;
    };
    const listed = Array.isArray(rec.queries)
      ? rec.queries.map((query) => String(query).trim()).filter(Boolean)
      : [];
    const searchQuery = String(rec.searchQuery ?? listed[0] ?? "").trim();
    const queries = uniqueNames([searchQuery, ...listed])
      .map((query) => query.slice(0, QUERY_LIMIT))
      .filter(Boolean)
      .slice(0, MAX_QUERIES);
    if (queries.length === 0) return null;
    const subjects = Array.isArray(rec.subjects)
      ? uniqueNames(rec.subjects.map((item) => String(item).trim())).slice(0, 5)
      : fallback.subjects;
    const gaps = Array.isArray(rec.gaps)
      ? rec.gaps.map((gap) => String(gap).trim()).filter(Boolean).slice(0, 4)
      : fallback.gaps;
    return {
      searchQuery: queries[0],
      queries,
      subjects: subjects.length ? subjects : fallback.subjects,
      allowNewEntities: isConnectQuestion(question)
        ? rec.allowNewEntities === true
        : true,
      gaps: gaps.length ? gaps : fallback.gaps,
    };
  } catch {
    return null;
  }
}
