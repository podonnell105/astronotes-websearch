import { detectRuntime, nowStamp } from "./config";
import { DEMO_QUERY, DEMO_VALIDATIONS, sourcesForRelationship } from "./demo";
import { addEvidence, sourcesForClaim } from "./evidence";
import { remapId, resolveEntities } from "./entities";
import {
  attachNewEntities,
  evidenceExcerpt,
  extractKnowledge,
  groundRelationships,
  recitesBetterEvidence,
  type Extraction,
} from "./extraction";
import { addEntity, addRelationship } from "./graph";
import { classifyClaims, toValidation } from "./jev";
import { fetchPrimaryRecords, harvestOrgNames } from "./primarySources";
import { filterRelevantResults } from "./relevance";
import {
  fetchRelevantPages,
  mergeSearchOutcomes,
  nameOnlySearchQuery,
  rankKnownEntities,
  searchWeb,
  type Document,
} from "./search";
import { emptySourcePolicy, hostIsDenied, mergeDropped, normalizeSourcePolicy, summarizeDropped } from "./sources";
import { buildNeighborhood, planResearch } from "./researchPlan";
import {
  createSession,
  getSession,
  persistSession,
  rememberEvent,
  resumeSession,
  type SessionRecord,
} from "./store";
import type { DroppedSource, Emit, Entity, Relationship, SearchResult, SourcePolicy } from "./types";

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
  options?: { preferExistingLinks?: boolean; userId?: string; sourcePolicy?: SourcePolicy },
): Promise<SessionRecord> {
  const runtime = detectRuntime();
  const nextQuery = query.trim() || DEMO_QUERY;
  const incomingPolicy = options?.sourcePolicy
    ? normalizeSourcePolicy(options.sourcePolicy)
    : undefined;
  const session = sessionId
    ? await resumeOrThrow(sessionId, nextQuery)
    : await createSession(
        requiredUserId(options?.userId),
        nextQuery,
        runtime.mode,
        incomingPolicy ?? emptySourcePolicy(),
      );
  if (incomingPolicy) {
    session.sourcePolicy = incomingPolicy;
    await persistSession(session);
  }
  const policy = session.sourcePolicy;
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
    const knownEntities = rankKnownEntities(
      nextQuery,
      existingEntities.map((entity) => ({
        id: entity.id,
        name: entity.name,
        type: entity.type,
      })),
    );

    let allowNewEntities = !preferExistingLinks;
    let gaps: string[] = [];
    let subjects: string[] = [];
    if (extending) log(emit, session, "Extending the graph...");
    const neighborhood = extending
      ? buildNeighborhood(nextQuery, existingEntities, existingRelationships)
      : [];
    const plan = await planResearch(nextQuery, neighborhood, preferExistingLinks);
    allowNewEntities = plan.allowNewEntities;
    gaps = plan.gaps;
    subjects = plan.subjects;
    const searchQueries = plan.queries.length ? plan.queries : [plan.searchQuery];
    if (searchQueries.length > 1) {
      log(emit, session, `Planned ${searchQueries.length} focused searches`);
    }
    for (const query of searchQueries) {
      log(emit, session, `Searching for: ${query}`);
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

    const runSearch = (q: string, broaden = false) =>
      searchWeb(q, {
        knownEntities: extending ? knownEntities.slice(0, 3) : undefined,
        excludeUrls: session.sources.map((source) => source.url),
        gaps: gaps.length ? gaps : undefined,
        broaden,
        policy,
      });

    let { results, provider, dropped, recovered } = mergeSearchOutcomes(
      await Promise.all(searchQueries.map((query) => runSearch(query))),
    );
    recordDropped(session, emit, dropped);
    const relevant = filterRelevantResults(results, subjects);
    if (relevant.dropped.length > 0 && relevant.results.length > 0) {
      recordDropped(session, emit, relevant.dropped);
      results = relevant.results;
      log(emit, session, `Kept ${results.length} sources about ${subjects[0] || "the subject"}`);
    }
    if (results.length === 0 && !extending && !policy.onlyUrls.length) {
      log(emit, session, "No sources — broadening search");
      const fallbackQuery = subjects[0]
        ? `"${subjects[0]}"`
        : nameOnlySearchQuery(nextQuery);
      ({ results, provider, dropped, recovered } = await runSearch(fallbackQuery, true));
      recordDropped(session, emit, dropped);
    }
    if (recovered) {
      log(emit, session, "Few sources — merged OpenAI web search");
    } else if (runtime.search === "tavily" && provider === "openai") {
      log(emit, session, "Tavily unavailable — using OpenAI web search");
    }

    // Structured lookup runs beside page fetches so catalog time is hidden.
    let primaryDocs: Document[] = [];
    const wantPrimary =
      runtime.search !== "mock" &&
      !policy.onlyUrls.length &&
      policy.dataSources.length > 0;
    const hintNames = harvestOrgNames(results);
    const primaryPromise = wantPrimary
      ? fetchPrimaryRecords({
          query: nextQuery,
          knownEntities,
          hintNames,
          excludeUrls: [
            ...session.sources.map((source) => source.url),
            ...results.map((result) => result.url),
          ],
          policy,
        })
      : Promise.resolve({ documents: [] as Document[], dropped: [], skipped: [] as string[] });

    if (wantPrimary) log(emit, session, "Looking up structured records...");

    if (results.length === 0 && !wantPrimary) {
      log(emit, session, "No new sources to add");
      stats(emit, session);
      return complete(session, emit);
    }

    log(emit, session, "Reading relevant pages...");
    let documents: Document[] = [];
    if (runtime.search === "mock") {
      documents = results.map((result) => ({ ...result, text: result.snippet }));
      await addSources(session, emit, documents, stagger);
    } else {
      const [primary, fetched] = await Promise.all([
        primaryPromise,
        results.length > 0
          ? fetchRelevantPages(results)
          : Promise.resolve({ documents: [] as Document[], failed: [] }),
      ]);
      recordDropped(session, emit, primary.dropped);
      for (const message of primary.skipped) log(emit, session, message);
      primaryDocs = primary.documents;
      if (primaryDocs.length > 0) {
        const hosts = [...new Set(primaryDocs.map((doc) => doc.source).filter(Boolean))];
        log(
          emit,
          session,
          `Attached ${primaryDocs.length} primary records (${hosts.join(" / ") || "catalog"})`,
        );
      }
      recordFailedFetches(session, emit, fetched.failed);
      const webDocs = usableDocuments(fetched.documents, fetched.failed);
      await addSources(session, emit, primaryDocs, stagger);
      await addSources(session, emit, webDocs, stagger);
      documents = [...primaryDocs, ...webDocs];
    }

    if (results.length === 0 && primaryDocs.length === 0) {
      log(emit, session, "No new sources to add");
      stats(emit, session);
      return complete(session, emit);
    }

    log(emit, session, `Found ${session.sources.length} sources`);

    log(emit, session, "Extracting entities and claims...");
    let extracted = await extractFromDocuments(
      nextQuery,
      documents,
      existingEntities,
      existingRelationships,
      {
        preferExistingLinks: extending && !allowNewEntities,
        allowNewEntities: extending ? allowNewEntities : undefined,
        gaps,
        subjects,
      },
      runtime.search !== "mock" ? (message) => log(emit, session, message) : undefined,
    );
    if (extending && existingEntities.length > 0) {
      extracted = attachNewEntities(
        extracted,
        rankExisting(nextQuery, existingEntities),
        documents,
      );
    }

    if (
      !extending &&
      extracted.relationships.length === 0 &&
      runtime.search !== "mock"
    ) {
      log(emit, session, "No claims from first sources — broadening search");
      const more = await runSearch(
        subjects[0] ? `"${subjects[0]}"` : nameOnlySearchQuery(nextQuery),
        true,
      );
      recordDropped(session, emit, more.dropped);
      if (more.recovered) {
        log(emit, session, "Few sources — merged OpenAI web search");
      }
      if (more.results.length > 0) {
        const extraRelevant = filterRelevantResults(more.results, subjects);
        if (extraRelevant.dropped.length > 0 && extraRelevant.results.length > 0) {
          recordDropped(session, emit, extraRelevant.dropped);
          more.results = extraRelevant.results;
        }
        const extra = await fetchRelevantPages(more.results);
        recordFailedFetches(session, emit, extra.failed);
        const extraDocs = usableDocuments(extra.documents, extra.failed);
        await addSources(session, emit, extraDocs, stagger);
        log(emit, session, `Found ${extraDocs.length} sources`);
        documents = [...documents, ...extraDocs];
        extracted = await extractFromDocuments(
          nextQuery,
          documents,
          existingEntities,
          existingRelationships,
          {
            preferExistingLinks: false,
            allowNewEntities: true,
            gaps,
            subjects,
          },
          (message) => log(emit, session, message),
        );
      }
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
            status: rel.status,
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
            : sourcesForClaim(rel, from, to, session.sources, documents);

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

async function resumeOrThrow(sessionId: string, query: string): Promise<SessionRecord> {
  const session = (await resumeSession(sessionId, query)) ?? (await getSession(sessionId));
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

function recordDropped(
  session: SessionRecord,
  emit: Emit,
  dropped: DroppedSource[],
) {
  if (dropped.length === 0) return;
  session.droppedSources = mergeDropped(session.droppedSources, dropped);
  void persistSession(session);
  const message = summarizeDropped(dropped);
  if (message) log(emit, session, message);
  const event = {
    type: "dropped_sources" as const,
    policy: session.sourcePolicy,
    dropped: session.droppedSources,
  };
  rememberEvent(session, event);
  emit(event);
}

function recordFailedFetches(
  session: SessionRecord,
  emit: Emit,
  failed: SearchResult[],
) {
  const empty = failed.filter((item) => !item.snippet?.trim());
  if (empty.length === 0) return;
  recordDropped(
    session,
    emit,
    empty.map((item) => ({
      url: item.url,
      title: item.title,
      reason: "failed_fetch" as const,
    })),
  );
}

function usableDocuments(documents: Document[], failed: SearchResult[]): Document[] {
  const empty = new Set(
    failed.filter((item) => !item.snippet?.trim()).map((item) => item.url),
  );
  return documents.filter((doc) => !empty.has(doc.url));
}

async function addSources(
  session: SessionRecord,
  emit: Emit,
  results: Array<SearchResult & { text?: string }>,
  stagger: number,
) {
  for (const result of results) {
    const stored: SearchResult = {
      title: result.title,
      url: result.url,
      snippet: result.snippet,
      source: result.source,
      publishedAt: result.publishedAt,
    };
    if (hostIsDenied(stored.url, session.sourcePolicy.denyDomains)) continue;
    const existing = session.sources.find((source) => source.url === stored.url);
    if (existing) {
      if (!existing.publishedAt && stored.publishedAt) existing.publishedAt = stored.publishedAt;
      continue;
    }
    session.sources.push(stored);
    const event = { type: "source" as const, result: stored };
    rememberEvent(session, event);
    emit(event);
    log(emit, session, `Found ${result.source || result.title}`);
    stats(emit, session);
    if (stagger) await sleep(stagger);
  }
}

async function extractFromDocuments(
  query: string,
  documents: Document[],
  existingEntities: Entity[],
  existingRelationships: Relationship[],
  context: {
    preferExistingLinks?: boolean;
    allowNewEntities?: boolean;
    gaps?: string[];
    subjects?: string[];
  },
  onGroundedDrop?: (message: string) => void,
): Promise<Extraction> {
  const extracted = await extractKnowledge(query, documents, {
    existingEntities,
    existingRelationships: existingRelationships.map((rel) => ({
      source: rel.source,
      type: rel.type,
      target: rel.target,
    })),
    preferExistingLinks: context.preferExistingLinks,
    allowNewEntities: context.allowNewEntities,
    gaps: context.gaps,
    subjects: context.subjects,
  });
  if (!onGroundedDrop) {
    extracted.relationships = recitesBetterEvidence(
      extracted.relationships,
      [...existingEntities, ...extracted.entities],
      documents,
    );
    return extracted;
  }
  const before = extracted.relationships.length;
  extracted.relationships = groundRelationships(extracted.relationships, documents);
  if (extracted.relationships.length < before) {
    onGroundedDrop(
      `Dropped ${before - extracted.relationships.length} ungrounded claims`,
    );
  }
  extracted.relationships = recitesBetterEvidence(
    extracted.relationships,
    [...existingEntities, ...extracted.entities],
    documents,
  );
  return extracted;
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
