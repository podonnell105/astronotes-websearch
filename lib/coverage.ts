import type { Entity, Relationship } from "./types";
import {
  facetKeywords,
  relationshipsSatisfyFacets,
  type ResearchPlan,
} from "./researchPlan";

export const MAX_ANSWER_TRIES = 3;
export const MIN_ANSWER_SCORE = 8;
export const PAGES_PER_TRY = 3;

export type CoverageReport = {
  score: number;
  answered: boolean;
  person: string;
  missing: string;
};

export function answerCoverage(input: {
  query: string;
  plan: ResearchPlan;
  entities: Entity[];
  relationships: Relationship[];
}): CoverageReport {
  const person = input.plan.subjects[0] || "the subject";
  const rels = input.relationships;
  if (rels.length === 0 && input.entities.length === 0) {
    return { score: 0, answered: false, person, missing: `no facts about ${person} yet` };
  }

  let score = 0;
  const subjectHit = input.entities.some((entity) => namesMatch(entity.name, person));
  if (subjectHit || rels.length > 0) score += 2;

  if (input.plan.facets.length > 0) {
    const satisfied = relationshipsSatisfyFacets(rels, input.plan.facets);
    if (!satisfied) {
      const missing = input.plan.gaps[0] || `${input.plan.facets.join(", ")} for ${person}`;
      return {
        score: Math.min(6, score),
        answered: false,
        person,
        missing,
      };
    }
    score += 5;
    if (rels.some((rel) => specificFacetClaim(rel, input.plan))) score += 2;
    if (rels.some((rel) => Boolean(rel.time?.start) || /£|\$|\beur\b|\b\d{4}\b/i.test(rel.claim))) {
      score += 1;
    }
  } else {
    const involving = rels.filter((rel) => claimTouchesPerson(rel, person, input.entities));
    if (involving.length >= 2) score += 4;
    else if (involving.length === 1) score += 2;
    if (involving.length >= 4) score += 2;
    const keywords = questionKeywords(input.query, person);
    if (keywords.length && involving.some((rel) => keywords.some((word) => rel.claim.toLowerCase().includes(word)))) {
      score += 2;
    }
  }

  score = Math.min(10, score);
  return {
    score,
    answered: score >= MIN_ANSWER_SCORE,
    person,
    missing: score >= MIN_ANSWER_SCORE ? "" : input.plan.gaps[0] || `enough facts about ${person}`,
  };
}

function specificFacetClaim(rel: Relationship, plan: ResearchPlan): boolean {
  const keywords = facetKeywords(plan.facets);
  const hay = `${rel.type} ${rel.claim} ${rel.category ?? ""}`.toLowerCase();
  if (keywords.some((word) => hay.includes(word.toLowerCase()))) return true;
  return rel.type === "donated_to" || rel.type === "declared_interest";
}

function claimTouchesPerson(rel: Relationship, person: string, entities: Entity[]): boolean {
  const names = new Map(entities.map((entity) => [entity.id, entity.name]));
  const source = names.get(rel.source) ?? rel.source;
  const target = names.get(rel.target) ?? rel.target;
  return namesMatch(source, person) || namesMatch(target, person) || namesMatch(rel.claim, person);
}

function namesMatch(value: string, person: string): boolean {
  const hay = value.toLowerCase();
  const needle = person.trim().toLowerCase();
  if (!needle) return false;
  if (hay.includes(needle)) return true;
  const tokens = needle.split(/[^a-z0-9]+/).filter((token) => token.length >= 4);
  return tokens.length >= 2 && tokens.every((token) => hay.includes(token));
}

function questionKeywords(query: string, person: string): string[] {
  const skip = new Set(["who", "what", "where", "when", "why", "how", "is", "are", "the", "for", "and"]);
  const personTokens = new Set(person.toLowerCase().split(/[^a-z0-9]+/));
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4 && !skip.has(word) && !personTokens.has(word))
    .slice(0, 6);
}
