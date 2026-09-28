import { detectRuntime, isOpenAIAuthError, nowStamp } from "./config";
import { DEMO_QUERY, DEMO_VALIDATIONS, sourcesForRelationship } from "./demo";
import { addEvidence, sourcesForClaim } from "./evidence";
import { remapId, resolveEntities } from "./entities";
import {
  attachNewEntities,
  evidenceExcerpt,
  extractKnowledge,
  groundRelationships,
  mergeExtractions,
  recitesBetterEvidence,
  type Extraction,
} from "./extraction";
import { addEntity, addRelationship } from "./graph";
import { mergeEntity } from "./ontology";
import { classifyClaims, toValidation } from "./jev";
import { fetchPrimaryRecords, harvestOrgNames } from "./primarySources";
import { isPoliticalRun, runPoliticalIngest, applyPoliticalFragment } from "./political/run";
import { linkPoliticalGraph } from "./political/link";
import { filterRelevantResults, MIN_SCRAPE_SCORE, scoreResults } from "./relevance";
import {
  fetchPages,
  mergeSearchOutcomes,
  nameOnlySearchQuery,
  rankKnownEntities,
  searchWeb,
  type Document,
} from "./search";
import { inferAnalystRole, inferredSourceLabel } from "./queryPolicy";
import { emptySourcePolicy, hostIsDenied, mergeDropped, normalizeSourcePolicy, summarizeDropped } from "./sources";
import {
  buildNeighborhood,
  facetKeywords,
  facetRetryQueries,
  jurisdictionsFromEntities,
  planResearch,
  type ResearchPlan,
} from "./researchPlan";
import { compileResearchSpec } from "./research/spec";
import { coverFacets } from "./research/coverage";
import { catalogIdsFrom, isGraphSource, selectSources } from "./research/registry";
import { planIterationQueries } from "./research/planner";
import { applyKnowledge } from "./research/knowledge";
import {
  createSession,
  getSession,
  persistSession,
  rememberEvent,
  resumeSession,
  type SessionRecord,
} from "./store";
import type { DataSourceId } from "./dataCatalog";
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
  const existingForSpec = [...session.entities.values()];
  const existingRelsForSpec = [...session.relationships.values()];
  const spec = compileResearchSpec(nextQuery, {
    spec: session.spec,
    entities: existingForSpec,
    relationships: existingRelsForSpec,
  });
  session.spec = spec;
  const selectedSources = selectSources(spec);
  session.sourcePolicy = {
    ...session.sourcePolicy,
    role: inferAnalystRole(nextQuery),
    dataSources: catalogIdsFrom(selectedSources),
  };
  await persistSession(session);
  const policy = session.sourcePolicy;
  const extending = Boolean(sessionId);
  const preferExistingLinks = Boolean(options?.preferExistingLinks && extending);
  const stagger = runtime.mode === "demo" ? 140 : 0;
  const wantGraphAdapters = selectedSources.some((id) => isGraphSource(id));
  let ranPolitical = wantGraphAdapters;

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
  log(emit, session, `Research spec: ${spec.intent} · ${spec.subjects.map((item) => item.name).join(", ") || "subject"}`);
  log(
    emit,
    session,
    `Facets: ${spec.facets.slice(0, 8).join(", ")} · sources: ${selectedSources.slice(0, 8).join(", ")}`,
  );
  if (policy.role !== "custom") {
    log(emit, session, `${inferredSourceLabel(policy)} pack used as a source boost`);
  }

  try {
    let existingEntities = [...session.entities.values()];
    let existingRelationships = [...session.relationships.values()];
    let knownEntities = rankKnownEntities(
      nextQuery,
      existingEntities.map((entity) => ({
        id: entity.id,
        name: entity.name,
        type: entity.type,
      })),
    );

    if (wantGraphAdapters) {
      log(emit, session, "Looking up structured registers...");
      const fragment = await runPoliticalIngest({
        query: nextQuery,
        policy,
        existing: existingEntities,
      });
      for (const message of fragment.skipped) log(emit, session, message);
      const politicalEmit: Emit = (event) => {
        rememberEvent(session, event);
        emit(event);
      };
      applyPoliticalFragment(session, fragment, politicalEmit);
      ranPolitical = true;
      log(
        emit,
        session,
        `Recorded ${fragment.relationships.filter((rel) => rel.basis === "recorded").length} register facts · ${fragment.relationships.filter((rel) => rel.basis === "inferred").length} possible overlaps`,
      );
      stats(emit, session);
      existingEntities = [...session.entities.values()];
      existingRelationships = [...session.relationships.values()];
      knownEntities = rankKnownEntities(
        nextQuery,
        existingEntities.map((entity) => ({
          id: entity.id,
          name: entity.name,
          type: entity.type,
        })),
      );
    }

    let allowNewEntities = !preferExistingLinks;
    let gaps: string[] = [];
    let subjects: string[] = [];
    if (extending) log(emit, session, "Extending the graph...");
    const neighborhood = extending
      ? buildNeighborhood(nextQuery, existingEntities, existingRelationships)
      : [];
    const plan = await planResearch(nextQuery, neighborhood, preferExistingLinks, spec);
    allowNewEntities = plan.allowNewEntities;
    gaps = plan.gaps;
    subjects = plan.subjects;
    const specQueries = planIterationQueries({
      spec,
      entities: existingEntities,
      relationships: existingRelationships,
      missing: spec.facets,
      iteration: 1,
    });
    const searchQueries = (specQueries.length ? specQueries : plan.queries.length ? plan.queries : [plan.searchQuery])
      .slice(0, spec.budgets.maxQueries);
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
    const relevant = filterRelevantResults(
      results,
      relevanceFilter(plan, existingEntities),
    );
    if (relevant.dropped.length > 0) {
      recordDropped(session, emit, relevant.dropped);
      if (relevant.results.length > 0) {
        results = relevant.results;
        log(emit, session, `Kept ${results.length} sources about ${subjects[0] || "the subject"}`);
      } else if (plan.facets.length > 0) {
        results = [];
        log(emit, session, `Dropped sources that were not about ${plan.facets.join(", ")}`);
      }
    }
    if (results.length === 0 && !extending && !policy.onlyUrls.length) {
      if (plan.facets.includes("donations")) {
        log(emit, session, "No donor sources — searching registers");
        const retryQueries = facetRetryQueries(plan);
        for (const query of retryQueries) log(emit, session, `Searching for: ${query}`);
        ({ results, provider, dropped, recovered } = mergeSearchOutcomes(
          await Promise.all(retryQueries.map((query) => runSearch(query))),
        ));
      } else {
        log(emit, session, "No sources — broadening search");
        const fallbackQuery = subjects[0]
          ? `"${subjects[0]}"`
          : nameOnlySearchQuery(nextQuery);
        ({ results, provider, dropped, recovered } = await runSearch(fallbackQuery, true));
      }
      recordDropped(session, emit, dropped);
      const retryRelevant = filterRelevantResults(
        results,
        relevanceFilter(plan, existingEntities),
      );
      if (retryRelevant.dropped.length > 0 && retryRelevant.results.length > 0) {
        recordDropped(session, emit, retryRelevant.dropped);
        results = retryRelevant.results;
      }
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

    if (results.length === 0 && !wantPrimary && runtime.search === "mock") {
      log(emit, session, "No new sources to add");
      stats(emit, session);
      return complete(session, emit);
    }

    let documents: Document[] = [];
    let extracted: Extraction = { entities: [], relationships: [] };

    if (runtime.search === "mock") {
      log(emit, session, "Reading relevant pages...");
      documents = results.map((result) => ({ ...result, text: result.snippet }));
      await addSources(session, emit, documents, stagger);
      log(emit, session, `Found ${session.sources.length} sources`);
      log(emit, session, "Extracting entities and claims...");
      extracted = await extractFromDocuments(
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
      );
    } else {
      const primary = await primaryPromise;
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
      await addSources(session, emit, primaryDocs, stagger);
      documents = [...primaryDocs];

      let pool = results;
      const fetchedUrls = new Set(session.sources.map((source) => source.url));

      const maxTries = spec.budgets.maxIterations;
      const pagesPerTry = spec.budgets.maxPages;

      for (let attempt = 1; attempt <= maxTries; attempt++) {
        existingEntities = [...session.entities.values()];
        existingRelationships = [...session.relationships.values()];
        const specCoverage = coverFacets({
          spec,
          entities: [...existingEntities, ...extracted.entities],
          relationships: [...existingRelationships, ...extracted.relationships],
        });
        const missingLabel = specCoverage.priorityGap
          ? specCoverage.facets.find((item) => item.facet === specCoverage.priorityGap)?.gap
          : "";
        log(
          emit,
          session,
          `Try ${attempt}/${maxTries} — ${specCoverage.facets
            .filter((item) => item.status !== "not_applicable")
            .map((item) => `${item.facet} ${item.status}`)
            .slice(0, 6)
            .join(" · ")}${missingLabel ? ` · gap: ${missingLabel}` : ""}`,
        );

        if (specCoverage.answered) {
          log(emit, session, "Priority facets covered");
          break;
        }

        if (specCoverage.missing.includes("donations") && !ranPolitical) {
          await applyDonorRegisters(session, emit, nextQuery, policy, [
            ...existingEntities,
            ...extracted.entities,
          ]);
          ranPolitical = true;
          existingEntities = [...session.entities.values()];
          existingRelationships = [...session.relationships.values()];
        }

        if (attempt > 1 && specCoverage.missing.length > 0) {
          const followQueries = planIterationQueries({
            spec,
            entities: [...existingEntities, ...extracted.entities],
            relationships: [...existingRelationships, ...extracted.relationships],
            missing: specCoverage.missing,
            iteration: attempt,
          });
          if (followQueries.length > 0) {
            log(emit, session, `Following the graph: ${followQueries.join(" · ")}`);
            const more = mergeSearchOutcomes(
              await Promise.all(followQueries.map((query) => runSearch(query))),
            );
            recordDropped(session, emit, more.dropped);
            pool = mergeUniqueResults(pool, more.results);
          }
        }

        const filter = relevanceFilter(plan, [...existingEntities, ...extracted.entities]);
        let batch = scoreResults(pool, filter)
          .filter((item) => item.score >= MIN_SCRAPE_SCORE && !fetchedUrls.has(item.url))
          .slice(0, pagesPerTry);

        if (batch.length === 0 && !extending && !policy.onlyUrls.length) {
          log(
            emit,
            session,
            `No pages above ${MIN_SCRAPE_SCORE - 1} — searching again for ${specCoverage.priorityGap ?? "gaps"}`,
          );
          const retryQueries = specCoverage.missing.includes("donations")
            ? facetRetryQueries(plan)
            : planIterationQueries({
                spec,
                entities: [...existingEntities, ...extracted.entities],
                relationships: [...existingRelationships, ...extracted.relationships],
                missing: specCoverage.missing,
                iteration: attempt,
              });
          const fallbackQueries = retryQueries.length
            ? retryQueries
            : [subjects[0] ? `"${subjects[0]}"` : nameOnlySearchQuery(nextQuery)];
          for (const query of fallbackQueries) log(emit, session, `Searching for: ${query}`);
          const more = mergeSearchOutcomes(
            await Promise.all(
              fallbackQueries.map((query) =>
                runSearch(query, !specCoverage.missing.includes("donations")),
              ),
            ),
          );
          recordDropped(session, emit, more.dropped);
          const extraRelevant = filterRelevantResults(more.results, filter);
          if (extraRelevant.dropped.length > 0) {
            recordDropped(session, emit, extraRelevant.dropped);
          }
          pool = mergeUniqueResults(pool, extraRelevant.results);
          batch = scoreResults(pool, filter)
            .filter((item) => item.score >= MIN_SCRAPE_SCORE && !fetchedUrls.has(item.url))
            .slice(0, pagesPerTry);
        }

        if (batch.length === 0) {
          if (attempt === maxTries) {
            log(
              emit,
              session,
              `Still missing ${specCoverage.priorityGap ?? "facts"} after ${maxTries} tries`,
            );
          }
          continue;
        }

        log(
          emit,
          session,
          `Scraping ${batch.length} pages for ${specCoverage.priorityGap ?? spec.subjects[0]?.name ?? "the subject"} (score > ${MIN_SCRAPE_SCORE - 1})`,
        );
        for (const item of batch) {
          log(emit, session, `  ${item.score}/10 ${item.title}`);
          fetchedUrls.add(item.url);
        }

        const fetched = await fetchPages(batch);
        recordFailedFetches(session, emit, fetched.failed);
        const webDocs = usableDocuments(fetched.documents, fetched.failed);
        await addSources(session, emit, webDocs, stagger);
        documents = [...documents, ...webDocs];
        log(emit, session, `Found ${session.sources.length} sources`);
        log(emit, session, "Extracting entities and claims...");
        const nextExtract = await extractFromDocuments(
          nextQuery,
          webDocs,
          [...existingEntities, ...extracted.entities],
          [...existingRelationships, ...extracted.relationships],
          {
            preferExistingLinks: extending && !allowNewEntities,
            allowNewEntities: extending ? allowNewEntities : true,
            gaps,
            subjects,
          },
          (message) => log(emit, session, message),
        );
        extracted = mergeExtractions([extracted, nextExtract]);
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
      const from = extracted.entities.find((entity) => entity.id === merge.from);
      const into = session.entities.get(merge.into);
      if (from && into) {
        session.entities.set(into.id, mergeEntity(into, { ...from, id: into.id }));
      }
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
        basis: rel.basis ?? "extracted",
      });
    }

    const uniqueRels = dedupeRelationships(remapped).filter(
      (rel) => !session.relationships.has(rel.id),
    );
    const toValidate = uniqueRels.filter((rel) => (rel.basis ?? "extracted") === "extracted");
    log(emit, session, `Extracted ${uniqueRels.length} candidate claims`);

    for (const relationship of uniqueRels) {
      addRelationship(session, relationship);
      const event = { type: "relationship" as const, relationship };
      rememberEvent(session, event);
      emit(event);
      if (stagger) await sleep(Math.max(40, stagger - 40));
    }
    stats(emit, session);

    const settled = coverFacets({
      spec,
      entities: [...session.entities.values()],
      relationships: [...session.relationships.values()],
    });
    if (!settled.answered) {
      log(
        emit,
        session,
        `Remaining gaps: ${settled.missing.join(", ") || "none"} · legacy ${settled.legacyScore}/10`,
      );
    }

    if (uniqueRels.length === 0) {
      log(emit, session, extending ? "No new claims to add" : "Graph updated");
      return complete(session, emit);
    }

    if (toValidate.length === 0) {
      log(emit, session, "Graph updated");
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
      toValidate.map((rel) => [rel.id, evidenceExcerpt(rel, documents)]),
    );
    const batches = chunk(toValidate, 4);
    const classifiedBatches = await Promise.all(
      batches.map((batch) =>
        classifyClaims(
          batch.map((rel) => ({
            id: rel.id,
            claim: rel.claim,
            evidence: excerpts.get(rel.id) || rel.claim,
            sourceUrl: rel.sourceUrl,
            status: rel.status,
            time: rel.time,
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
  if (isPoliticalRun(session.sourcePolicy)) settlePoliticalGraph(session, emit);
  applySessionKnowledge(session);
  session.status = "complete";
  const event = { type: "complete" as const, sessionId: session.id };
  rememberEvent(session, event);
  emit(event);
  return session;
}

function applySessionKnowledge(session: SessionRecord) {
  for (const rel of session.relationships.values()) {
    session.relationships.set(
      rel.id,
      applyKnowledge(rel, session.validations.get(rel.id), session.evidence.get(rel.id)),
    );
  }
}

function settlePoliticalGraph(session: SessionRecord, emit: Emit) {
  const linked = linkPoliticalGraph(
    [...session.entities.values()],
    [...session.relationships.values()],
    session.query,
  );
  session.entities = new Map(linked.entities.map((entity) => [entity.id, entity]));
  session.relationships = new Map(linked.relationships.map((rel) => [rel.id, rel]));
  for (const id of [...session.validations.keys()]) {
    if (!session.relationships.has(id)) session.validations.delete(id);
  }
  for (const id of [...session.evidence.keys()]) {
    if (!session.relationships.has(id)) session.evidence.delete(id);
  }
  const graph = {
    type: "graph" as const,
    entities: linked.entities,
    relationships: linked.relationships,
  };
  rememberEvent(session, graph);
  emit(graph);
  if (linked.subjectName) {
    const money = linked.relationships.some(
      (rel) => rel.type === "lobbied_on" || rel.type === "donated_to",
    );
    if (money) {
      log(
        emit,
        session,
        linked.partyName
          ? `Linked lobbying and donations to ${linked.subjectName} or ${linked.partyName}`
          : `Linked lobbying and donations to ${linked.subjectName}`,
      );
    }
  }
  stats(emit, session);
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
  try {
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
  } catch (error) {
    if (isOpenAIAuthError(error) && (existingEntities.length > 0 || existingRelationships.length > 0)) {
      onGroundedDrop?.(
        "OpenAI API key expired — skipping news extraction. Register facts are kept. Create a new key at platform.openai.com and set OPENAI_API_KEY on Railway.",
      );
      return { entities: [], relationships: [] };
    }
    throw error;
  }
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

function relevanceFilter(plan: ResearchPlan, entities: Entity[]) {
  return {
    subjects: plan.subjects,
    facetKeywords: facetKeywords(plan.facets),
    jurisdictions: [
      ...plan.jurisdictions,
      ...jurisdictionsFromEntities(entities),
    ],
  };
}

function donorRegisterSources(existing: DataSourceId[]): DataSourceId[] {
  const extra: DataSourceId[] = ["ni_assembly", "electoral_commission"];
  const seen = new Set<DataSourceId>();
  const out: DataSourceId[] = [];
  for (const id of [...existing, ...extra]) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

async function applyDonorRegisters(
  session: SessionRecord,
  emit: Emit,
  query: string,
  policy: SourcePolicy,
  existing: Entity[],
) {
  log(emit, session, "Asked donor facet missing — looking up political registers");
  const fragment = await runPoliticalIngest({
    query,
    policy: {
      ...policy,
      dataSources: donorRegisterSources(policy.dataSources),
    },
    existing,
  });
  for (const message of fragment.skipped) log(emit, session, message);
  const politicalEmit: Emit = (event) => {
    rememberEvent(session, event);
    emit(event);
  };
  applyPoliticalFragment(session, fragment, politicalEmit);
  log(
    emit,
    session,
    `Recorded ${fragment.relationships.filter((rel) => rel.basis === "recorded").length} register facts · ${fragment.relationships.filter((rel) => rel.basis === "inferred").length} possible overlaps`,
  );
  stats(emit, session);
}

function mergeUniqueResults(current: SearchResult[], extra: SearchResult[]): SearchResult[] {
  const seen = new Set(current.map((item) => item.url));
  const out = [...current];
  for (const item of extra) {
    if (!item.url || seen.has(item.url)) continue;
    seen.add(item.url);
    out.push(item);
  }
  return out;
}
