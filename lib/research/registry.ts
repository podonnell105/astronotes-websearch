import { DATA_CATALOG, ROLE_PRESETS, type DataSourceId } from "../dataCatalog";
import { dataSourceAvailability } from "../config";
import { inferAnalystRole } from "../queryPolicy";
import {
  WEB_SOURCE_ID,
  type SourceAdapter,
  type SourceCapability,
  type SourceId,
} from "./adapter";
import type { FacetId } from "./facets";
import type { EntityReference, ResearchSpec } from "./spec";

type CapabilitySeed = Omit<SourceCapability, "name"> & { name?: string };

const SEEDS: CapabilitySeed[] = [
  {
    sourceId: WEB_SOURCE_ID,
    name: "Web search",
    capabilities: [
      "identity",
      "background",
      "products",
      "technology",
      "customers",
      "competitors",
      "partnerships",
      "hiring",
      "media",
      "events",
      "relationships",
      "timeline",
      "recent_activity",
      "employment",
      "roles",
      "companies",
    ],
    entityTypes: [],
    geography: [],
    authorityLevel: 45,
    freshness: "live",
    accessType: "search",
    output: "documents",
  },
  {
    sourceId: "edgar",
    capabilities: ["identity", "ownership", "funding", "products", "legal"],
    entityTypes: ["company", "organization"],
    geography: ["US"],
    authorityLevel: 92,
    freshness: "periodic",
    accessType: "api",
    output: "documents",
  },
  {
    sourceId: "usaspending",
    capabilities: ["contracts", "customers"],
    entityTypes: ["company", "organization"],
    geography: ["US"],
    authorityLevel: 88,
    freshness: "periodic",
    accessType: "api",
    output: "documents",
  },
  {
    sourceId: "gleif",
    capabilities: ["identity", "ownership", "companies"],
    entityTypes: ["company", "organization"],
    geography: [],
    authorityLevel: 94,
    freshness: "periodic",
    accessType: "api",
    output: "documents",
  },
  {
    sourceId: "companies_house",
    capabilities: ["identity", "ownership", "directorships", "companies", "roles"],
    entityTypes: ["person", "company", "organization"],
    geography: ["GB", "NI"],
    authorityLevel: 96,
    freshness: "live",
    accessType: "api",
    output: "graph",
  },
  {
    sourceId: "github",
    capabilities: ["technology", "products", "recent_activity"],
    entityTypes: ["company", "organization", "person", "product"],
    geography: [],
    authorityLevel: 70,
    freshness: "live",
    accessType: "api",
    output: "documents",
  },
  {
    sourceId: "nih_reporter",
    capabilities: ["research", "funding", "publications"],
    entityTypes: ["person", "organization", "company"],
    geography: ["US"],
    authorityLevel: 88,
    freshness: "periodic",
    accessType: "api",
    output: "documents",
  },
  {
    sourceId: "clinicaltrials",
    capabilities: ["research", "products", "regulatory"],
    entityTypes: ["company", "organization", "person"],
    geography: [],
    authorityLevel: 90,
    freshness: "live",
    accessType: "api",
    output: "documents",
  },
  {
    sourceId: "openalex",
    capabilities: ["publications", "research", "relationships"],
    entityTypes: ["person", "organization"],
    geography: [],
    authorityLevel: 86,
    freshness: "periodic",
    accessType: "api",
    output: "documents",
  },
  {
    sourceId: "opensanctions",
    capabilities: ["legal", "identity", "regulatory"],
    entityTypes: ["person", "company", "organization"],
    geography: [],
    authorityLevel: 93,
    freshness: "live",
    accessType: "api",
    output: "documents",
  },
  {
    sourceId: "wayback",
    capabilities: ["timeline", "products", "identity"],
    entityTypes: ["company", "organization", "product"],
    geography: [],
    authorityLevel: 60,
    freshness: "historical",
    accessType: "web",
    output: "documents",
  },
  {
    sourceId: "patents",
    capabilities: ["patents", "technology", "products"],
    entityTypes: ["person", "company", "organization", "product"],
    geography: ["US"],
    authorityLevel: 88,
    freshness: "periodic",
    accessType: "api",
    output: "documents",
  },
  {
    sourceId: "sam",
    capabilities: ["contracts"],
    entityTypes: ["company", "organization"],
    geography: ["US"],
    authorityLevel: 86,
    freshness: "live",
    accessType: "api",
    output: "documents",
  },
  {
    sourceId: "uk_parliament",
    capabilities: ["identity", "roles", "political_activity", "relationships"],
    entityTypes: ["person"],
    geography: ["GB"],
    authorityLevel: 97,
    freshness: "live",
    accessType: "api",
    output: "graph",
  },
  {
    sourceId: "uk_hansard",
    capabilities: ["political_activity", "timeline"],
    entityTypes: ["person"],
    geography: ["GB"],
    authorityLevel: 95,
    freshness: "live",
    accessType: "api",
    output: "graph",
  },
  {
    sourceId: "uk_interests",
    capabilities: ["donations", "ownership", "roles", "companies"],
    entityTypes: ["person"],
    geography: ["GB"],
    authorityLevel: 96,
    freshness: "periodic",
    accessType: "api",
    output: "graph",
  },
  {
    sourceId: "electoral_commission",
    capabilities: ["donations", "political_activity"],
    entityTypes: ["person", "organization", "company"],
    geography: ["GB", "NI"],
    authorityLevel: 96,
    freshness: "periodic",
    accessType: "api",
    output: "graph",
  },
  {
    sourceId: "contracts_finder",
    capabilities: ["contracts"],
    entityTypes: ["company", "organization"],
    geography: ["GB", "NI"],
    authorityLevel: 90,
    freshness: "live",
    accessType: "api",
    output: "graph",
  },
  {
    sourceId: "oireachtas",
    capabilities: ["identity", "roles", "political_activity"],
    entityTypes: ["person"],
    geography: ["IE"],
    authorityLevel: 95,
    freshness: "live",
    accessType: "api",
    output: "graph",
  },
  {
    sourceId: "ni_assembly",
    capabilities: ["identity", "roles", "political_activity", "donations"],
    entityTypes: ["person"],
    geography: ["NI"],
    authorityLevel: 96,
    freshness: "live",
    accessType: "api",
    output: "graph",
  },
  {
    sourceId: "lobbying_ie",
    capabilities: ["lobbying", "political_activity"],
    entityTypes: ["person", "organization", "company"],
    geography: ["IE"],
    authorityLevel: 92,
    freshness: "periodic",
    accessType: "api",
    output: "graph",
  },
  {
    sourceId: "congress_gov",
    capabilities: ["identity", "roles", "political_activity"],
    entityTypes: ["person"],
    geography: ["US"],
    authorityLevel: 95,
    freshness: "live",
    accessType: "api",
    output: "graph",
  },
  {
    sourceId: "openfec",
    capabilities: ["donations", "political_activity"],
    entityTypes: ["person", "organization", "company"],
    geography: ["US"],
    authorityLevel: 94,
    freshness: "periodic",
    accessType: "api",
    output: "graph",
  },
  {
    sourceId: "senate_lda",
    capabilities: ["lobbying", "political_activity"],
    entityTypes: ["person", "organization", "company"],
    geography: ["US"],
    authorityLevel: 93,
    freshness: "periodic",
    accessType: "api",
    output: "graph",
  },
  {
    sourceId: "europarl",
    capabilities: ["identity", "roles", "political_activity"],
    entityTypes: ["person"],
    geography: ["EU"],
    authorityLevel: 94,
    freshness: "live",
    accessType: "api",
    output: "graph",
  },
  {
    sourceId: "eu_transparency",
    capabilities: ["lobbying", "political_activity"],
    entityTypes: ["person", "organization", "company"],
    geography: ["EU"],
    authorityLevel: 92,
    freshness: "periodic",
    accessType: "api",
    output: "graph",
  },
  {
    sourceId: "ted",
    capabilities: ["contracts"],
    entityTypes: ["company", "organization"],
    geography: ["EU"],
    authorityLevel: 90,
    freshness: "live",
    accessType: "api",
    output: "graph",
  },
];

function catalogName(id: SourceId): string {
  if (id === WEB_SOURCE_ID) return "Web search";
  return DATA_CATALOG.find((item) => item.id === id)?.label ?? id;
}

export const SOURCE_CAPABILITIES: SourceCapability[] = SEEDS.map((seed) => ({
  ...seed,
  name: seed.name ?? catalogName(seed.sourceId),
}));

const BY_ID = new Map(SOURCE_CAPABILITIES.map((item) => [item.sourceId, item]));

export function sourceCapability(id: SourceId): SourceCapability | undefined {
  return BY_ID.get(id);
}

export function isGraphSource(id: SourceId): boolean {
  return sourceCapability(id)?.output === "graph";
}

export function isDocumentSource(id: SourceId): id is DataSourceId {
  return id !== WEB_SOURCE_ID && sourceCapability(id)?.output === "documents";
}

export function politicalRegisterIds(): DataSourceId[] {
  return SOURCE_CAPABILITIES.filter(
    (item) => item.output === "graph" && item.sourceId !== WEB_SOURCE_ID,
  ).map((item) => item.sourceId as DataSourceId);
}

function geographyFits(source: SourceCapability, geography: string[]): boolean {
  if (source.geography.length === 0) return true;
  if (geography.length === 0) return false;
  return source.geography.some((code) => geography.includes(code));
}

function entityFits(source: SourceCapability, subjects: EntityReference[]): boolean {
  if (source.entityTypes.length === 0) return true;
  const types = subjects.map((subject) => subject.type).filter((type): type is string => Boolean(type));
  if (types.length === 0) return true;
  return types.some((type) => source.entityTypes.includes(type));
}

export function selectSources(spec: ResearchSpec, facet?: FacetId): SourceId[] {
  const geography = spec.geography ?? [];
  const facets = facet ? [facet] : spec.facets;
  const pack = inferAnalystRole(spec.question);
  const packSources = pack === "custom" ? [] : ROLE_PRESETS[pack];
  const availability = dataSourceAvailability();

  const scored: Array<{ id: SourceId; score: number }> = [];
  for (const source of SOURCE_CAPABILITIES) {
    if (source.sourceId !== WEB_SOURCE_ID) {
      const available = availability[source.sourceId as DataSourceId];
      if (available === false) continue;
    }
    if (!entityFits(source, spec.subjects)) continue;
    if (!geographyFits(source, geography)) continue;
    const matched = facets.filter((item) => source.capabilities.includes(item));
    if (matched.length === 0) continue;
    let score = source.authorityLevel + matched.length * 4;
    if (packSources.includes(source.sourceId as DataSourceId)) score += 10;
    if (source.sourceId === WEB_SOURCE_ID) score += 6;
    if (source.sourceId === "gleif" || source.sourceId === "opensanctions") score += 3;
    scored.push({ id: source.sourceId, score });
  }

  scored.sort((left, right) => right.score - left.score);
  const selected: SourceId[] = [];
  const seen = new Set<SourceId>();
  for (const item of scored) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    selected.push(item.id);
    if (selected.length >= 10) break;
  }
  if (!seen.has(WEB_SOURCE_ID)) selected.push(WEB_SOURCE_ID);
  return selected;
}

export function catalogIdsFrom(ids: SourceId[]): DataSourceId[] {
  return ids.filter((id): id is DataSourceId => id !== WEB_SOURCE_ID);
}

export function adaptersFor(ids: SourceId[]): SourceAdapter[] {
  return ids.flatMap((id) => {
    const capability = sourceCapability(id);
    if (!capability) return [];
    return [
      {
        sourceId: id,
        capability,
      },
    ];
  });
}
