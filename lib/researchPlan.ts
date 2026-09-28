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

export type FacetId = "jobs" | "hires" | "product" | "funding" | "timeline" | "donors";

export type ResearchPlan = {
  searchQuery: string;
  queries: string[];
  subjects: string[];
  allowNewEntities: boolean;
  gaps: string[];
  facets: FacetId[];
  jurisdictions: string[];
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

const FACET_IDS = new Set<FacetId>(["jobs", "hires", "product", "funding", "timeline", "donors"]);

const FACETS: {
  id: FacetId;
  test: RegExp;
  gap: (subject: string) => string;
  keywords: string[];
}[] = [
  {
    id: "timeline",
    test: /\b(timeline|history|career|lived|founded|acquired|biography|background|born)\b/i,
    gap: (subject) => `when ${subject} lived, founded companies, or was acquired`,
    keywords: ["biography", "timeline", "founded", "born", "career"],
  },
  {
    id: "jobs",
    test: /\b(job postings?|jobs|hiring|careers?|openings?|recruit)/i,
    gap: (subject) => `open roles and job postings at ${subject}`,
    keywords: ["jobs", "hiring", "careers", "openings"],
  },
  {
    id: "hires",
    test: /\b(recent hires?|hired|joined|appointment|new (cmo|cto|ceo|head|vp))\b/i,
    gap: (subject) => `recent hires and leadership changes at ${subject}`,
    keywords: ["hired", "joined", "appointment", "leadership"],
  },
  {
    id: "product",
    test: /\b(building next|roadmap|what are they building|product|shipping|launching)\b/i,
    gap: (subject) => `what ${subject} is building next`,
    keywords: ["product", "roadmap", "launch"],
  },
  {
    id: "funding",
    test: /\b(raised|funding|investors?|series [a-d]|valuation)\b/i,
    gap: (subject) => `funding and investors for ${subject}`,
    keywords: ["funding", "investors", "valuation", "raised"],
  },
  {
    id: "donors",
    test: /\b(donors?|donations?|donated|fundraising|who funds|campaign finance|register of interests)\b/i,
    gap: (subject) => `donors, donations, gifts, and fundraising for ${subject}`,
    keywords: [
      "donor",
      "donors",
      "donation",
      "donations",
      "donated",
      "fundraising",
      "register of interests",
      "electoral commission",
    ],
  },
];

const DONOR_REL_TYPES = new Set(["donated_to", "funds", "funded_by"]);
const DONOR_CLAIM = /\b(donat|donor|fundraising|gift|hospitality|register of interests)\b/i;

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

  const donorName = question.match(
    /(?:^|\s)((?:[A-Za-z][A-Za-z'’.-]+\s+){1,3}[A-Za-z][A-Za-z'’.-]+?)(?:['’]s|s)\s+(?:political\s+)?donors?\b/i,
  );
  if (donorName) {
    const tokens = donorName[1]
      .replace(/s$/i, "")
      .trim()
      .split(/\s+/)
      .filter((token) => !SKIP_FOCUS.has(token.toLowerCase()) && token.toLowerCase() !== "is");
    if (tokens.length >= 2) add(titleCaseName(tokens.join(" ")));
  }

  return found.slice(0, 5);
}

export function detectFacets(question: string): FacetId[] {
  return FACETS.filter((facet) => facet.test.test(question)).map((facet) => facet.id);
}

export function isComplexQuestion(question: string): boolean {
  const facets = detectFacets(question);
  if (facets.includes("donors")) return true;
  if (facets.length >= 2) return true;
  if (question.trim().length > 140) return true;
  if ((question.match(/[.?!]/g) ?? []).length >= 2) return true;
  return false;
}

export function facetKeywords(facets: FacetId[]): string[] {
  return uniqueNames(
    FACETS.filter((facet) => facets.includes(facet.id)).flatMap((facet) => facet.keywords),
  );
}

export function detectJurisdictions(question: string, extra: string[] = []): string[] {
  const hay = [question, ...extra].join(" ");
  const hits: string[] = [];
  if (
    /\b(northern ireland|belfast|stormont|sinn f[eé]in|mla\b|ni assembly|mid ulster|dungannon|clonoe)\b/i.test(
      hay,
    )
  ) {
    hits.push("NI");
  }
  if (/\b(westminster|house of commons|uk parliament|electoral commission|united kingdom)\b/i.test(hay)) {
    hits.push("GB");
  }
  if (/\b(congress|fec\b|opensecrets|united states|u\.s\. senate|house of representatives)\b/i.test(hay)) {
    hits.push("US");
  }
  if (/\b(oireachtas|d[aá]il|dublin|republic of ireland)\b/i.test(hay)) hits.push("IE");
  if (/\b(european parliament|mep\b|brussels|eu transparency)\b/i.test(hay)) hits.push("EU");
  return uniqueNames(hits);
}

export function jurisdictionsFromEntities(entities: Entity[]): string[] {
  const hits: string[] = [];
  for (const entity of entities) {
    const code = (entity.jurisdiction ?? "").toUpperCase();
    if (code === "US" || code === "GB" || code === "IE" || code === "EU" || code === "NI") {
      hits.push(code);
    }
    hits.push(...detectJurisdictions(entity.name));
  }
  return uniqueNames(hits);
}

export function relationshipsSatisfyFacets(
  relationships: Array<{ type: string; claim: string; category?: string }>,
  facets: FacetId[],
): boolean {
  if (facets.length === 0) return true;
  return facets.every((facet) => relationships.some((rel) => relationshipMatchesFacet(rel, facet)));
}

export function facetRetryQueries(plan: ResearchPlan): string[] {
  const focus = plan.subjects[0];
  if (!focus) return plan.queries;
  const quoted = `"${focus}"`;
  if (!plan.facets.includes("donors")) return plan.queries;
  const party = plan.subjects.find((name) =>
    /\b(sinn|party|f[eé]in|fein|labour|conservative|dup|alliance|uup|sdlp)\b/i.test(name),
  );
  return uniqueNames(
    [
      `${quoted} "register of interests" donations`,
      `${quoted} "Electoral Commission" donations`,
      `${quoted} "Northern Ireland Assembly" donations gifts`,
      party
        ? `"${party}" donations Electoral Commission`
        : `${quoted} party donations Electoral Commission`,
    ].map((query) => query.slice(0, QUERY_LIMIT)),
  );
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
  const facets = detectFacets(question);
  const gaps = gapsFromQuestion(question, focus || subjects[0] || "this subject");
  const jurisdictions = detectJurisdictions(question, [
    ...subjects,
    ...neighborhood.map((item) => item.name),
  ]);

  return {
    searchQuery: queries[0] || strategicSearchQuery(question),
    queries: queries.length ? queries : [strategicSearchQuery(question)],
    subjects,
    allowNewEntities,
    gaps,
    facets,
    jurisdictions,
  };
}

export function buildResearchQueries(question: string, subjects: string[]): string[] {
  const focus = subjects[0] ?? "";
  const extras = subjects.slice(1);
  if (!focus) return [strategicSearchQuery(question)];

  const quoted = `"${focus}"`;
  const facets = detectFacets(question);
  if (facets.includes("donors")) {
    return uniqueNames(
      [
        `${quoted} political donors`,
        `${quoted} campaign donations`,
        `${quoted} register of interests donations`,
        `${quoted} Electoral Commission donations`,
      ].map((query) => query.slice(0, QUERY_LIMIT)),
    ).slice(0, MAX_QUERIES);
  }
  if (!isComplexQuestion(question)) {
    const compact = strategicSearchQuery(question);
    if (/\bbiograph/i.test(compact) || isHistoryQuestion(question)) {
      return [`${quoted} biography founded lived dates`.slice(0, QUERY_LIMIT)];
    }
    return [quoted.slice(0, QUERY_LIMIT)];
  }

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
  if (facets.includes("donors")) {
    queries.push(`${quoted} political donors`);
  }

  return uniqueNames(queries.map((query) => query.trim().slice(0, QUERY_LIMIT))).slice(
    0,
    MAX_QUERIES,
  );
}

function gapsFromQuestion(question: string, subject: string): string[] {
  const facets = detectFacets(question);
  const gaps = FACETS.filter((facet) => facets.includes(facet.id)).map((facet) =>
    facet.gap(subject),
  );
  if (facets.includes("timeline") || (isHistoryQuestion(question) && !facets.includes("donors"))) {
    if (!gaps.some((gap) => /lived|founded/.test(gap))) {
      gaps.unshift(`when ${subject} lived, founded companies, or was acquired`);
    }
  }
  if (/personal|famil|born|educat|school|spouse/i.test(question) && !facets.includes("donors")) {
    gaps.push("personal life", "education", "family");
  }
  if (
    /career|role|minister|background|histor/i.test(question) &&
    !facets.includes("hires") &&
    !facets.includes("donors")
  ) {
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

function uniqueFacets(values: FacetId[]): FacetId[] {
  const seen = new Set<FacetId>();
  const out: FacetId[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function relationshipMatchesFacet(
  rel: { type: string; claim: string; category?: string },
  facet: FacetId,
): boolean {
  if (facet === "donors") {
    if (DONOR_REL_TYPES.has(rel.type)) return true;
    if (rel.type === "declared_interest") {
      const hay = `${rel.category ?? ""} ${rel.claim}`;
      return DONOR_CLAIM.test(hay);
    }
    return DONOR_CLAIM.test(rel.claim);
  }
  if (facet === "funding") {
    return (
      ["funds", "funded_by", "invested_in", "investor_in"].includes(rel.type) ||
      /\b(investor|funding|raised)\b/i.test(rel.claim)
    );
  }
  const keywords = FACETS.find((item) => item.id === facet)?.keywords ?? [];
  const hay = `${rel.type} ${rel.claim}`.toLowerCase();
  return keywords.some((keyword) => hay.includes(keyword.toLowerCase()));
}

function titleCaseName(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
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
{"subjects":["Name"],"queries":["\\"Name\\" facet"],"allowNewEntities":true,"gaps":["facet"],"facets":["donors"],"jurisdictions":["NI"]}
Rules:
- Each query is a short web query (under 80 chars), not a paragraph. Put the main person/org in quotes.
- One facet per query. Aim at MISSING facets. If the question is about donors or donations, search registers and party donations — do not emit a biography query.
- allowNewEntities is true whenever the question needs anything new on the map.
- allowNewEntities is false only when the question is solely about linking entities already in the neighborhood.
- gaps: 1–4 short missing facets for the extractor.
- Do not answer the question.`
    : `Decompose this research question into 1–4 focused web search queries.
Return JSON only:
{"subjects":["Triumph Arcade"],"queries":["\\"Triumph Arcade\\" Rips product"],"allowNewEntities":true,"gaps":["product roadmap"],"facets":["product"],"jurisdictions":[]}
Rules:
- subjects are the real-world people, companies, or products the question is about.
- Each query is under 80 characters. Put the main person/org in quotes.
- One facet per query (overview, chronology, product, hiring, jobs, funding, donors). Include a chronology query when the subject is a person or company unless the question is about donors, donations, or fundraising.
- If the question is about donors or donations, emit donor/register queries only.
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
      facets?: unknown;
      jurisdictions?: unknown;
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
    const parsedFacets = Array.isArray(rec.facets)
      ? rec.facets
          .map((item) => String(item).trim().toLowerCase())
          .filter((item): item is FacetId => FACET_IDS.has(item as FacetId))
      : [];
    const parsedJurisdictions = Array.isArray(rec.jurisdictions)
      ? rec.jurisdictions.map((item) => String(item).trim().toUpperCase()).filter(Boolean)
      : [];
    const resolvedSubjects = subjects.length ? subjects : fallback.subjects;
    return {
      searchQuery: queries[0],
      queries,
      subjects: resolvedSubjects,
      allowNewEntities: isConnectQuestion(question)
        ? rec.allowNewEntities === true
        : true,
      gaps: gaps.length ? gaps : fallback.gaps,
      facets: uniqueFacets([...detectFacets(question), ...parsedFacets, ...fallback.facets]),
      jurisdictions: uniqueNames([
        ...detectJurisdictions(question, resolvedSubjects),
        ...parsedJurisdictions,
        ...fallback.jurisdictions,
      ]),
    };
  } catch {
    return null;
  }
}
