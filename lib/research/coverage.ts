import type { Entity, Relationship } from "../types";
import { facetById, relationshipMatchesFacet, type FacetId } from "./facets";
import type { ResearchSpec } from "./spec";

export type FacetCoverageStatus = "covered" | "partial" | "missing" | "not_applicable";

export type FacetCoverage = {
  facet: FacetId;
  status: FacetCoverageStatus;
  hits: number;
  gap: string;
};

export type SpecCoverage = {
  facets: FacetCoverage[];
  missing: FacetId[];
  priorityGap?: FacetId;
  legacyScore: number;
  answered: boolean;
};

function namesMatch(value: string, person: string): boolean {
  const hay = value.toLowerCase();
  const needle = person.trim().toLowerCase();
  if (!needle) return false;
  if (hay.includes(needle)) return true;
  const tokens = needle.split(/[^a-z0-9]+/).filter((token) => token.length >= 4);
  return tokens.length >= 2 && tokens.every((token) => hay.includes(token));
}

function relTouchesSubject(rel: Relationship, subject: string, entities: Entity[]): boolean {
  const names = new Map(entities.map((entity) => [entity.id, entity.name]));
  const source = names.get(rel.source) ?? rel.source;
  const target = names.get(rel.target) ?? rel.target;
  return namesMatch(source, subject) || namesMatch(target, subject) || namesMatch(rel.claim, subject);
}

function subjectRels(
  spec: ResearchSpec,
  entities: Entity[],
  relationships: Relationship[],
): Relationship[] {
  const names = spec.subjects.map((subject) => subject.name);
  if (names.length === 0) return relationships;
  return relationships.filter((rel) =>
    names.some((name) => relTouchesSubject(rel, name, entities)),
  );
}

export function coverFacets(input: {
  spec: ResearchSpec;
  entities: Entity[];
  relationships: Relationship[];
}): SpecCoverage {
  const subjects = input.spec.subjects.map((subject) => subject.name);
  const rels = subjectRels(input.spec, input.entities, input.relationships);
  const entityHit = subjects.some((name) =>
    input.entities.some((entity) => namesMatch(entity.name, name)),
  );
  const facets: FacetCoverage[] = input.spec.facets.map((facet) => {
    const def = facetById(facet);
    const applicableTypes = input.spec.subjects
      .map((subject) => subject.type)
      .filter((type): type is string => Boolean(type));
    if (
      applicableTypes.length > 0 &&
      def.entityTypes.length > 0 &&
      !applicableTypes.some((type) => def.entityTypes.includes(type))
    ) {
      return {
        facet,
        status: "not_applicable",
        hits: 0,
        gap: def.gap(subjects[0] || "the subject"),
      };
    }
    const hits = rels.filter((rel) => relationshipMatchesFacet(rel, facet)).length;
    const identityCovered =
      facet === "identity" && (entityHit || rels.length > 0);
    const count = identityCovered ? Math.max(hits, 1) : hits;
    let status: FacetCoverageStatus = "missing";
    if (count >= 2) status = "covered";
    else if (count === 1) status = "partial";
    return {
      facet,
      status,
      hits: count,
      gap: def.gap(subjects[0] || "the subject"),
    };
  });

  const missing = facets
    .filter((item) => item.status === "missing" || item.status === "partial")
    .map((item) => item.facet);
  const coveredCount = facets.filter((item) => item.status === "covered").length;
  const applicable = facets.filter((item) => item.status !== "not_applicable");
  const legacyScore =
    applicable.length === 0
      ? entityHit || rels.length > 0
        ? 8
        : 0
      : Math.min(10, Math.round((coveredCount / applicable.length) * 10));

  return {
    facets,
    missing,
    priorityGap: missing[0],
    legacyScore,
    answered: missing.length === 0 && applicable.length > 0,
  };
}
