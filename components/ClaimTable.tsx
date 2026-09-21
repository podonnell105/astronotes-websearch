"use client";

import {
  buildClaimRows,
  decisionCounts,
  filterClaimRows,
  type DecisionFilter,
} from "@/lib/claims";
import type { EvidenceRecord, Entity, Relationship, SearchResult, Validation } from "@/lib/types";
import { useMemo, useState } from "react";

const FILTERS: DecisionFilter[] = [
  "ALL",
  "CONTRADICTED",
  "UNCERTAIN",
  "PENDING",
  "SUPPORTED",
];

export function ClaimTable({
  entities,
  relationships,
  validations,
  evidence,
  sources,
  selectedRelationshipId,
  onSelect,
}: {
  entities: Entity[];
  relationships: Relationship[];
  validations: Record<string, Validation>;
  evidence: Record<string, EvidenceRecord>;
  sources: SearchResult[];
  selectedRelationshipId: string | null;
  onSelect: (relationshipId: string) => void;
}) {
  const [filter, setFilter] = useState<DecisionFilter>("ALL");
  const rows = useMemo(
    () =>
      buildClaimRows({
        entities,
        relationships,
        validations,
        evidence,
        sources,
      }),
    [entities, relationships, validations, evidence, sources],
  );
  const counts = decisionCounts(rows);
  const visible = filterClaimRows(rows, filter);

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-2">
        {FILTERS.map((item) => {
          const count =
            item === "ALL"
              ? rows.length
              : item === "CONTRADICTED"
                ? counts.CONTRADICTED
                : item === "UNCERTAIN"
                  ? counts.UNCERTAIN
                  : item === "PENDING"
                    ? counts.PENDING
                    : counts.SUPPORTED;
          return (
            <button
              key={item}
              type="button"
              onClick={() => setFilter(item)}
              className={`border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${
                filter === item
                  ? "border-line-strong text-ink"
                  : "border-line text-muted hover:text-ink"
              }`}
            >
              {item === "ALL" ? "All" : item.toLowerCase()} {count}
            </button>
          );
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {visible.length === 0 ? (
          <p className="px-5 py-8 text-[13px] text-dim">No claims in this filter.</p>
        ) : (
          <table className="claim-table">
            <thead>
              <tr>
                <th>Decision</th>
                <th>Actors</th>
                <th>Claim</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const active = row.relationshipId === selectedRelationshipId;
                return (
                  <tr
                    key={row.relationshipId}
                    className={`claim-row ${active ? "claim-row--active" : ""}`}
                    onClick={() => onSelect(row.relationshipId)}
                  >
                    <td>
                      <div className={`claim-decision claim-decision--${row.decision}`}>
                        {row.decision}
                      </div>
                      <div className="mt-1 font-mono text-[10px] text-dim">
                        {row.model === "jev" ? "Jev" : "Mock"}
                        {row.confidence != null
                          ? ` ${Math.round(row.confidence * 100)}%`
                          : ""}
                      </div>
                    </td>
                    <td>
                      <div className="text-ink">{row.sourceName}</div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-accent">
                        {row.type}
                      </div>
                      <div>{row.targetName}</div>
                    </td>
                    <td className="max-w-[420px]">
                      <div className="text-ink">{row.claim}</div>
                      <div className="mt-1 line-clamp-2 text-[11px] text-dim">
                        “{row.snippet}”
                      </div>
                    </td>
                    <td>
                      {row.url ? (
                        <a
                          href={row.url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => event.stopPropagation()}
                          className="font-mono text-[10px] uppercase tracking-[0.12em] text-accent hover:text-ink"
                        >
                          {hostLabel(row.url)}
                        </a>
                      ) : (
                        <span className="text-dim">—</span>
                      )}
                      {row.publishedAt && (
                        <div className="mt-1 font-mono text-[10px] text-dim">
                          {row.publishedAt}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function hostLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Source";
  }
}
