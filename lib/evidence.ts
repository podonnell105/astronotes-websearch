import type { SessionRecord } from "./store";
import type { EvidenceRecord, SearchResult } from "./types";

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
