import type { DataSourceId } from "../dataCatalog";
import { inferOverlaps } from "../inference";
import { linkPoliticalGraph } from "./link";
import { personNameFromQuery, scanPersonNames } from "./names";
import { mergeEntity, mergeIdentifiers, registerValidation, ruleValidation } from "../ontology";
import { addEvidence } from "../evidence";
import { addRelationship, upsertEntity } from "../graph";
import type { SessionRecord } from "../store";
import type { Emit, Entity, SourcePolicy } from "../types";
import { lookupCompanyAssertions } from "./companies";
import { lookupEuroparl } from "./eu";
import { lookupOireachtas } from "./ie";
import { lookupDonationsAndLobbying } from "./money";
import { lookupProcurement } from "./procurement";
import type { PoliticalAdapterInput, PoliticalFragment, PoliticalSubject } from "./types";
import { emptyFragment, mergeFragments } from "./types";
import { lookupUkParliament } from "./uk";
import { lookupCongress } from "./us";
import { lookupWikidataPerson } from "./wikidata";

const POLITICAL_SOURCES = new Set<DataSourceId>([
  "uk_parliament",
  "uk_hansard",
  "uk_interests",
  "companies_house",
  "gleif",
  "electoral_commission",
  "contracts_finder",
  "oireachtas",
  "lobbying_ie",
  "congress_gov",
  "openfec",
  "senate_lda",
  "usaspending",
  "europarl",
  "eu_transparency",
  "ted",
]);

export function isPoliticalRun(policy: SourcePolicy): boolean {
  if (policy.role === "political") return true;
  return policy.dataSources.some((id) => POLITICAL_SOURCES.has(id));
}

export async function runPoliticalIngest(input: {
  query: string;
  policy: SourcePolicy;
  existing: Entity[];
}): Promise<PoliticalFragment> {
  const names = subjectNames(input.query, input.existing);
  const wiki = await lookupWikidataPerson(names[0] || input.query).catch(() => emptyFragment());
  const person = wiki.entities.find((entity) => entity.kind === "person") ??
    input.existing.find((entity) => entity.kind === "person" || entity.type === "person");
  const subject: PoliticalSubject = {
    query: input.query,
    person,
    names: unique([person?.name, ...names].filter((item): item is string => Boolean(item))),
  };
  const adapterInput: PoliticalAdapterInput = {
    query: input.query,
    subject,
    existing: input.existing,
    sources: input.policy.dataSources,
  };

  const enabled = new Set(input.policy.dataSources);
  const want = (id: DataSourceId) => enabled.size === 0 || enabled.has(id) || input.policy.role === "political";

  const parts: PoliticalFragment[] = [wiki];
  const tasks: Array<Promise<PoliticalFragment>> = [];
  if (want("uk_parliament") || want("uk_hansard") || want("uk_interests")) {
    tasks.push(safe("UK Parliament", () => lookupUkParliament(adapterInput)));
  }
  if (want("oireachtas")) tasks.push(safe("Oireachtas", () => lookupOireachtas(adapterInput)));
  if (want("congress_gov")) tasks.push(safe("Congress.gov", () => lookupCongress(adapterInput)));
  if (want("europarl")) tasks.push(safe("European Parliament", () => lookupEuroparl(adapterInput)));
  if (
    want("electoral_commission") ||
    want("openfec") ||
    want("senate_lda") ||
    want("eu_transparency") ||
    want("lobbying_ie")
  ) {
    tasks.push(safe("Donations and lobbying", () => lookupDonationsAndLobbying(adapterInput)));
  }

  const first = mergeFragments([...parts, ...(await Promise.all(tasks))]);
  const companyNames = companyHints(first);
  const companyParts: PoliticalFragment[] = [];
  if (companyNames.length && (want("companies_house") || want("gleif") || input.policy.role === "political")) {
    companyParts.push(await safe("Company registers", () => lookupCompanyAssertions(companyNames)));
  }
  if (companyNames.length && (want("contracts_finder") || want("ted") || want("usaspending") || input.policy.role === "political")) {
    companyParts.push(
      await safe("Procurement", () =>
        lookupProcurement({ ...adapterInput, subject: { ...subject, names: companyNames } }),
      ),
    );
  }

  const merged = mergeFragments([first, ...companyParts]);
  const { entities, remap } = collapseEntities(merged.entities);
  const relationships = merged.relationships.map((rel) => ({
    ...rel,
    source: remap.get(rel.source) ?? rel.source,
    target: remap.get(rel.target) ?? rel.target,
    id: rel.id,
  }));
  const remapped = relationships.map((rel) => ({
    ...rel,
    id: `${rel.source}__${rel.type}__${rel.target}${rel.id.split("__").slice(3).join("__") ? `__${rel.id.split("__").slice(3).join("__")}` : ""}`,
  }));
  const linked = linkPoliticalGraph(entities, remapped, input.query, {
    subjectName: subject.person?.name || personNameFromQuery(input.query),
  });
  const inferred = inferOverlaps(linked.entities, linked.relationships);
  const seen = new Set(linked.relationships.map((rel) => rel.id));
  return {
    entities: linked.entities,
    relationships: [...linked.relationships, ...inferred.filter((rel) => !seen.has(rel.id))],
    sources: merged.sources,
    skipped: merged.skipped,
  };
}

function subjectNames(query: string, existing: Entity[]): string[] {
  const fromExisting = existing
    .filter((entity) => entity.type === "person" || entity.kind === "person")
    .map((entity) => entity.name);
  const quoted = [...query.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  const names = unique([...quoted, ...scanPersonNames(query), ...fromExisting]);
  if (names.length === 0 && query.trim()) names.push(query.trim());
  return names.slice(0, 6);
}

function companyHints(fragment: PoliticalFragment): string[] {
  const names: string[] = [];
  for (const entity of fragment.entities) {
    if (entity.kind === "company" || entity.kind === "organization") names.push(entity.name);
  }
  for (const rel of fragment.relationships) {
    if (rel.type === "declared_interest" || rel.type === "donated_to" || rel.type === "lobbied_on") {
      const target = fragment.entities.find((entity) => entity.id === rel.target);
      const source = fragment.entities.find((entity) => entity.id === rel.source);
      if (target?.kind !== "person") names.push(target?.name ?? "");
      if (source?.kind !== "person") names.push(source?.name ?? "");
    }
  }
  return unique(names.filter((name) => name.trim().length >= 3)).slice(0, 8);
}

function collapseEntities(entities: Entity[]): { entities: Entity[]; remap: Map<string, string> } {
  const out: Entity[] = [];
  const remap = new Map<string, string>();
  for (const entity of entities) {
    const hit = out.find((known) => {
      const keys = new Set((known.identifiers ?? []).map((item) => `${item.scheme}:${item.value}`.toLowerCase()));
      return (entity.identifiers ?? []).some((item) => keys.has(`${item.scheme}:${item.value}`.toLowerCase()));
    });
    if (hit) {
      const merged = mergeEntity(hit, { ...entity, id: hit.id });
      merged.identifiers = mergeIdentifiers(hit.identifiers, entity.identifiers);
      out[out.indexOf(hit)] = merged;
      remap.set(entity.id, hit.id);
      continue;
    }
    out.push(entity);
  }
  return { entities: out, remap };
}

async function safe(label: string, run: () => Promise<PoliticalFragment>): Promise<PoliticalFragment> {
  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed";
    return { ...emptyFragment(), skipped: [`${label} skipped (${message})`] };
  }
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value.trim());
  }
  return out;
}

export function applyPoliticalFragment(
  session: SessionRecord,
  fragment: PoliticalFragment,
  emit: Emit,
) {
  const knownIds = new Set(session.entities.keys());
  for (const incoming of fragment.entities) {
    const entity = upsertEntity(session, incoming);
    if (!knownIds.has(entity.id)) {
      knownIds.add(entity.id);
      emit({ type: "entity", entity });
    }
  }
  for (const source of fragment.sources) {
    if (session.sources.some((item) => item.url === source.url)) continue;
    session.sources.push(source);
    emit({ type: "source", result: source });
  }
  for (const relationship of fragment.relationships) {
    if (session.relationships.has(relationship.id)) continue;
    if (!session.entities.has(relationship.source) || !session.entities.has(relationship.target)) {
      continue;
    }
    if (relationship.source === relationship.target) continue;
    addRelationship(session, relationship);
    emit({ type: "relationship", relationship });
    const validation =
      relationship.basis === "inferred" ? ruleValidation() : registerValidation();
    session.validations.set(relationship.id, validation);
    emit({ type: "validation", relationshipId: relationship.id, validation });
    const record = {
      relationshipId: relationship.id,
      claim: relationship.claim,
      snippet: relationship.evidenceSnippet || relationship.claim,
      sources: fragment.sources.filter((item) => item.url === relationship.sourceUrl).slice(0, 4),
      validation,
    };
    if (record.sources.length === 0 && relationship.sourceUrl) {
      record.sources = [
        {
          title: relationship.claim,
          url: relationship.sourceUrl,
          snippet: relationship.evidenceSnippet || relationship.claim,
        },
      ];
    }
    addEvidence(session, record);
    emit({ type: "evidence", record });
  }
}
