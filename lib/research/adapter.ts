import type { DataSourceId } from "../dataCatalog";
import type { Document } from "../search";
import type { DroppedSource, Entity, Relationship, SearchResult } from "../types";
import type { FacetId } from "./facets";
import type { ResearchSpec } from "./spec";

export const WEB_SOURCE_ID = "web" as const;
export type SourceId = DataSourceId | typeof WEB_SOURCE_ID;

export type SourceCapability = {
  sourceId: SourceId;
  name: string;
  capabilities: FacetId[];
  entityTypes: string[];
  geography: string[];
  authorityLevel: number;
  freshness: "live" | "periodic" | "historical";
  accessType: "api" | "web" | "search";
  output: "documents" | "graph";
};

export type AdapterContext = {
  query: string;
  spec: ResearchSpec;
  facet?: FacetId;
  entities: Entity[];
  relationships: Relationship[];
  excludeUrls: string[];
  names: string[];
};

export type AdapterDocuments = {
  kind: "documents";
  documents: Document[];
  dropped: DroppedSource[];
  skipped: string[];
};

export type AdapterGraph = {
  kind: "graph";
  entities: Entity[];
  relationships: Relationship[];
  sources: SearchResult[];
  skipped: string[];
};

export type AdapterOutcome = AdapterDocuments | AdapterGraph;

export type SourceAdapter = {
  sourceId: SourceId;
  capability: SourceCapability;
  searchEntities?: (ctx: AdapterContext) => Promise<AdapterOutcome>;
  getEntity?: (ctx: AdapterContext) => Promise<AdapterOutcome>;
  searchRelationships?: (ctx: AdapterContext) => Promise<AdapterOutcome>;
  searchRecords?: (ctx: AdapterContext) => Promise<AdapterOutcome>;
  getEvidence?: (ctx: AdapterContext) => Promise<AdapterOutcome>;
};
