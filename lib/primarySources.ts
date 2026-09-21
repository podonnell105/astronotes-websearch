import { dataSourceAvailability } from "./config";
import { DATA_CATALOG, isCatalogHost, type DataSourceId } from "./dataCatalog";
import { lookupEdgarFilings } from "./edgar";
import { lookupGithub } from "./github";
import { lookupGleif, lookupCompaniesHouse } from "./identity";
import { lookupNihReporter } from "./nih";
import { lookupOpenAlex } from "./openalex";
import { lookupPatents } from "./patents";
import { lookupSamOpportunities } from "./sam";
import { lookupOpenSanctions } from "./sanctions";
import { applySourcePolicy, emptySourcePolicy } from "./sources";
import type { Document, KnownEntity } from "./search";
import { entityMatchesQuery } from "./search";
import { lookupClinicalTrials } from "./trials";
import type { DroppedSource, SourcePolicy } from "./types";
import { lookupUsaSpendingAwards } from "./usaspending";
import { lookupWayback } from "./wayback";

const MAX_PRIMARY = 12;
const PER_SOURCE = 2;
const SKIP_LABEL: Record<string, string> = {
  COMPANIES_HOUSE_API_KEY: "Companies House skipped (no API key)",
  PATENTSVIEW_API_KEY: "PatentsView skipped (no API key)",
  SAM_API_KEY: "SAM.gov skipped (no API key)",
  OPENSANCTIONS_API_KEY: "OpenSanctions skipped (no API key)",
};

const AGENCY_SKIP = new Set([
  "nasa",
  "esa",
  "noaa",
  "darpa",
  "dod",
  "doe",
  "dhs",
  "usa",
  "us",
  "uk",
  "eu",
  "un",
  "nato",
  "pentagon",
  "congress",
  "white",
  "house",
  "department",
  "agency",
  "administration",
  "federal",
  "national",
  "space",
  "force",
  "army",
  "navy",
  "air",
  "how",
  "what",
  "which",
  "who",
  "when",
  "where",
  "why",
  "public",
  "evidence",
  "relationship",
  "relationships",
]);

export type PrimarySourceOutcome = {
  documents: Document[];
  dropped: DroppedSource[];
  skipped: string[];
};

type Lookup = (names: string[], excludeUrls: string[]) => Promise<Document[]>;

const LOOKUPS: Record<DataSourceId, Lookup> = {
  edgar: (names, exclude) => lookupEdgarFilings(names, exclude),
  usaspending: (names, exclude) => lookupUsaSpendingAwards(names, exclude),
  gleif: (names) => lookupGleif(names),
  companies_house: (names) => lookupCompaniesHouse(names),
  github: (names) => lookupGithub(names),
  nih_reporter: (names) => lookupNihReporter(names),
  clinicaltrials: (names) => lookupClinicalTrials(names),
  openalex: (names) => lookupOpenAlex(names),
  opensanctions: (names) => lookupOpenSanctions(names),
  wayback: (names) => lookupWayback(names),
  patents: (names) => lookupPatents(names),
  sam: (names) => lookupSamOpportunities(names),
};

export async function fetchPrimaryRecords(input: {
  query: string;
  knownEntities?: KnownEntity[];
  hintNames?: string[];
  excludeUrls?: string[];
  policy?: SourcePolicy;
}): Promise<PrimarySourceOutcome> {
  const policy = input.policy ?? emptySourcePolicy();
  if (policy.onlyUrls.length) return { documents: [], dropped: [], skipped: [] };
  if (policy.dataSources.length === 0) {
    return { documents: [], dropped: [], skipped: [] };
  }

  const names = companyNamesFromQuery(
    input.query,
    input.knownEntities ?? [],
    input.hintNames ?? [],
  );
  if (names.length === 0) return { documents: [], dropped: [], skipped: [] };

  const enabled = policy.dataSources;
  const availability = dataSourceAvailability();
  const skipped: string[] = [];
  const runnable: DataSourceId[] = [];
  for (const id of enabled) {
    const def = DATA_CATALOG.find((item) => item.id === id);
    if (def?.needsEnv && !availability[id]) {
      skipped.push(SKIP_LABEL[def.needsEnv] ?? `${def.label} skipped (no API key)`);
      continue;
    }
    runnable.push(id);
  }

  const excludeUrls = input.excludeUrls ?? [];
  const batches = await Promise.all(
    runnable.map(async (id) => {
      try {
        const docs = await LOOKUPS[id](names, excludeUrls);
        return docs.slice(0, PER_SOURCE);
      } catch {
        return [] as Document[];
      }
    }),
  );

  const merged: Document[] = [];
  const seen = new Set(excludeUrls);
  for (const docs of batches) {
    for (const doc of docs) {
      if (merged.length >= MAX_PRIMARY) break;
      if (seen.has(doc.url)) continue;
      seen.add(doc.url);
      merged.push(doc);
    }
  }

  const filtered = applySourcePolicy(merged, policy);
  const keptUrls = new Set(filtered.results.map((item) => item.url));
  return {
    documents: merged.filter((doc) => keptUrls.has(doc.url)),
    dropped: filtered.dropped,
    skipped,
  };
}

export function companyNamesFromQuery(
  query: string,
  knownEntities: KnownEntity[] = [],
  hintNames: string[] = [],
): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const add = (value: string) => {
    const cleaned = value.replace(/[“”"']/g, "").replace(/\s+/g, " ").trim();
    const key = cleaned.toLowerCase();
    if (cleaned.length < 3 || seen.has(key)) return;
    if (shouldSkipName(cleaned)) return;
    seen.add(key);
    names.push(cleaned);
  };

  for (const match of query.matchAll(/["“]([^"”]{3,80})["”]/g)) add(match[1]);
  for (const phrase of capitalizedPhrases(query)) add(phrase);
  const titled = titleCasedSubject(query);
  if (titled) add(titled);
  for (const hint of hintNames) add(hint);
  for (const entity of knownEntities) {
    if (!isOrgType(entity.type)) continue;
    if (!entityMatchesQuery(query, entity.name) && names.length > 0) continue;
    add(entity.name);
  }

  names.sort((a, b) => {
    const org = orgishScore(b) - orgishScore(a);
    if (org !== 0) return org;
    const wordsA = a.split(" ").length;
    const wordsB = b.split(" ").length;
    if (wordsA !== wordsB) return wordsA - wordsB;
    return b.length - a.length;
  });
  return names.slice(0, 4);
}

export function harvestOrgNames(
  hits: Array<{ title?: string; snippet?: string }>,
): string[] {
  const blob = hits
    .map((hit) => `${hit.title ?? ""} ${hit.snippet ?? ""}`)
    .join(" \n ");
  const counted = new Map<string, { name: string; count: number }>();
  for (const phrase of capitalizedPhrases(blob)) {
    if (shouldSkipName(phrase)) continue;
    if (phrase.split(/\s+/).length > 5) continue;
    const key = phrase.toLowerCase();
    const prev = counted.get(key);
    if (prev) prev.count += 1;
    else counted.set(key, { name: phrase, count: 1 });
  }
  return [...counted.values()]
    .sort((a, b) => {
      const org = orgishScore(b.name) - orgishScore(a.name);
      if (org !== 0) return org;
      if (b.count !== a.count) return b.count - a.count;
      return b.name.length - a.name.length;
    })
    .slice(0, 6)
    .map((item) => item.name);
}

export function isPrimaryHost(url: string): boolean {
  return isCatalogHost(url);
}

function capitalizedPhrases(query: string): string[] {
  const tokens = query
    .replace(/[?!,;:()]+/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^["']+|["']+$/g, ""))
    .filter(Boolean);
  const phrases: string[] = [];
  let current: string[] = [];

  const flush = () => {
    if (current.length === 0) return;
    if (current.length >= 2) phrases.push(current.join(" "));
    for (const token of current) {
      if (isDistinctiveName(token)) phrases.push(token);
    }
    current = [];
  };

  for (const token of tokens) {
    if (/^[A-Z][A-Za-z0-9&.-]*$/.test(token) && !shouldSkipName(token)) {
      current.push(token.replace(/[&.-]+$/g, ""));
    } else {
      flush();
    }
  }
  flush();
  return phrases;
}

function isDistinctiveName(token: string): boolean {
  if (token.length >= 6) return true;
  return /[a-z]/.test(token.slice(1)) && token.length >= 4;
}

function shouldSkipName(value: string): boolean {
  const tokens = value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.every(
    (token) => AGENCY_SKIP.has(token) || GENERIC_NAME.has(token) || token.length < 3,
  );
}

function isOrgType(type: string): boolean {
  return ["company", "organization", "org", "corporation"].includes(type.toLowerCase());
}

const QUERY_STOP = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "do",
  "does",
  "did",
  "for",
  "from",
  "how",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "to",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "he",
  "she",
  "him",
  "his",
  "her",
  "they",
  "involved",
  "involvement",
  "setup",
]);

const GENERIC_NAME = new Set([
  "plan",
  "master",
  "news",
  "biography",
  "facts",
  "research",
  "starters",
  "profile",
  "team",
  "home",
  "opinion",
  "power",
  "secretive",
  "dialog",
  "society",
]);

const ORG_MARKERS = new Set([
  "fund",
  "technologies",
  "technology",
  "capital",
  "llc",
  "inc",
  "corp",
  "corporation",
  "university",
  "institute",
  "foundation",
  "fellowship",
  "paypal",
  "facebook",
  "spacex",
  "palantir",
]);

function titleCasedSubject(query: string): string | null {
  const words = query
    .replace(/[?!,;:()]+/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^["']+|["']+$/g, ""))
    .filter(Boolean);
  if (
    words.some(
      (word) => /[A-Z]/.test(word.charAt(0)) && word.length > 1 && /[a-z]/.test(word),
    )
  ) {
    return null;
  }
  const kept = words.filter((word) => {
    const key = word.toLowerCase();
    return key.length >= 2 && !QUERY_STOP.has(key) && !AGENCY_SKIP.has(key);
  });
  if (kept.length < 2 || kept.length > 4) return null;
  return kept
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function orgishScore(name: string): number {
  const tokens = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.some((token) => ORG_MARKERS.has(token))) return 6;
  if (tokens.length === 1 && name.length >= 4) return 3;
  return 0;
}
