import type {
  Entity,
  EvidenceRecord,
  Relationship,
  SearchResult,
  SessionView,
  Validation,
} from "./types";

export type DecisionFilter = "ALL" | "CONTRADICTED" | "UNCERTAIN" | "PENDING" | "SUPPORTED";

export type ClaimRow = {
  relationshipId: string;
  sourceId: string;
  targetId: string;
  sourceName: string;
  targetName: string;
  type: string;
  claim: string;
  decision: string;
  confidence?: number;
  model: "jev" | "mock";
  snippet: string;
  url?: string;
  publishedAt?: string;
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
    const url =
      evidence?.sources[0]?.url ||
      rel.sourceUrl ||
      view.sources.find((source) => source.url === rel.sourceUrl)?.url;
    const publishedAt =
      evidence?.sources[0]?.publishedAt ||
      view.sources.find((source) => source.url === url)?.publishedAt;
    return {
      relationshipId: rel.id,
      sourceId: rel.source,
      targetId: rel.target,
      sourceName: names.get(rel.source) ?? rel.source,
      targetName: names.get(rel.target) ?? rel.target,
      type: rel.type,
      claim: rel.claim,
      decision: normalizeDecision(validation?.decision),
      confidence: validation?.confidence,
      model: validation?.model ?? "mock",
      snippet:
        evidence?.snippet || rel.evidenceSnippet || rel.claim,
      url,
      publishedAt,
    } satisfies ClaimRow;
  });

  return rows.sort((a, b) => {
    const rank = (RANK[a.decision] ?? 4) - (RANK[b.decision] ?? 4);
    if (rank !== 0) return rank;
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

export function filterClaimRows(rows: ClaimRow[], filter: DecisionFilter): ClaimRow[] {
  if (filter === "ALL") return rows;
  return rows.filter((row) => row.decision === filter);
}

export function formatAsOf(view: Pick<SessionView, "frozenAt" | "createdAt">): string {
  const stamp = view.frozenAt ?? view.createdAt;
  return new Date(stamp).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}
