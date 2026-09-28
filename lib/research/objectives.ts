import { FACETS, facetAppliesTo, type FacetId } from "./facets";

export type ResearchObjective =
  | "understand"
  | "due_diligence"
  | "sales"
  | "competitive"
  | "discovery"
  | "relationship"
  | "investigation";

const OBJECTIVE_WEIGHTS: Record<ResearchObjective, Partial<Record<FacetId, number>>> = {
  understand: {
    identity: 10,
    background: 8,
    roles: 7,
    companies: 7,
    ownership: 6,
    products: 6,
    funding: 5,
    relationships: 8,
    timeline: 6,
    recent_activity: 7,
  },
  due_diligence: {
    identity: 10,
    ownership: 9,
    funding: 8,
    legal: 8,
    regulatory: 7,
    products: 6,
    customers: 6,
    competitors: 5,
    recent_activity: 7,
  },
  sales: {
    identity: 10,
    products: 9,
    customers: 8,
    competitors: 7,
    technology: 7,
    hiring: 7,
    recent_activity: 8,
    roles: 8,
    relationships: 6,
  },
  competitive: {
    identity: 8,
    products: 10,
    customers: 8,
    competitors: 10,
    technology: 8,
    funding: 7,
    hiring: 6,
    recent_activity: 8,
  },
  discovery: {
    identity: 8,
    companies: 9,
    products: 7,
    customers: 7,
    competitors: 8,
    funding: 6,
    relationships: 8,
  },
  relationship: {
    identity: 8,
    relationships: 10,
    roles: 8,
    companies: 8,
    ownership: 7,
    donations: 6,
    lobbying: 6,
    political_activity: 6,
  },
  investigation: {
    identity: 9,
    relationships: 10,
    ownership: 8,
    donations: 8,
    lobbying: 8,
    political_activity: 8,
    contracts: 7,
    legal: 7,
    timeline: 6,
  },
};

export function detectObjective(question: string): ResearchObjective {
  if (/\b(before i (invest|buy)|due diligence|dd\b)\b/i.test(question)) return "due_diligence";
  if (/\b(prospect|before i contact|sales|outreach)\b/i.test(question)) return "sales";
  if (/\b(competitor|competitive intelligence|rival)\b/i.test(question)) return "competitive";
  if (/\b(companies like|similar to|find companies)\b/i.test(question)) return "discovery";
  if (/\b(how (is|are).+connected|common investors?|who connects)\b/i.test(question)) {
    return "relationship";
  }
  if (/\b(investigat|map (publicly )?documented|what is the relationship)\b/i.test(question)) {
    return "investigation";
  }
  return "understand";
}

export function objectiveWeights(objective: ResearchObjective): Partial<Record<FacetId, number>> {
  return OBJECTIVE_WEIGHTS[objective];
}

export function rankFacetsForObjective(
  objective: ResearchObjective,
  entityTypes: string[],
  mentioned: FacetId[],
): FacetId[] {
  const weights = objectiveWeights(objective);
  const scored = new Map<FacetId, number>();
  for (const facet of FACETS) {
    if (entityTypes.length > 0 && !entityTypes.some((type) => facetAppliesTo(facet, type))) {
      continue;
    }
    const weight = weights[facet.id] ?? 0;
    const mentionBoost = mentioned.includes(facet.id) ? 12 : 0;
    const score = weight + mentionBoost;
    if (score <= 0) continue;
    scored.set(facet.id, score);
  }
  for (const facet of mentioned) {
    if (!scored.has(facet)) scored.set(facet, 12);
  }
  return [...scored.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([id]) => id);
}
