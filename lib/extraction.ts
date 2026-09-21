import { hasOpenAI } from "./config";
import { DEMO_ENTITIES, DEMO_RELATIONSHIPS } from "./demo";
import { EXTRACT_MODELS } from "./models";
import type { Document } from "./search";
import type { Entity, Relationship } from "./types";
import { normalizeEntityType } from "./types";

export type Extraction = {
  entities: Entity[];
  relationships: Relationship[];
};

const EXTRACTION_PROMPT = `You extract a knowledge graph from research documents.

Return JSON:
{
  "entities": [{ "id": "slug", "name": "Display Name", "type": "organization" }],
  "relationships": [{
    "source": "slug",
    "target": "slug",
    "type": "partners_with",
    "claim": "one sentence claim",
    "sourceUrl": "https://...",
    "evidenceSnippet": "short supporting passage from the documents"
  }]
}

Entity types: exactly one lowercase noun. Prefer: person, organization, company, technology, mission, location, product, spacecraft, concept, service, event, process. If none fit, still use a single noun (law, fund, school, cycle). Never use phrases or blanks.
Relationship types: concise verbs such as partners_with, develops, owns, operates, funds, acquired, supplies, works_with, launches, uses, member_of, represents, educated_at, minister_of, born_in, provides, explains.

Rules:
- ids are lowercase kebab-case slugs
- relationship source/target must match an entity id from this response or from existingEntities
- only extract claims grounded in the documents
- prefer 8–20 high-value relationships, not an exhaustive dump
- evidenceSnippet must be a short quote or close paraphrase of the source
- if existingEntities is present, reuse those canonical ids; do not invent a second id for a known entity
- extract NEW entities and NEW relationships, including edges that attach to existing entities
- do not re-emit known source/type/target triples from existingRelationships
- existing entities do not need to be re-listed`;

const LINK_EXISTING_PROMPT = `
This is a follow-up question against an existing graph.
- prefer NEW relationships whose source and target are already in existingEntities
- only add a new entity if it is required as a bridge between known entities
- reuse canonical ids from existingEntities; do not invent a second id for a known entity
- ignore documents that do not connect existing entities to each other`;

const FILL_GAPS_PROMPT = `
This is a follow-up that needs missing facts about the focus entities.
- reuse canonical ids from existingEntities; do not invent a second id for a known entity
- add any entity worth putting on the map, whatever kind it is, as long as type is one lowercase noun
- attach every new entity to the most related existing entity (no islands)
- include concepts, processes, services, products, places, people — if it answers the question, add it and link it
- do not ignore explainer or profile pages just because they are not links between two already-known entities
- still skip duplicate source/type/target triples from existingRelationships`;

export type ExtractionContext = {
  existingEntities?: Entity[];
  existingRelationships?: { source: string; type: string; target: string }[];
  preferExistingLinks?: boolean;
  allowNewEntities?: boolean;
  gaps?: string[];
};

export async function extractKnowledge(
  query: string,
  documents: Document[],
  context: ExtractionContext = {},
): Promise<Extraction> {
  const existingEntities = context.existingEntities ?? [];
  if (!hasOpenAI()) {
    return {
      entities: DEMO_ENTITIES,
      relationships: DEMO_RELATIONSHIPS,
    };
  }

  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const preferExistingLinks = Boolean(context.preferExistingLinks);
  const allowNewEntities = context.allowNewEntities ?? !preferExistingLinks;
  const followUp = preferExistingLinks || context.allowNewEntities != null;
  const system = followUp
    ? `${EXTRACTION_PROMPT}\n${allowNewEntities ? FILL_GAPS_PROMPT : LINK_EXISTING_PROMPT}`
    : EXTRACTION_PROMPT;
  const payload = {
    query,
    gaps: context.gaps ?? [],
    documents: documents.map((doc) => ({
      title: doc.title,
      url: doc.url,
      source: doc.source,
      text: (doc.text || doc.snippet).slice(0, 1800),
    })),
    existingEntities: existingEntities.map((entity) => ({
      id: entity.id,
      name: entity.name,
      type: entity.type,
    })),
    existingRelationships: (context.existingRelationships ?? []).map((rel) => ({
      source: rel.source,
      type: rel.type,
      target: rel.target,
    })),
    allowNewEntities,
  };

  let lastError: unknown;
  for (const model of EXTRACT_MODELS) {
    try {
      const response = await client.responses.create({
        model,
        reasoning: { effort: "low" },
        text: { format: { type: "json_object" } },
        input: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(payload) },
        ],
      });
      const raw = response.output_text ?? "{}";
      return normalizeExtraction(JSON.parse(raw), existingEntities);
    } catch (error) {
      lastError = error;
      try {
        const completion = await client.chat.completions.create({
          model,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: JSON.stringify(payload) },
          ],
        });
        const raw = completion.choices[0]?.message?.content ?? "{}";
        return normalizeExtraction(JSON.parse(raw), existingEntities);
      } catch (chatError) {
        lastError = chatError;
      }
    }
  }

  throw new Error(
    `Extraction failed${lastError instanceof Error ? `: ${lastError.message}` : ""}`,
  );
}

function normalizeExtraction(raw: unknown, existing: Entity[] = []): Extraction {
  const rec = (raw ?? {}) as Record<string, unknown>;
  const entities: Entity[] = [];
  const seen = new Set<string>();

  if (Array.isArray(rec.entities)) {
    for (const item of rec.entities) {
      if (!item || typeof item !== "object") continue;
      const e = item as Record<string, unknown>;
      const name = String(e.name ?? "").trim();
      if (!name) continue;
      const id = slugify(String(e.id || name));
      if (seen.has(id)) continue;
      seen.add(id);
      entities.push({
        id,
        name,
        type: normalizeEntityType(e.type),
      });
    }
  }

  const entityIds = new Set([
    ...existing.map((entity) => entity.id),
    ...entities.map((entity) => entity.id),
  ]);
  const relationships: Relationship[] = [];
  const relSeen = new Set<string>();

  if (Array.isArray(rec.relationships)) {
    for (const item of rec.relationships) {
      if (!item || typeof item !== "object") continue;
      const r = item as Record<string, unknown>;
      const source = slugify(String(r.source ?? ""));
      const target = slugify(String(r.target ?? ""));
      const type = slugify(String(r.type ?? "related_to")).replace(/-/g, "_");
      if (!source || !target || source === target) continue;
      if (!entityIds.has(source) || !entityIds.has(target)) continue;
      const id = `${source}__${type}__${target}`;
      if (relSeen.has(id)) continue;
      relSeen.add(id);
      relationships.push({
        id,
        source,
        target,
        type,
        claim: String(r.claim ?? `${source} ${type} ${target}`),
        sourceUrl: typeof r.sourceUrl === "string" ? r.sourceUrl : undefined,
        evidenceSnippet:
          typeof r.evidenceSnippet === "string" ? r.evidenceSnippet : undefined,
      });
    }
  }

  return { entities, relationships };
}

export function attachNewEntities(
  extraction: Extraction,
  existing: Entity[],
  documents: Document[] = [],
): Extraction {
  if (existing.length === 0) return extraction;

  const existingIds = new Set(existing.map((entity) => entity.id));
  const adjacency = new Map<string, string[]>();
  const addEdge = (a: string, b: string) => {
    const left = adjacency.get(a) ?? [];
    const right = adjacency.get(b) ?? [];
    left.push(b);
    right.push(a);
    adjacency.set(a, left);
    adjacency.set(b, right);
  };
  for (const rel of extraction.relationships) addEdge(rel.source, rel.target);

  const reachable = new Set<string>();
  const walk = (start: string) => {
    const stack = [start];
    while (stack.length) {
      const id = stack.pop()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      for (const next of adjacency.get(id) ?? []) stack.push(next);
    }
  };
  for (const id of existingIds) walk(id);

  const relationships = [...extraction.relationships];
  const relSeen = new Set(relationships.map((rel) => rel.id));

  for (const entity of extraction.entities) {
    if (existingIds.has(entity.id) || reachable.has(entity.id)) continue;
    const anchor = pickAnchor(entity, existing, documents);
    const type = "related_to";
    const id = `${entity.id}__${type}__${anchor.id}`;
    if (relSeen.has(id)) {
      walk(entity.id);
      continue;
    }
    relSeen.add(id);
    const doc = documents.find((item) => mentionsName(item, entity.name));
    relationships.push({
      id,
      source: entity.id,
      target: anchor.id,
      type,
      claim: `${entity.name} is related to ${anchor.name}`,
      sourceUrl: doc?.url,
      evidenceSnippet: doc
        ? (doc.snippet || (doc.text ?? "").slice(0, 240) || undefined)
        : undefined,
    });
    addEdge(entity.id, anchor.id);
    walk(entity.id);
  }

  return { entities: extraction.entities, relationships };
}

function pickAnchor(
  entity: Entity,
  existing: Entity[],
  documents: Document[],
): Entity {
  const tokens = nameTokens(entity.name);
  let best = existing[0];
  let bestScore = -1;
  for (const candidate of existing) {
    let score = 0;
    for (const token of nameTokens(candidate.name)) {
      if (tokens.has(token)) score += 2;
    }
    const coMentioned = documents.some(
      (doc) => mentionsName(doc, entity.name) && mentionsName(doc, candidate.name),
    );
    if (coMentioned) score += 3;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

function nameTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 4),
  );
}

function mentionsName(doc: Document, name: string): boolean {
  const hay = `${doc.title} ${doc.snippet} ${doc.text ?? ""}`.toLowerCase();
  return hay.includes(name.trim().toLowerCase());
}

export function groundRelationships(
  relationships: Relationship[],
  documents: Document[],
): Relationship[] {
  const byUrl = new Map(documents.map((doc) => [doc.url, doc]));
  return relationships.filter((rel) => {
    if (!rel.sourceUrl) return false;
    const doc = byUrl.get(rel.sourceUrl);
    if (!doc) return false;
    const snippet = rel.evidenceSnippet ?? "";
    const haystack = `${doc.text ?? ""} ${doc.snippet ?? ""}`;
    return isGroundedSnippet(snippet, haystack);
  });
}

function isGroundedSnippet(snippet: string, haystack: string): boolean {
  const needle = normalizeText(snippet);
  const hay = normalizeText(haystack);
  if (!needle || !hay) return false;
  if (hay.includes(needle)) return true;
  const tokens = needle.split(" ").filter((token) => token.length > 3);
  if (tokens.length === 0) return false;
  if (tokens.length < 4) return tokens.every((token) => hay.includes(token));
  const hits = tokens.filter((token) => hay.includes(token)).length;
  return hits / tokens.length >= 0.6;
}

const EVIDENCE_CAP = 900;

export function evidenceExcerpt(
  rel: Relationship,
  documents: Document[],
): string {
  const doc = documents.find((item) => item.url === rel.sourceUrl);
  const text = (doc?.text || doc?.snippet || "").trim();
  const snippet = (rel.evidenceSnippet ?? "").trim();

  if (text && snippet) {
    const index = findSnippetIndex(text, snippet);
    if (index >= 0) {
      const extra = Math.max(0, EVIDENCE_CAP - snippet.length);
      const start = Math.max(0, index - Math.floor(extra / 2));
      return text.slice(start, start + EVIDENCE_CAP).trim();
    }
  }
  if (text) return text.slice(0, EVIDENCE_CAP).trim();
  return snippet || rel.claim;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function findSnippetIndex(haystack: string, needle: string): number {
  const direct = haystack.toLowerCase().indexOf(needle.toLowerCase());
  if (direct >= 0) return direct;
  const compactHay = normalizeText(haystack);
  const compactNeedle = normalizeText(needle);
  if (!compactNeedle) return -1;
  const compactIndex = compactHay.indexOf(compactNeedle);
  if (compactIndex < 0) return -1;
  const ratio = compactIndex / Math.max(1, compactHay.length);
  return Math.min(haystack.length - 1, Math.floor(ratio * haystack.length));
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
