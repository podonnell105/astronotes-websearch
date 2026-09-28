import type { Entity, Relationship } from "../types";
import { relationshipMatchesFacet, type FacetId } from "./facets";
import type { ResearchSpec } from "./spec";

const EXPAND_TYPES = new Set([
  "officer_of",
  "director_of",
  "psc_of",
  "founded",
  "cofounded",
  "works_at",
  "member_of",
  "invested_in",
  "funded_by",
  "parent_of",
  "owns",
]);

export function planIterationQueries(input: {
  spec: ResearchSpec;
  entities: Entity[];
  relationships: Relationship[];
  missing: FacetId[];
  iteration: number;
}): string[] {
  const budget = input.spec.budgets.maxQueries;
  const names = input.spec.subjects.map((subject) => subject.name).filter(Boolean);
  const expanded = expandSubjects(input);
  const neighborNames = expanded.filter(
    (name) => !names.some((subject) => subject.toLowerCase() === name.toLowerCase()),
  );
  const subjects = input.iteration >= 2 ? [...neighborNames, ...names] : expanded;
  const queries: string[] = [];
  const seen = new Set<string>();
  const add = (query: string) => {
    const trimmed = query.trim().slice(0, 120);
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    queries.push(trimmed);
  };

  const facets = input.missing.length ? input.missing : input.spec.facets;
  for (const subject of subjects) {
    const quoted = `"${subject}"`;
    for (const facet of facets) {
      const hint = hintFor(facet);
      add(`${quoted} ${hint}`);
      if (queries.length >= budget) return queries;
    }
  }
  if (queries.length === 0 && subjects[0]) add(`"${subjects[0]}"`);
  return queries.slice(0, budget);
}

export function expandSubjects(input: {
  spec: ResearchSpec;
  entities: Entity[];
  relationships: Relationship[];
  missing: FacetId[];
  iteration: number;
}): string[] {
  const names = input.spec.subjects.map((subject) => subject.name).filter(Boolean);
  if (input.iteration < 2 || input.spec.budgets.maxDepth < 2) return names.slice(0, 4);

  const nameById = new Map(input.entities.map((entity) => [entity.id, entity]));
  const extra: string[] = [];
  for (const rel of input.relationships) {
    if (!EXPAND_TYPES.has(rel.type)) continue;
    const source = nameById.get(rel.source);
    const target = nameById.get(rel.target);
    if (!source || !target) continue;
    const sourceIsSubject = names.some((name) => namesMatch(source.name, name));
    if (sourceIsSubject && (target.type === "company" || target.type === "organization")) {
      extra.push(target.name);
    }
  }
  return unique([
    ...names,
    ...extra,
  ]).slice(0, 6);
}

function hintFor(facet: FacetId): string {
  if (facet === "donations") return "donations Electoral Commission";
  if (facet === "directorships") return "director";
  if (facet === "employment") return "joined";
  if (facet === "hiring") return "jobs hiring";
  if (facet === "products") return "product";
  if (facet === "funding") return "funding investors";
  if (facet === "recent_activity") return "recent";
  if (facet === "political_activity") return "parliament";
  if (facet === "ownership") return "owner";
  if (facet === "companies") return "company";
  if (facet === "timeline") return "timeline history";
  if (facet === "identity") return "official";
  return facet.replace(/_/g, " ");
}

function namesMatch(value: string, person: string): boolean {
  return value.trim().toLowerCase() === person.trim().toLowerCase();
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export function neighborNeedsCompanyResearch(
  relationships: Relationship[],
  subject: string,
): boolean {
  return relationships.some(
    (rel) =>
      EXPAND_TYPES.has(rel.type) &&
      (rel.claim.toLowerCase().includes(subject.toLowerCase()) ||
        relationshipMatchesFacet(rel, "directorships") ||
        relationshipMatchesFacet(rel, "companies")),
  );
}
