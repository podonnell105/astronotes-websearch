import type { DataSourceId } from "../dataCatalog";
import type { Entity, Relationship, SearchResult } from "../types";

export type PoliticalFragment = {
  entities: Entity[];
  relationships: Relationship[];
  sources: SearchResult[];
  skipped: string[];
};

export type PoliticalSubject = {
  query: string;
  person?: Entity;
  names: string[];
};

export type PoliticalAdapterInput = {
  query: string;
  subject: PoliticalSubject;
  existing: Entity[];
  sources: DataSourceId[];
};

export function emptyFragment(): PoliticalFragment {
  return { entities: [], relationships: [], sources: [], skipped: [] };
}

export function mergeFragments(parts: PoliticalFragment[]): PoliticalFragment {
  const entities = new Map<string, Entity>();
  const relationships = new Map<string, Relationship>();
  const sources: SearchResult[] = [];
  const seenUrls = new Set<string>();
  const skipped: string[] = [];
  for (const part of parts) {
    for (const entity of part.entities) {
      const prev = entities.get(entity.id);
      entities.set(entity.id, prev ? { ...prev, ...entity, identifiers: [
        ...(prev.identifiers ?? []),
        ...(entity.identifiers ?? []),
      ] } : entity);
    }
    for (const rel of part.relationships) relationships.set(rel.id, rel);
    for (const source of part.sources) {
      if (!source.url || seenUrls.has(source.url)) continue;
      seenUrls.add(source.url);
      sources.push(source);
    }
    skipped.push(...part.skipped);
  }
  return {
    entities: [...entities.values()],
    relationships: [...relationships.values()],
    sources,
    skipped,
  };
}
