import { hostnameOf } from "./sources";
import { sourceTrust } from "./sourceQuality";
import type { DroppedSource, SearchResult } from "./types";

const WINDOW = 8;

const JURISDICTION_TERMS: Record<string, string[]> = {
  NI: [
    "northern ireland",
    "belfast",
    "stormont",
    "sinn fein",
    "sinn féin",
    "mla",
    "ni assembly",
    "mid ulster",
    "dungannon",
    "clonoe",
    "niassembly",
  ],
  GB: [
    "united kingdom",
    "westminster",
    "house of commons",
    "electoral commission",
    "parliament.uk",
  ],
  US: ["united states", "congress", "fec", "opensecrets", "senate", "house of representatives"],
  IE: ["oireachtas", "dail", "dáil", "dublin", "republic of ireland"],
  EU: ["european parliament", "mep", "brussels", "eu transparency", "europa.eu"],
};

const REGISTER_HOSTS: Record<string, string[]> = {
  NI: ["aims.niassembly.gov.uk", "niassembly.gov.uk", "electoralcommission.org.uk"],
  GB: ["electoralcommission.org.uk", "parliament.uk", "members.parliament.uk"],
  IE: ["oireachtas.ie", "lobbying.ie"],
  US: ["fec.gov", "senate.gov", "congress.gov"],
  EU: ["europarl.europa.eu", "europa.eu"],
};

const US_MONEY_HOSTS = [
  "opensecrets.org",
  "fec.gov",
  "followthemoney.org",
  "influencewatch.org",
  "causeiq.com",
  "justgiving.com",
];

export type RelevanceFilter = {
  subjects: string[];
  facetKeywords?: string[];
  jurisdictions?: string[];
};

export function filterRelevantResults(
  results: SearchResult[],
  subjectsOrFilter: string[] | RelevanceFilter,
): { results: SearchResult[]; dropped: DroppedSource[] } {
  const filter = Array.isArray(subjectsOrFilter)
    ? { subjects: subjectsOrFilter }
    : subjectsOrFilter;
  const subjects = filter.subjects;
  const strong = subjects.filter((name) => !isWeakSubject(name));
  if (strong.length === 0) return { results, dropped: [] };

  const kept: SearchResult[] = [];
  const dropped: DroppedSource[] = [];
  for (const result of results) {
    if (resultIsRelevant(result, filter)) {
      kept.push(result);
    } else {
      dropped.push({
        url: result.url,
        title: result.title,
        reason: "irrelevant",
      });
    }
  }

  if (kept.length === 0) {
    if ((filter.facetKeywords?.length ?? 0) > 0 || (filter.jurisdictions?.length ?? 0) > 0) {
      return { results: [], dropped };
    }
    return { results, dropped: [] };
  }
  return { results: kept, dropped };
}

export function resultMentionsSubject(
  result: SearchResult,
  subjects: string[],
): boolean {
  const fields = [result.title, result.snippet, result.url].filter(Boolean);
  const strong = subjects.filter((name) => !isWeakSubject(name));
  const weak = subjects.filter((name) => isWeakSubject(name));
  if (strong.some((subject) => fields.some((field) => fieldMentionsSubject(field, subject)))) {
    return true;
  }
  if (weak.length === 0) return false;
  const combined = fields.join(" ");
  return (
    weak.some((subject) => fieldMentionsSubject(combined, subject)) &&
    strong.some((subject) => looseSubjectHit(combined, subject))
  );
}

export const MIN_SCRAPE_SCORE = 8;

export type ScoredResult = SearchResult & { score: number };

export function scoreResult(result: SearchResult, filter: RelevanceFilter): number {
  if (!resultMentionsSubject(result, filter.subjects)) return 0;
  if (conflictsJurisdiction(result, filter.jurisdictions ?? [])) return 1;

  let score = 4;
  const keywords = (filter.facetKeywords ?? []).filter(Boolean);
  if (keywords.length === 0) score += 3;
  else if (mentionsAny(result, keywords)) score += 3;
  if (isRegisterHost(result, filter.jurisdictions ?? [])) score += 3;
  else if ((filter.jurisdictions?.length ?? 0) > 0 && mentionsJurisdiction(result, filter.jurisdictions ?? [])) {
    score += 1;
  }
  if (sourceTrust(result.url) >= 80) score += 1;
  return Math.min(10, score);
}

export function scoreResults(
  results: SearchResult[],
  filter: RelevanceFilter,
): ScoredResult[] {
  return results
    .map((result) => ({ ...result, score: scoreResult(result, filter) }))
    .sort((left, right) => right.score - left.score);
}

export function isWeakSubject(name: string): boolean {
  const tokens = name.trim().split(/\s+/);
  return tokens.length === 1 && tokens[0].length < 5;
}

function resultIsRelevant(result: SearchResult, filter: RelevanceFilter): boolean {
  if (!resultMentionsSubject(result, filter.subjects)) return false;
  if (conflictsJurisdiction(result, filter.jurisdictions ?? [])) return false;

  const facetKeywords = (filter.facetKeywords ?? []).filter(Boolean);
  const jurisdictions = filter.jurisdictions ?? [];
  const registerHost = isRegisterHost(result, jurisdictions);
  if (registerHost) return true;

  if (facetKeywords.length > 0 && !mentionsAny(result, facetKeywords)) return false;
  if (jurisdictions.length > 0 && !mentionsJurisdiction(result, jurisdictions)) return false;
  return true;
}

function conflictsJurisdiction(result: SearchResult, jurisdictions: string[]): boolean {
  const host = hostnameOf(result.url);
  const us = jurisdictions.includes("US");
  if (us) return false;
  if (US_MONEY_HOSTS.some((item) => host === item || host.endsWith(`.${item}`))) return true;
  if (isUsGovHost(host)) return true;
  return false;
}

function isUsGovHost(host: string): boolean {
  if (!host.endsWith(".gov")) return false;
  if (host.endsWith(".uk") || host.endsWith(".ie") || host.includes("niassembly")) return false;
  return true;
}

function isRegisterHost(result: SearchResult, jurisdictions: string[]): boolean {
  const host = hostnameOf(result.url);
  const keys = jurisdictions.length ? jurisdictions : Object.keys(REGISTER_HOSTS);
  for (const key of keys) {
    const hosts = REGISTER_HOSTS[key] ?? [];
    if (hosts.some((item) => host === item || host.endsWith(`.${item}`))) return true;
  }
  return false;
}

function mentionsJurisdiction(result: SearchResult, jurisdictions: string[]): boolean {
  const hay = `${result.title} ${result.snippet} ${result.url}`.toLowerCase();
  return jurisdictions.some((code) =>
    (JURISDICTION_TERMS[code] ?? [code.toLowerCase()]).some((term) => hay.includes(term)),
  );
}

function mentionsAny(result: SearchResult, keywords: string[]): boolean {
  const hay = `${result.title} ${result.snippet} ${result.url}`.toLowerCase();
  return keywords.some((keyword) => hay.includes(keyword.toLowerCase()));
}

function fieldMentionsSubject(text: string, subject: string): boolean {
  const hay = text.toLowerCase();
  const phrase = subject.trim().toLowerCase();
  if (!phrase || !hay) return false;
  if (hay.includes(phrase)) return true;
  if (urlMentionsSubject(text, phrase)) return true;

  const tokens = phrase.split(/[^a-z0-9]+/).filter((token) => token.length >= 3);
  if (tokens.length < 2) {
    return tokens.length === 1 && new RegExp(`\\b${escapeRegExp(tokens[0])}\\b`, "i").test(text);
  }
  return tokensInOrder(hay, tokens, WINDOW);
}

function looseSubjectHit(text: string, subject: string): boolean {
  const hay = text.toLowerCase();
  const tokens = subject
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4);
  return tokens.some((token) => hay.includes(token));
}

function urlMentionsSubject(text: string, subject: string): boolean {
  const compact = subject.replace(/[^a-z0-9]/g, "");
  if (compact.length < 6) return false;
  const urls = text.match(/https?:\/\/[^\s]+/gi) ?? [];
  return urls.some((url) => {
    try {
      const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase().replace(/[-.]/g, "");
      return host.includes(compact);
    } catch {
      return url.toLowerCase().replace(/[-./]/g, "").includes(compact);
    }
  });
}

function tokensInOrder(text: string, tokens: string[], window: number): boolean {
  const words = text.split(/[^a-z0-9]+/).filter(Boolean);
  let from = 0;
  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
    const token = tokens[tokenIndex];
    const start = tokenIndex === 0 ? 0 : from;
    const end =
      tokenIndex === 0 ? words.length : Math.min(words.length, from + window);
    let found = -1;
    for (let index = start; index < end; index++) {
      if (words[index] === token) {
        found = index;
        break;
      }
    }
    if (found === -1) return false;
    from = found + 1;
  }
  return true;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
