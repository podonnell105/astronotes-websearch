import type { Entity } from "./types";
import { slugify } from "./extraction";
import { classifyEntityMatches, toValidation } from "./jev";

export type EntityResolution = {
  entities: Entity[];
  merges: { from: string; into: string; decision: string; model: "jev" | "mock" }[];
};

const STRIP_TOKENS = [
  "inc",
  "inc.",
  "corp",
  "corp.",
  "ltd",
  "ltd.",
  "llc",
  "co",
  "co.",
  "the",
  "company",
  "corporation",
  "laboratories",
  "labs",
  "bell labs",
];

const MATCH_BATCH = 4;
const MATCH_CAP = 8;
const CONTEXT_CAP = 160;

export async function resolveEntities(
  incoming: Entity[],
  existing: Entity[] = [],
  mentions: Map<string, string> = new Map(),
): Promise<EntityResolution> {
  const unique = dedupeExact(incoming);
  const existingIds = new Set(existing.map((entity) => entity.id));
  const unresolved = unique.filter((entity) => !existingIds.has(entity.id));
  const candidates = findMergeCandidates(unresolved, existing);
  const merges: EntityResolution["merges"] = [];
  const alias = new Map<string, string>();

  const batches: [Entity, Entity][][] = [];
  for (let i = 0; i < candidates.length; i += MATCH_BATCH) {
    batches.push(candidates.slice(i, i + MATCH_BATCH));
  }

  const classifiedBatches = await Promise.all(
    batches.map((batch, batchIndex) =>
      classifyEntityMatches(
        batch.map(([left, right], index) => ({
          id: `match_${batchIndex * MATCH_BATCH + index}`,
          left,
          right,
          contextLeft: mentions.get(left.id)?.slice(0, CONTEXT_CAP),
          contextRight: mentions.get(right.id)?.slice(0, CONTEXT_CAP),
        })),
      ),
    ),
  );

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    const classified = classifiedBatches[batchIndex];
    for (let index = 0; index < batch.length; index++) {
      const [left, right] = batch[index];
      const validation = toValidation(
        classified.result,
        `match_${batchIndex * MATCH_BATCH + index}`,
      );
      if (validation.decision !== "YES") continue;
      const into = preferCanonical(left, right, existingIds);
      const from = into.id === left.id ? right : left;
      alias.set(from.id, into.id);
      merges.push({
        from: from.id,
        into: into.id,
        decision: validation.decision,
        model: validation.model,
      });
    }
  }

  const resolved: Entity[] = [];
  const kept = new Set<string>();
  for (const entity of unresolved) {
    const canonical = followAlias(entity.id, alias);
    if (canonical !== entity.id) continue;
    if (existingIds.has(entity.id) || kept.has(entity.id)) continue;
    kept.add(entity.id);
    resolved.push(entity);
  }

  return { entities: resolved, merges };
}

export function remapId(id: string, merges: EntityResolution["merges"]): string {
  const map = new Map(merges.map((m) => [m.from, m.into]));
  return followAlias(id, map);
}

function followAlias(id: string, map: Map<string, string>): string {
  let current = id;
  for (let i = 0; i < 5; i++) {
    const next = map.get(current);
    if (!next) break;
    current = next;
  }
  return current;
}

function dedupeExact(entities: Entity[]): Entity[] {
  const byId = new Map<string, Entity>();
  for (const entity of entities) {
    const id = slugify(entity.id || entity.name);
    if (!byId.has(id)) byId.set(id, { ...entity, id });
  }
  return [...byId.values()];
}

function findMergeCandidates(
  incoming: Entity[],
  existing: Entity[],
): [Entity, Entity][] {
  const pairs: [Entity, Entity][] = [];
  for (let i = 0; i < incoming.length; i++) {
    for (let j = i + 1; j < incoming.length; j++) {
      const a = incoming[i];
      const b = incoming[j];
      if (likelySame(a, b)) pairs.push([a, b]);
    }
  }
  for (const incomingEntity of incoming) {
    for (const known of existing) {
      if (incomingEntity.id === known.id) continue;
      if (likelySame(incomingEntity, known)) pairs.push([incomingEntity, known]);
    }
  }
  return pairs.slice(0, MATCH_CAP);
}

function likelySame(a: Entity, b: Entity): boolean {
  const na = normalizeName(a.name);
  const nb = normalizeName(b.name);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) {
    return Math.min(na.length, nb.length) >= 4;
  }
  return false;
}

function normalizeName(name: string): string {
  let value = name.toLowerCase();
  for (const token of STRIP_TOKENS) {
    value = value.replace(new RegExp(`\\b${token}\\b`, "g"), " ");
  }
  return value.replace(/[^a-z0-9]+/g, " ").trim();
}

function preferCanonical(a: Entity, b: Entity, existingIds: Set<string>): Entity {
  if (existingIds.has(a.id) !== existingIds.has(b.id)) {
    return existingIds.has(a.id) ? a : b;
  }
  if (a.name.length !== b.name.length) {
    return a.name.length <= b.name.length ? a : b;
  }
  return a;
}
