import type {
  Entity,
  EntityIdentifier,
  EntityKind,
  InterestCategory,
  Provenance,
  ReasoningChain,
  Relationship,
  SearchResult,
  Validation,
} from "./types";
import { normalizeEntityKind, normalizeEntityType } from "./types";

export const OVERLAP_DISCLAIMER =
  "Possible overlap, not a finding. This is not proof of misconduct.";

export const IDENTIFIER_SCHEMES = {
  parliamentMember: "parliament.member",
  bioguide: "bioguide",
  fecCandidate: "fec.candidate",
  oireachtasMember: "oireachtas.member",
  niAssemblyMember: "niassembly.person",
  europarlMep: "europarl.mep",
  lei: "lei",
  companiesHouse: "companies_house.number",
  cik: "cik",
  wikidata: "wikidata",
} as const;

export function identifierKey(item: EntityIdentifier): string {
  return `${item.scheme.trim().toLowerCase()}:${item.value.trim().toLowerCase()}`;
}

export function hasIdentifier(entity: Entity, scheme: string, value: string): boolean {
  const needle = identifierKey({ scheme, value });
  return (entity.identifiers ?? []).some((item) => identifierKey(item) === needle);
}

export function mergeIdentifiers(
  left: EntityIdentifier[] | undefined,
  right: EntityIdentifier[] | undefined,
): EntityIdentifier[] | undefined {
  const out: EntityIdentifier[] = [];
  const seen = new Set<string>();
  for (const item of [...(left ?? []), ...(right ?? [])]) {
    const scheme = item.scheme.trim();
    const value = String(item.value ?? "").trim();
    if (!scheme || !value) continue;
    const key = identifierKey({ scheme, value });
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ scheme, value });
  }
  return out.length ? out : undefined;
}

export function kindForType(type: string, kind?: EntityKind): EntityKind | undefined {
  return kind ?? normalizeEntityKind(type) ?? undefined;
}

export function makeEntity(input: {
  name: string;
  type?: string;
  kind?: EntityKind;
  identifiers?: EntityIdentifier[];
  jurisdiction?: string;
  id?: string;
}): Entity {
  const type = normalizeEntityType(input.type ?? input.kind ?? "concept");
  const kind = kindForType(type, input.kind);
  const id = slugify(input.id || input.name);
  return {
    id,
    name: input.name.trim(),
    type,
    ...(kind ? { kind } : {}),
    ...(input.identifiers?.length ? { identifiers: mergeIdentifiers(input.identifiers, []) } : {}),
    ...(input.jurisdiction ? { jurisdiction: input.jurisdiction.toUpperCase() } : {}),
  };
}

export function relationshipId(
  source: string,
  type: string,
  target: string,
  extra?: string,
): string {
  const base = `${source}__${type}__${target}`;
  return extra ? `${base}__${slugify(extra)}` : base;
}

export function recordedRelationship(input: {
  source: string;
  target: string;
  type: string;
  claim: string;
  sourceUrl: string;
  evidenceSnippet: string;
  extraId?: string;
  category?: InterestCategory | string;
  unresolved?: boolean;
  estimated?: boolean;
  time?: Relationship["time"];
  provenance: Provenance;
}): Relationship {
  return {
    id: relationshipId(input.source, input.type, input.target, input.extraId),
    source: input.source,
    target: input.target,
    type: input.type,
    claim: input.claim,
    status: "deployed",
    sourceUrl: input.sourceUrl,
    evidenceSnippet: input.evidenceSnippet,
    basis: "recorded",
    ...(input.category ? { category: input.category } : {}),
    ...(input.unresolved ? { unresolved: true } : {}),
    ...(input.estimated ? { estimated: true } : {}),
    ...(input.time ? { time: input.time } : {}),
    provenance: {
      ...input.provenance,
      fetchedAt: input.provenance.fetchedAt ?? new Date().toISOString(),
      recordUrl: input.provenance.recordUrl ?? input.sourceUrl,
    },
  };
}

export function inferredRelationship(input: {
  source: string;
  target: string;
  type?: string;
  claim: string;
  extraId?: string;
  reasoning: ReasoningChain;
}): Relationship {
  return {
    id: relationshipId(input.source, input.type ?? "possible_overlap", input.target, input.extraId),
    source: input.source,
    target: input.target,
    type: input.type ?? "possible_overlap",
    claim: input.claim,
    status: "unclear",
    basis: "inferred",
    reasoning: {
      ...input.reasoning,
      disclaimer: input.reasoning.disclaimer || OVERLAP_DISCLAIMER,
    },
  };
}

export function registerValidation(): Validation {
  return { decision: "SUPPORTED", confidence: 1, model: "register" };
}

export function ruleValidation(): Validation {
  return { decision: "UNCERTAIN", confidence: 0.4, model: "rule" };
}

export function sourceFromProvenance(
  title: string,
  url: string,
  snippet: string,
  host?: string,
  publishedAt?: string,
): SearchResult {
  return {
    title,
    url,
    snippet,
    source: host,
    publishedAt,
  };
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function mergeEntity(existing: Entity, incoming: Entity): Entity {
  return {
    ...existing,
    name: existing.name.length <= incoming.name.length ? existing.name : incoming.name,
    type: existing.kind || existing.type ? existing.type : incoming.type,
    kind: existing.kind ?? incoming.kind ?? kindForType(existing.type),
    identifiers: mergeIdentifiers(existing.identifiers, incoming.identifiers),
    jurisdiction: existing.jurisdiction ?? incoming.jurisdiction,
  };
}

export function matchingIdentifier(a: Entity, b: Entity): EntityIdentifier | undefined {
  const keys = new Set((a.identifiers ?? []).map(identifierKey));
  return (b.identifiers ?? []).find((item) => keys.has(identifierKey(item)));
}

export function jurisdictionsCompatible(a: Entity, b: Entity): boolean {
  if (!a.jurisdiction || !b.jurisdiction) return true;
  return a.jurisdiction.toUpperCase() === b.jurisdiction.toUpperCase();
}
