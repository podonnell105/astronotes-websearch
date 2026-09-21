import type { SessionRecord } from "./store";
import type { Entity, Relationship } from "./types";

export function addEntity(session: SessionRecord, entity: Entity) {
  session.entities.set(entity.id, entity);
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
