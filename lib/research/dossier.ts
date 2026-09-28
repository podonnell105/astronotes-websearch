import type { Entity, Relationship } from "../types";
import { relationshipMatchesFacet, type FacetId } from "./facets";

export type DossierSectionId =
  | "identity"
  | "timeline"
  | "people"
  | "organisations"
  | "roles"
  | "ownership"
  | "products"
  | "technology"
  | "funding"
  | "customers"
  | "competitors"
  | "relationships"
  | "recent_activity"
  | "signals"
  | "evidence";

export type DossierItem = {
  relationshipId: string;
  claim: string;
  knowledge?: string;
  source?: string;
  target?: string;
  type: string;
};

export type DossierSection = {
  id: DossierSectionId;
  title: string;
  items: DossierItem[];
};

const SECTION_FACETS: Array<{ id: DossierSectionId; title: string; facets: FacetId[] }> = [
  { id: "identity", title: "Identity", facets: ["identity", "background"] },
  { id: "timeline", title: "Timeline", facets: ["timeline"] },
  { id: "people", title: "People", facets: ["roles", "employment"] },
  { id: "organisations", title: "Organisations", facets: ["companies", "partnerships"] },
  { id: "roles", title: "Roles", facets: ["roles", "directorships"] },
  { id: "ownership", title: "Ownership", facets: ["ownership", "directorships"] },
  { id: "products", title: "Products", facets: ["products"] },
  { id: "technology", title: "Technology", facets: ["technology", "patents"] },
  { id: "funding", title: "Funding", facets: ["funding", "donations"] },
  { id: "customers", title: "Customers", facets: ["customers", "contracts"] },
  { id: "competitors", title: "Competitors", facets: ["competitors"] },
  { id: "relationships", title: "Relationships", facets: ["relationships", "lobbying", "political_activity"] },
  { id: "recent_activity", title: "Recent activity", facets: ["recent_activity", "media", "events"] },
  { id: "signals", title: "Signals", facets: ["legal", "regulatory"] },
];

export function buildDossier(input: {
  entities: Entity[];
  relationships: Relationship[];
}): DossierSection[] {
  const names = new Map(input.entities.map((entity) => [entity.id, entity.name]));
  const used = new Set<string>();
  const sections: DossierSection[] = [];

  for (const section of SECTION_FACETS) {
    const items: DossierItem[] = [];
    for (const rel of input.relationships) {
      if (!section.facets.some((facet) => relationshipMatchesFacet(rel, facet))) continue;
      used.add(rel.id);
      items.push(toItem(rel, names));
    }
    if (items.length === 0) continue;
    sections.push({ id: section.id, title: section.title, items });
  }

  const leftover = input.relationships.filter((rel) => !used.has(rel.id));
  if (leftover.length) {
    sections.push({
      id: "relationships",
      title: "Relationships",
      items: leftover.map((rel) => toItem(rel, names)),
    });
  }

  const evidenceItems = input.relationships
    .filter((rel) => rel.sourceUrl || (rel.evidence?.length ?? 0) > 0)
    .map((rel) => toItem(rel, names));
  if (evidenceItems.length) {
    sections.push({ id: "evidence", title: "Evidence", items: evidenceItems.slice(0, 24) });
  }

  return sections;
}

function toItem(rel: Relationship, names: Map<string, string>): DossierItem {
  return {
    relationshipId: rel.id,
    claim: rel.claim,
    knowledge: rel.knowledge,
    source: names.get(rel.source) ?? rel.source,
    target: names.get(rel.target) ?? rel.target,
    type: rel.type,
  };
}
