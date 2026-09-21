import { detectRuntime, nowStamp } from "./config";
import { DEMO_QUERY, DEMO_VALIDATIONS, sourcesForRelationship } from "./demo";
import { addEvidence, sourcesForUrls } from "./evidence";
import { remapId, resolveEntities } from "./entities";
import {
  attachNewEntities,
  evidenceExcerpt,
  extractKnowledge,
  groundRelationships,
} from "./extraction";
import { addEntity, addRelationship } from "./graph";
import { classifyClaims, toValidation } from "./jev";
import { fetchRelevantPages, rankKnownEntities, searchWeb } from "./search";
import { buildNeighborhood, planResearch } from "./researchPlan";
import {
  createSession,
  getSession,
  rememberEvent,
  resumeSession,
  type SessionRecord,
} from "./store";
import type { Emit, Entity, Relationship } from "./types";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(emit: Emit, session: SessionRecord, message: string) {
  const event = { type: "log" as const, timestamp: nowStamp(), message };
  rememberEvent(session, event);
  emit(event);
}

function stats(emit: Emit, session: SessionRecord) {
  const event = {
    type: "stats" as const,
    sources: session.sources.length,
    entities: session.entities.size,
    relationships: session.relationships.size,
    validations: session.validations.size,
  };
  rememberEvent(session, event);
  emit(event);
}

export async function runResearch(
  query: string,
  emit: Emit,
  sessionId?: string,
  options?: { preferExistingLinks?: boolean; userId?: string },
): Promise<SessionRecord> {
  const runtime = detectRuntime();
  const nextQuery = query.trim() || DEMO_QUERY;
  const session = sessionId
    ? resumeOrThrow(sessionId, nextQuery)
    : createSession(requiredUserId(options?.userId), nextQuery, runtime.mode);
  const extending = Boolean(sessionId);
  const preferExistingLinks = Boolean(options?.preferExistingLinks && extending);
  const stagger = runtime.mode === "demo" ? 140 : 0;

  const sessionEvent = { type: "session" as const, sessionId: session.id };
  rememberEvent(session, sessionEvent);
  emit(sessionEvent);

  const modeEvent = {
    type: "mode" as const,
    mode: runtime.mode,
    search: runtime.search,
    jev: runtime.jev,
  };
  rememberEvent(session, modeEvent);
  emit(modeEvent);

  try {
    const existingEntities = [...session.entities.values()];
    const existingRelationships = [...session.relationships.values()];
    const excludeUrls = session.sources.map((source) => source.url);
    const knownEntities = rankKnownEntities(
      nextQuery,
      existingEntities.map((entity) => ({
        id: entity.id,
        name: entity.name,
        type: entity.type,
      })),
    );

    let searchQuery = nextQuery;
    let allowNewEntities = !preferExistingLinks;
    let gaps: string[] = [];
    if (extending) {
      log(emit, session, "Extending the graph...");
      const neighborhood = buildNeighborhood(
        nextQuery,
        existingEntities,
        existingRelationships,
      );
      const plan = await planResearch(nextQuery, neighborhood, preferExistingLinks);
      searchQuery = plan.searchQuery;
      allowNewEntities = plan.allowNewEntities;
      gaps = plan.gaps;
      log(emit, session, `Searching for: ${searchQuery}`);
    } else {
      log(emit, session, "Searching the web...");
    }

    if (runtime.search === "mock") {
      log(
        emit,
        session,
        runtime.mode === "demo"
          ? `No search provider configured — using demo corpus for “${DEMO_QUERY}”`
          : "Using demo search corpus",
      );
    } else if (runtime.search === "tavily") {
      log(emit, session, "Searching with Tavily...");
    } else {
      log(emit, session, "Searching with OpenAI...");
    }

    const { results, provider } = await searchWeb(searchQuery, {
      knownEntities: extending ? knownEntities.slice(0, 3) : undefined,
      excludeUrls,
      gaps: gaps.length ? gaps : undefined,
    });
    if (runtime.search === "tavily" && provider === "openai") {
      log(emit, session, "Tavily unavailable — using OpenAI web search");
    }

    if (results.length === 0) {
      log(emit, session, "No new sources to add");
      stats(emit, session);
      return complete(session, emit);
    }

    for (const result of results) {
      if (session.sources.some((source) => source.url === result.url)) continue;
      session.sources.push(result);
      const event = { type: "source" as const, result };
      rememberEvent(session, event);
      emit(event);
      log(emit, session, `Found ${result.source || result.title}`);
      stats(emit, session);
      if (stagger) await sleep(stagger);
    }

    log(emit, session, `Found ${results.length} sources`);
    log(emit, session, "Reading relevant pages...");
    const documents =
      runtime.search === "mock"
        ? results.map((result) => ({ ...result, text: result.snippet }))
        : await fetchRelevantPages(results);

    log(emit, session, "Extracting entities and claims...");
    let extracted = await extractKnowledge(nextQuery, documents, {
      existingEntities,
      existingRelationships: existingRelationships.map((rel) => ({
        source: rel.source,
        type: rel.type,
        target: rel.target,
      })),
      preferExistingLinks: extending && !allowNewEntities,
      allowNewEntities: extending ? allowNewEntities : undefined,
      gaps,
    });
    if (runtime.search !== "mock") {
      const before = extracted.relationships.length;
      extracted.relationships = groundRelationships(
        extracted.relationships,
        documents,
      );
      if (extracted.relationships.length < before) {
        log(
          emit,
          session,
          `Dropped ${before - extracted.relationships.length} ungrounded claims`,
        );
      }
    }
    if (extending && existingEntities.length > 0) {
      extracted = attachNewEntities(
        extracted,
        rankExisting(nextQuery, existingEntities),
        documents,
      );
    }
    log(emit, session, `Extracted ${extracted.entities.length} candidate entities`);

    log(
      emit,
      session,
      extending && !allowNewEntities
        ? "Linking new evidence to existing entities with Jev"
        : "Resolving entities...",
    );
    const resolved = await resolveEntities(
      extracted.entities,
      existingEntities,
      mentionMap(extracted.relationships),
    );
    for (const merge of resolved.merges) {
      log(
        emit,
        session,
        `Entity match ${merge.from} → ${merge.into}  ${merge.decision} (${merge.model})`,
      );
    }

    for (const entity of resolved.entities) {
      if (session.entities.has(entity.id)) continue;
      addEntity(session, entity);
      const event = { type: "entity" as const, entity };
      rememberEvent(session, event);
      emit(event);
      log(emit, session, `Found ${entity.name}`);
      stats(emit, session);
      if (stagger) await sleep(stagger);
    }

    const remapped: Relationship[] = [];
    for (const rel of extracted.relationships) {
      const source = remapId(rel.source, resolved.merges);
      const target = remapId(rel.target, resolved.merges);
      if (!session.entities.has(source) || !session.entities.has(target)) continue;
      if (source === target) continue;
      remapped.push({
        ...rel,
        id: `${source}__${rel.type}__${target}`,
        source,
        target,
      });
    }

    const uniqueRels = dedupeRelationships(remapped).filter(
      (rel) => !session.relationships.has(rel.id),
    );
    log(emit, session, `Extracted ${uniqueRels.length} candidate claims`);

    for (const relationship of uniqueRels) {
      addRelationship(session, relationship);
      const event = { type: "relationship" as const, relationship };
      rememberEvent(session, event);
      emit(event);
      if (stagger) await sleep(Math.max(40, stagger - 40));
    }
    stats(emit, session);

    if (uniqueRels.length === 0) {
      log(emit, session, extending ? "No new claims to add" : "Graph updated");
      return complete(session, emit);
    }

    log(
      emit,
      session,
      extending && !allowNewEntities
        ? "Validating new links between existing entities with Jev"
        : "Validating relationships with Jev",
    );
    const excerpts = new Map(
      uniqueRels.map((rel) => [rel.id, evidenceExcerpt(rel, documents)]),
    );
    const batches = chunk(uniqueRels, 4);
    const classifiedBatches = await Promise.all(
      batches.map((batch) =>
        classifyClaims(
          batch.map((rel) => ({
            id: rel.id,
            claim: rel.claim,
            evidence: excerpts.get(rel.id) || rel.claim,
            sourceUrl: rel.sourceUrl,
          })),
        ),
      ),
    );

    const mockBatch = classifiedBatches.find((item) => item.usedMockFallback);
    if (mockBatch) {
      session.jevStatus = "mock";
      const status = {
        type: "jev_status" as const,
        status: "mock" as const,
        reason: mockBatch.error,
      };
      rememberEvent(session, status);
      emit(status);
      log(
        emit,
        session,
        `Jev unavailable — using demo validation${mockBatch.error ? `: ${mockBatch.error}` : ""}`,
      );
    } else if (classifiedBatches.some((item) => item.result.model === "jev")) {
      session.jevStatus = "jev";
    }

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      const classified = classifiedBatches[batchIndex];

      for (const rel of batch) {
        const validation =
          classified.result.model === "mock" && DEMO_VALIDATIONS[rel.id]
            ? DEMO_VALIDATIONS[rel.id]
            : toValidation(classified.result, rel.id);
        session.validations.set(rel.id, validation);
        const event = {
          type: "validation" as const,
          relationshipId: rel.id,
          validation,
        };
        rememberEvent(session, event);
        emit(event);

        const from = session.entities.get(rel.source)?.name ?? rel.source;
        const to = session.entities.get(rel.target)?.name ?? rel.target;
        log(emit, session, `${from} → ${to}    ${validation.decision}`);

        const sources =
          runtime.mode === "demo"
            ? sourcesForRelationship(rel)
            : sourcesForUrls([rel.sourceUrl], session.sources);

        const record = {
          relationshipId: rel.id,
          claim: rel.claim,
          snippet: excerpts.get(rel.id) || sources[0]?.snippet || rel.claim,
          sources,
          validation,
        };
        addEvidence(session, record);
        const evidenceEvent = { type: "evidence" as const, record };
        rememberEvent(session, evidenceEvent);
        emit(evidenceEvent);
        if (stagger) await sleep(stagger);
      }
    }

    stats(emit, session);
    log(emit, session, "Graph updated");
    return complete(session, emit);
  } catch (error) {
    session.status = "error";
    const message = error instanceof Error ? error.message : "Research failed";
    const event = { type: "error" as const, message };
    rememberEvent(session, event);
    emit(event);
    return session;
  }
}

function requiredUserId(userId: string | undefined): string {
  if (!userId) throw new Error("Sign in required");
  return userId;
}

function resumeOrThrow(sessionId: string, query: string): SessionRecord {
  const session = resumeSession(sessionId, query) ?? getSession(sessionId);
  if (!session) {
    throw new Error("Research session not found");
  }
  return session;
}

function complete(session: SessionRecord, emit: Emit): SessionRecord {
  session.status = "complete";
  const event = { type: "complete" as const, sessionId: session.id };
  rememberEvent(session, event);
  emit(event);
  return session;
}

function rankExisting(query: string, entities: Entity[]): Entity[] {
  const ranked = rankKnownEntities(
    query,
    entities.map((entity) => ({
      id: entity.id,
      name: entity.name,
      type: entity.type,
    })),
  );
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  return ranked.flatMap((item) => {
    const entity = byId.get(item.id);
    return entity ? [entity] : [];
  });
}

function mentionMap(relationships: Relationship[]): Map<string, string> {
  const mentions = new Map<string, string>();
  for (const rel of relationships) {
    const claim = rel.claim.trim();
    if (!claim) continue;
    if (!mentions.has(rel.source)) mentions.set(rel.source, claim);
    if (!mentions.has(rel.target)) mentions.set(rel.target, claim);
  }
  return mentions;
}

function dedupeRelationships(rels: Relationship[]): Relationship[] {
  const map = new Map<string, Relationship>();
  for (const rel of rels) map.set(rel.id, rel);
  return [...map.values()];
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
