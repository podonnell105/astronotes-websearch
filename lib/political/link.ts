import { makeEntity, mergeEntity, relationshipId } from "../ontology";
import type { Entity, Relationship } from "../types";
import { foldName, nameInText, personNameFromQuery, sameName } from "./names";

const MONEY = new Set(["lobbied_on", "donated_to"]);
const PARTY_TYPES = new Set(["member_of", "leader_of", "leads", "belongs_to", "deputy_of"]);

export type LinkedGraph = {
  entities: Entity[];
  relationships: Relationship[];
  subjectName?: string;
  partyName?: string;
};

export function linkPoliticalGraph(
  entities: Entity[],
  relationships: Relationship[],
  query: string,
  options?: { subjectName?: string },
): LinkedGraph {
  const merged = mergeSameNames(entities, relationships);
  const found = findSubject(merged.entities, query, options?.subjectName);
  const hasMoney = merged.relationships.some((rel) => MONEY.has(rel.type));
  if (!found && !hasMoney) {
    return { entities: merged.entities, relationships: merged.relationships };
  }
  const subject = found ?? createSubject(merged.entities, options?.subjectName || personNameFromQuery(query));
  if (!subject) {
    return { entities: merged.entities, relationships: merged.relationships };
  }

  const byId = new Map(merged.entities.map((entity) => [entity.id, entity]));
  const party = partyFor(subject, byId, merged.relationships);
  const rewritten = merged.relationships.map((rel) => {
    if (!MONEY.has(rel.type)) return rel;
    return retargetMoney(rel, subject, party, byId) ?? rel;
  });

  const stitched = stitchToSubject(subject, party, merged.entities, rewritten);
  const kept = keepSubjectComponent(subject.id, merged.entities, stitched);
  const unique = uniqueGraph(kept.entities, kept.relationships);
  return {
    entities: unique.entities,
    relationships: unique.relationships,
    subjectName: subject.name,
    partyName: party?.name,
  };
}

function mergeSameNames(
  entities: Entity[],
  relationships: Relationship[],
): { entities: Entity[]; relationships: Relationship[] } {
  const groups = new Map<string, Entity[]>();
  const people: Entity[][] = [];
  for (const entity of entities) {
    if (entity.kind === "person" || entity.type === "person") {
      const group = people.find((items) => items.some((other) => sameName(other.name, entity.name)));
      if (group) group.push(entity);
      else people.push([entity]);
      continue;
    }
    const key = `${entity.kind ?? entity.type}:${foldName(entity.name)}`;
    const list = groups.get(key);
    if (list) list.push(entity);
    else groups.set(key, [entity]);
  }
  people.forEach((group, index) => groups.set(`person:${index}`, group));

  const remap = new Map<string, string>();
  const out: Entity[] = [];
  for (const group of groups.values()) {
    const canonical = canonicalEntity(group);
    out.push(canonical);
    for (const entity of group) {
      if (entity.id !== canonical.id) remap.set(entity.id, canonical.id);
    }
  }

  const known = new Set(out.map((entity) => entity.id));
  return {
    entities: out,
    relationships: uniqueRelationships(relationships, remap, known),
  };
}

function canonicalEntity(group: Entity[]): Entity {
  const ranked = [...group].sort((a, b) => {
    const idBoost = (entity: Entity) => ((entity.identifiers?.length ?? 0) > 0 ? 1 : 0);
    return idBoost(b) - idBoost(a);
  });
  const base = ranked[0];
  let merged = base;
  for (const entity of group) {
    if (entity.id === base.id) continue;
    merged = mergeEntity(merged, { ...entity, id: base.id });
  }
  const name = preferredName(group);
  return { ...merged, id: base.id, name };
}

function preferredName(group: Entity[]): string {
  return [...group].sort((a, b) => nameQuality(b.name) - nameQuality(a.name))[0]?.name ?? group[0].name;
}

function nameQuality(name: string): number {
  const letters = name.replace(/[^A-Za-z]/g, "");
  const caps = name.replace(/[^A-Z]/g, "").length;
  const shouting = letters.length > 0 && caps / letters.length > 0.7;
  return (shouting ? -30 : 0) + (name.includes("(") ? -20 : 0) + Math.min(name.length, 48);
}

function findSubject(
  entities: Entity[],
  query: string,
  subjectName?: string,
): Entity | undefined {
  const wanted = subjectName || personNameFromQuery(query);
  let best: Entity | undefined;
  let bestScore = 0;
  for (const entity of entities) {
    if (entity.kind !== "person" && entity.type !== "person") continue;
    const score = wanted && sameName(entity.name, wanted) ? 100 + entity.name.length : personScore(entity.name, query);
    if (score > bestScore) {
      best = entity;
      bestScore = score;
    }
  }
  return best;
}

function createSubject(entities: Entity[], name: string | undefined): Entity | undefined {
  if (!name) return undefined;
  const created = makeEntity({
    name,
    type: "person",
    kind: "person",
    id: name,
  });
  entities.push(created);
  return created;
}

function personScore(name: string, query: string): number {
  const foldedQuery = foldName(query);
  const foldedName = foldName(name);
  if (!foldedName || !foldedQuery) return 0;
  if (foldedQuery.includes(foldedName)) return 80 + foldedName.length;
  const tokens = foldedName.split(" ").filter((token) => token.length > 2);
  if (tokens.length < 2) return 0;
  const hits = tokens.filter((token) => foldedQuery.includes(token)).length;
  return hits === tokens.length ? 40 + hits : 0;
}

function partyFor(
  subject: Entity,
  byId: Map<string, Entity>,
  relationships: Relationship[],
): Entity | undefined {
  let best: { entity: Entity; score: number } | undefined;
  for (const rel of relationships) {
    if (rel.source !== subject.id && rel.target !== subject.id) continue;
    const other = byId.get(rel.source === subject.id ? rel.target : rel.source);
    if (!other || other.id === subject.id) continue;
    if (!isOrganization(other)) continue;
    let score = 1;
    if (PARTY_TYPES.has(rel.type)) score += 6;
    if (/\b(party|leader|deputy|sinn)\b/i.test(`${rel.type} ${rel.claim} ${other.name}`)) score += 4;
    if (/\b(school|academy|university|college|council|assembly|parliament|office)\b/i.test(other.name)) {
      score -= 5;
    }
    if (!best || score > best.score) best = { entity: other, score };
  }
  return best && best.score >= 4 ? best.entity : undefined;
}

function isOrganization(entity: Entity): boolean {
  return (
    entity.kind === "organization" ||
    entity.kind === "company" ||
    entity.type === "organization" ||
    entity.type === "company"
  );
}

function retargetMoney(
  rel: Relationship,
  subject: Entity,
  party: Entity | undefined,
  byId: Map<string, Entity>,
): Relationship | undefined {
  const outside = outsideParty(rel, subject, party, byId);
  if (!outside) return undefined;
  const anchor = moneyAnchor(rel, subject, party, byId);
  if (outside.id === anchor.id) return undefined;
  if (rel.source === outside.id && rel.target === anchor.id) return rel;
  return { ...rel, source: outside.id, target: anchor.id };
}

function outsideParty(
  rel: Relationship,
  subject: Entity,
  party: Entity | undefined,
  byId: Map<string, Entity>,
): Entity | undefined {
  const ends = uniqueEnds(rel, byId).filter((entity) => entity.id !== subject.id && entity.id !== party?.id);
  if (ends.length === 0) return undefined;
  return (
    ends.find((entity) => isOrganization(entity)) ??
    ends.find((entity) => entity.kind !== "legislation" && entity.type !== "legislation") ??
    ends[0]
  );
}

function uniqueEnds(rel: Relationship, byId: Map<string, Entity>): Entity[] {
  const source = byId.get(rel.source);
  const target = byId.get(rel.target);
  if (source && target && source.id === target.id) return [source];
  return [source, target].filter((entity): entity is Entity => Boolean(entity));
}

function moneyAnchor(
  rel: Relationship,
  subject: Entity,
  party: Entity | undefined,
  byId: Map<string, Entity>,
): Entity {
  if (!party) return subject;
  const text = [rel.claim, rel.evidenceSnippet, byId.get(rel.source)?.name, byId.get(rel.target)?.name]
    .filter(Boolean)
    .join(" ");
  const aboutParty = nameInText(party.name, text);
  const aboutPerson = nameInText(subject.name, text);
  if (aboutParty && !aboutPerson) return party;
  if (aboutParty && aboutPerson) {
    const folded = foldName(text);
    const toParty = new RegExp(`(?:to|for|towards|into) ${foldName(party.name)}`).test(folded);
    const toPerson = new RegExp(`(?:to|for|towards|into) ${foldName(subject.name)}`).test(folded);
    if (toParty && !toPerson) return party;
  }
  return subject;
}

function stitchToSubject(
  subject: Entity,
  party: Entity | undefined,
  entities: Entity[],
  relationships: Relationship[],
): Relationship[] {
  const extra: Relationship[] = [...relationships];
  for (const ids of componentIds(entities, relationships)) {
    if (ids.has(subject.id)) continue;
    const members = entities.filter((entity) => ids.has(entity.id));
    const claims = relationships.filter((rel) => ids.has(rel.source) && ids.has(rel.target));
    const text = [...members.map((entity) => entity.name), ...claims.map((rel) => rel.claim)].join(" ");
    const anchor = party && nameInText(party.name, text) && !nameInText(subject.name, text) ? party : subject;
    const hub =
      members.find((entity) => isOrganization(entity)) ??
      [...members].sort((a, b) => hubScore(b) - hubScore(a))[0];
    if (!hub || hub.id === anchor.id) continue;
    if (extra.some((rel) => rel.source === hub.id && rel.target === anchor.id)) continue;
    extra.push({
      id: `${hub.id}__related_to__${anchor.id}`,
      source: hub.id,
      target: anchor.id,
      type: "related_to",
      claim: `${hub.name} is linked to ${anchor.name} from the register records for this research.`,
      status: "unclear",
      basis: "recorded",
    });
  }
  return extra;
}

function hubScore(entity: Entity): number {
  if (isOrganization(entity)) return 3;
  if (entity.kind === "person" || entity.type === "person") return 0;
  return 1;
}

function componentIds(entities: Entity[], relationships: Relationship[]): Set<string>[] {
  const adjacency = new Map<string, string[]>();
  for (const entity of entities) adjacency.set(entity.id, []);
  for (const rel of relationships) {
    if (rel.source === rel.target) continue;
    adjacency.get(rel.source)?.push(rel.target);
    adjacency.get(rel.target)?.push(rel.source);
  }
  const seen = new Set<string>();
  const groups: Set<string>[] = [];
  for (const entity of entities) {
    if (seen.has(entity.id)) continue;
    const group = new Set<string>();
    const stack = [entity.id];
    while (stack.length) {
      const id = stack.pop();
      if (!id || group.has(id)) continue;
      group.add(id);
      seen.add(id);
      for (const next of adjacency.get(id) ?? []) stack.push(next);
    }
    groups.push(group);
  }
  return groups;
}

function keepSubjectComponent(
  subjectId: string,
  entities: Entity[],
  relationships: Relationship[],
): { entities: Entity[]; relationships: Relationship[] } {
  const live = relationships.filter((rel) => rel.source !== rel.target);
  const adjacency = new Map<string, string[]>();
  for (const entity of entities) adjacency.set(entity.id, []);
  for (const rel of live) {
    adjacency.get(rel.source)?.push(rel.target);
    adjacency.get(rel.target)?.push(rel.source);
  }
  const keep = new Set<string>();
  const stack = [subjectId];
  while (stack.length) {
    const id = stack.pop();
    if (!id || keep.has(id)) continue;
    keep.add(id);
    for (const next of adjacency.get(id) ?? []) stack.push(next);
  }
  return {
    entities: entities.filter((entity) => keep.has(entity.id)),
    relationships: live.filter((rel) => keep.has(rel.source) && keep.has(rel.target)),
  };
}

function uniqueGraph(
  entities: Entity[],
  relationships: Relationship[],
): { entities: Entity[]; relationships: Relationship[] } {
  const byId = new Map<string, Entity>();
  for (const entity of entities) {
    if (!entity.id || byId.has(entity.id)) continue;
    byId.set(entity.id, entity);
  }
  return {
    entities: [...byId.values()],
    relationships: uniqueRelationships(relationships, new Map(), byId),
  };
}

function uniqueRelationships(
  relationships: Relationship[],
  remap: Map<string, string>,
  known: Map<string, Entity> | Set<string>,
): Relationship[] {
  const has = (id: string) => known.has(id);
  const seen = new Set<string>();
  const out: Relationship[] = [];
  for (const rel of relationships) {
    const source = remap.get(rel.source) ?? rel.source;
    const target = remap.get(rel.target) ?? rel.target;
    if (!source || !target || !has(source) || !has(target)) continue;
    if (source === target && !MONEY.has(rel.type)) continue;
    const extra = rel.id.split("__").slice(3).join("__");
    const id = relationshipId(source, rel.type, target, extra || undefined);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(source === rel.source && target === rel.target && id === rel.id ? rel : { ...rel, id, source, target });
  }
  return out;
}
