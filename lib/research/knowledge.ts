import { isCatalogHost } from "../dataCatalog";
import { isSocialDiscoveryHost } from "../sources";
import { sourceTrust } from "../sourceQuality";
import type {
  EvidenceItem,
  EvidenceRecord,
  KnowledgeState,
  Relationship,
  Validation,
} from "../types";

export function knowledgeFromLegacy(input: {
  relationship: Relationship;
  validation?: Validation;
  evidence?: EvidenceRecord;
}): KnowledgeState {
  const { relationship, validation, evidence } = input;
  const decision = (validation?.decision ?? "").toUpperCase();
  if (decision === "CONTRADICTED") return "contradicted";
  if (relationship.basis === "inferred") return "inferred";
  if (decision === "UNCERTAIN") return "uncertain";
  if (relationship.basis === "recorded") return "fact";

  const items = evidenceItems(relationship, evidence);
  if (items.every((item) => item.directness === "discovery") && items.length > 0) {
    return "uncertain";
  }
  if (decision === "SUPPORTED") {
    const primary = items.filter((item) => item.directness === "direct");
    if (primary.length === 1 && items.length === 1) return "fact";
    if (primary.length >= 1 && items.length > 1) return "derived";
    if (items.length > 1) return "derived";
    if (primary.length === 1) return "fact";
    return "derived";
  }
  return relationship.knowledge ?? "uncertain";
}

export function evidenceItems(
  relationship: Relationship,
  evidence?: EvidenceRecord,
): EvidenceItem[] {
  if (relationship.evidence?.length) return relationship.evidence;
  const sources = evidence?.sources?.length
    ? evidence.sources
    : relationship.sourceUrl
      ? [
          {
            title: relationship.sourceUrl,
            url: relationship.sourceUrl,
            snippet: relationship.evidenceSnippet ?? relationship.claim,
            source: undefined,
          },
        ]
      : [];
  return sources.map((source) => ({
    source: source.source || source.title || source.url,
    snippet: source.snippet || relationship.evidenceSnippet || relationship.claim,
    url: source.url,
    directness: directnessFor(source.url),
    fetchedAt: relationship.provenance?.fetchedAt,
  }));
}

export function directnessFor(url: string): EvidenceItem["directness"] {
  if (isSocialDiscoveryHost(url)) return "discovery";
  if (isCatalogHost(url) || sourceTrust(url) >= 88) return "direct";
  return "secondary";
}

export function applyKnowledge(
  relationship: Relationship,
  validation?: Validation,
  evidence?: EvidenceRecord,
): Relationship {
  const items = evidenceItems(relationship, evidence);
  const knowledge = knowledgeFromLegacy({ relationship, validation, evidence });
  const confidence =
    relationship.confidence ??
    validation?.confidence ??
    (knowledge === "fact" ? 0.95 : knowledge === "derived" ? 0.75 : knowledge === "inferred" ? 0.4 : 0.3);
  return {
    ...relationship,
    knowledge,
    confidence,
    evidence: items,
  };
}
