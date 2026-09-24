import { formatEpisodeTime } from "./timeline";
import type {
  Entity,
  EpisodeTime,
  EvidenceRecord,
  Relationship,
  RelationshipStatus,
  SearchResult,
  SessionView,
  Validation,
} from "./types";
import { normalizeRelationshipStatus } from "./types";

export type DecisionFilter = "ALL" | "CONTRADICTED" | "UNCERTAIN" | "PENDING" | "SUPPORTED";
export type StatusFilter = "ALL" | RelationshipStatus;

export type ClaimRow = {
  relationshipId: string;
  sourceId: string;
  targetId: string;
  sourceName: string;
  targetName: string;
  type: string;
  claim: string;
  status: RelationshipStatus;
  decision: string;
  confidence?: number;
  model: "jev" | "mock";
  snippet: string;
  url?: string;
  extraUrls: string[];
  sourceCount: number;
  publishedAt?: string;
  time?: EpisodeTime;
  when: string;
};

const RANK: Record<string, number> = {
  CONTRADICTED: 0,
  UNCERTAIN: 1,
  PENDING: 2,
  SUPPORTED: 3,
};

export function normalizeDecision(value: string | undefined): string {
  const raw = (value ?? "PENDING").toUpperCase();
  if (raw === "SUPPORTED" || raw === "CONTRADICTED" || raw === "UNCERTAIN") return raw;
  if (raw === "PENDING") return "PENDING";
  return raw || "PENDING";
}

export function buildClaimRows(view: {
  entities: Entity[];
  relationships: Relationship[];
  validations: Record<string, Validation>;
  evidence: Record<string, EvidenceRecord>;
  sources: SearchResult[];
}): ClaimRow[] {
  const names = new Map(view.entities.map((entity) => [entity.id, entity.name]));
  const rows = view.relationships.map((rel) => {
    const evidence = view.evidence[rel.id];
    const validation = view.validations[rel.id] ?? evidence?.validation;
    const stacked = evidence?.sources?.length
      ? evidence.sources
      : view.sources.filter((source) => source.url === rel.sourceUrl);
    const url = stacked[0]?.url || rel.sourceUrl;
    const extraUrls = stacked.slice(1).map((item) => item.url);
    return {
      relationshipId: rel.id,
      sourceId: rel.source,
      targetId: rel.target,
      sourceName: names.get(rel.source) ?? rel.source,
      targetName: names.get(rel.target) ?? rel.target,
      type: rel.type,
      claim: rel.claim,
      status: normalizeRelationshipStatus(rel.status),
      decision: normalizeDecision(validation?.decision),
      confidence: validation?.confidence,
      model: validation?.model ?? "mock",
      snippet: evidence?.snippet || rel.evidenceSnippet || rel.claim,
      url,
      extraUrls,
      sourceCount: Math.max(stacked.length, url ? 1 : 0),
      publishedAt: oldestPublished(stacked) || view.sources.find((source) => source.url === url)?.publishedAt,
      time: rel.time,
      when: formatEpisodeTime(rel.time),
    } satisfies ClaimRow;
  });

  return rows.sort((a, b) => {
    const rank = (RANK[a.decision] ?? 4) - (RANK[b.decision] ?? 4);
    if (rank !== 0) return rank;
    const aDate = a.publishedAt ? 1 : 0;
    const bDate = b.publishedAt ? 1 : 0;
    if (aDate !== bDate) return aDate - bDate;
    if (a.publishedAt && b.publishedAt && a.publishedAt !== b.publishedAt) {
      return a.publishedAt.localeCompare(b.publishedAt);
    }
    return a.sourceName.localeCompare(b.targetName);
  });
}

export function decisionCounts(rows: ClaimRow[]) {
  const counts = {
    CONTRADICTED: 0,
    UNCERTAIN: 0,
    PENDING: 0,
    SUPPORTED: 0,
    other: 0,
  };
  for (const row of rows) {
    if (row.decision === "CONTRADICTED") counts.CONTRADICTED += 1;
    else if (row.decision === "UNCERTAIN") counts.UNCERTAIN += 1;
    else if (row.decision === "PENDING") counts.PENDING += 1;
    else if (row.decision === "SUPPORTED") counts.SUPPORTED += 1;
    else counts.other += 1;
  }
  return counts;
}

export function statusCounts(rows: ClaimRow[]) {
  const counts = { deployed: 0, announced: 0, unclear: 0 };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

export function filterClaimRows(
  rows: ClaimRow[],
  decision: DecisionFilter,
  status: StatusFilter = "ALL",
): ClaimRow[] {
  return rows.filter((row) => {
    if (decision !== "ALL" && row.decision !== decision) return false;
    if (status !== "ALL" && row.status !== status) return false;
    return true;
  });
}

export function claimAuditSummary(counts: ReturnType<typeof decisionCounts>) {
  const disagreements = counts.CONTRADICTED + counts.UNCERTAIN;
  return {
    line: `Supported ${counts.SUPPORTED} · Uncertain ${counts.UNCERTAIN} · Contradicted ${counts.CONTRADICTED}`,
    warning:
      disagreements === 0
        ? "No disagreements found — treat as a first cut, not an audit."
        : null,
  };
}

export function formatAsOf(view: Pick<SessionView, "frozenAt" | "createdAt">): string {
  const stamp = view.frozenAt ?? view.createdAt;
  return new Date(stamp).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

export function formatPublished(value: string | undefined): string {
  return value?.slice(0, 10) || "undated";
}

function oldestPublished(sources: SearchResult[]): string | undefined {
  const dates = sources
    .map((item) => item.publishedAt?.slice(0, 10))
    .filter((item): item is string => Boolean(item))
    .sort();
  return dates[0];
}
