import type { Relationship, SearchResult } from "./types";
import type { SessionRecord } from "./store";
import type { EvidenceRecord } from "./types";
import { sourceTrust } from "./sourceQuality";

const SOURCE_CAP = 4;

export function addEvidence(session: SessionRecord, record: EvidenceRecord) {
  session.evidence.set(record.relationshipId, record);
}

export function sourcesForUrls(
  urls: (string | undefined)[],
  catalog: SearchResult[],
): SearchResult[] {
  const wanted = new Set(urls.filter((u): u is string => Boolean(u)));
  const matched = catalog.filter((s) => wanted.has(s.url));
  if (matched.length > 0) return matched;
  return catalog.slice(0, 3);
}

export function sourcesForClaim(
  rel: Relationship,
  sourceName: string,
  targetName: string,
  catalog: SearchResult[],
  documents: Array<SearchResult & { text?: string }> = [],
): SearchResult[] {
  const pool = mergeCatalog(catalog, documents);
  const byUrl = new Map(pool.map((item) => [item.url, item]));
  const picked: SearchResult[] = [];

  const primary = rel.sourceUrl ? byUrl.get(rel.sourceUrl) : undefined;
  if (primary) picked.push(primary);

  const extras = pool
    .filter((item) => item.url !== rel.sourceUrl)
    .filter((item) => matchesClaim(rel, sourceName, targetName, item))
    .sort(compareSources);

  for (const item of extras) {
    if (picked.some((row) => row.url === item.url)) continue;
    picked.push(item);
    if (picked.length >= SOURCE_CAP) break;
  }

  return picked;
}

function mergeCatalog(
  catalog: SearchResult[],
  documents: Array<SearchResult & { text?: string }>,
): Array<SearchResult & { text?: string }> {
  const found = new Map<string, SearchResult & { text?: string }>();
  for (const item of catalog) {
    if (!item.url) continue;
    found.set(item.url, item);
  }
  for (const item of documents) {
    if (!item.url) continue;
    const existing = found.get(item.url);
    if (!existing) {
      found.set(item.url, item);
      continue;
    }
    found.set(item.url, {
      ...existing,
      ...item,
      snippet: longer(item.snippet, existing.snippet),
      publishedAt: item.publishedAt || existing.publishedAt,
      text: longer(item.text ?? "", existing.text ?? "") || existing.text,
    });
  }
  return [...found.values()];
}

function matchesClaim(
  rel: Relationship,
  sourceName: string,
  targetName: string,
  item: SearchResult & { text?: string },
): boolean {
  const hay = `${item.title} ${item.snippet} ${item.text ?? ""}`.toLowerCase();
  const both = mentions(hay, sourceName) && mentions(hay, targetName);
  const overlap =
    overlaps(rel.claim, item.snippet) ||
    overlaps(rel.evidenceSnippet ?? "", item.snippet) ||
    overlaps(rel.claim, item.text ?? "");
  return both || overlap;
}

function mentions(hay: string, name: string): boolean {
  const needle = name.trim().toLowerCase();
  return needle.length >= 2 && hay.includes(needle);
}

function overlaps(left: string, right: string): boolean {
  const a = tokens(left);
  const b = tokens(right);
  if (a.size === 0 || b.size === 0) return false;
  let hits = 0;
  for (const token of a) if (b.has(token)) hits += 1;
  return hits >= Math.min(4, a.size);
}

function tokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 4),
  );
}

function compareSources(a: SearchResult, b: SearchResult): number {
  const trust = sourceTrust(b.url) - sourceTrust(a.url);
  if (trust !== 0) return trust;
  const aDate = a.publishedAt ? 0 : 1;
  const bDate = b.publishedAt ? 0 : 1;
  if (aDate !== bDate) return aDate - bDate;
  if (a.publishedAt && b.publishedAt && a.publishedAt !== b.publishedAt) {
    return b.publishedAt.localeCompare(a.publishedAt);
  }
  return (b.snippet?.length ?? 0) - (a.snippet?.length ?? 0);
}

function longer(a: string, b: string): string {
  return a.length >= b.length ? a : b;
}
