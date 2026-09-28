import { mergeEntity } from "./ontology";
import type { SessionRecord } from "./store";
import type { Entity, Relationship } from "./types";

export function addEntity(session: SessionRecord, entity: Entity) {
  const existing = session.entities.get(entity.id);
  session.entities.set(entity.id, existing ? mergeEntity(existing, entity) : entity);
}

export function upsertEntity(session: SessionRecord, entity: Entity): Entity {
  const byId = session.entities.get(entity.id);
  if (byId) {
    const merged = mergeEntity(byId, entity);
    session.entities.set(merged.id, merged);
    return merged;
  }
  for (const known of session.entities.values()) {
    const keys = new Set((known.identifiers ?? []).map((item) => `${item.scheme}:${item.value}`.toLowerCase()));
    const hit = (entity.identifiers ?? []).some((item) =>
      keys.has(`${item.scheme}:${item.value}`.toLowerCase()),
    );
    if (!hit) continue;
    const merged = mergeEntity(known, { ...entity, id: known.id });
    session.entities.set(merged.id, merged);
    return merged;
  }
  session.entities.set(entity.id, entity);
  return entity;
}

export function addRelationship(session: SessionRecord, relationship: Relationship) {
  session.relationships.set(relationship.id, relationship);
}

export function compactGraph(session: SessionRecord) {
  return {
    query: session.query,
    queries: session.queries,
    entities: [...session.entities.values()],
    relationships: [...session.relationships.values()].map((rel) => ({
      ...rel,
      validation: session.validations.get(rel.id),
    })),
  };
}
