"use client";

import {
  basisCounts,
  buildClaimRows,
  claimAuditSummary,
  decisionCounts,
  filterClaimRows,
  formatPublished,
  statusCounts,
  type BasisFilter,
  type DecisionFilter,
  type StatusFilter,
} from "@/lib/claims";
import { hostnameOf } from "@/lib/sources";
import type {
  EvidenceRecord,
  Entity,
  Relationship,
  SearchResult,
  Validation,
} from "@/lib/types";
import { useMemo, useState } from "react";

const FILTERS: DecisionFilter[] = [
  "ALL",
  "CONTRADICTED",
  "UNCERTAIN",
  "PENDING",
  "SUPPORTED",
];

const STATUSES: StatusFilter[] = ["ALL", "deployed", "announced", "unclear"];
const BASES: BasisFilter[] = ["ALL", "recorded", "extracted", "inferred"];

export function ClaimTable({
  entities,
  relationships,
  validations,
  evidence,
  sources,
  selectedRelationshipId,
  onSelect,
  filtersOpen = true,
  onToggleFilters,
}: {
  entities: Entity[];
  relationships: Relationship[];
  validations: Record<string, Validation>;
  evidence: Record<string, EvidenceRecord>;
  sources: SearchResult[];
  selectedRelationshipId: string | null;
  onSelect: (relationshipId: string) => void;
  filtersOpen?: boolean;
  onToggleFilters?: () => void;
}) {
  const [filter, setFilter] = useState<DecisionFilter>("ALL");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [basis, setBasis] = useState<BasisFilter>("ALL");
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
  const statuses = statusCounts(rows);
  const bases = basisCounts(rows);
  const audit = claimAuditSummary(counts);
  const visible = filterClaimRows(rows, filter, status, basis);

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      {filtersOpen && (
      <div className="flex shrink-0 flex-col gap-1 border-b border-line px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
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
          {onToggleFilters && (
            <button
              type="button"
              onClick={onToggleFilters}
              className="ml-auto border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted hover:border-line-strong hover:text-ink"
              title="Hide filters"
            >
              Hide
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {STATUSES.map((item) => {
            const count =
              item === "ALL"
                ? rows.length
                : item === "deployed"
                  ? statuses.deployed
                  : item === "announced"
                    ? statuses.announced
                    : statuses.unclear;
            return (
              <button
                key={item}
                type="button"
                onClick={() => setStatus(item)}
                className={`border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${
                  status === item
                    ? "border-line-strong text-ink"
                    : "border-line text-muted hover:text-ink"
                }`}
              >
                {item === "ALL" ? "All status" : item} {count}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {BASES.map((item) => {
            const count =
              item === "ALL"
                ? rows.length
                : item === "recorded"
                  ? bases.recorded
                  : item === "extracted"
                    ? bases.extracted
                    : bases.inferred;
            return (
              <button
                key={item}
                type="button"
                onClick={() => setBasis(item)}
                className={`border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${
                  basis === item
                    ? "border-line-strong text-ink"
                    : "border-line text-muted hover:text-ink"
                }`}
              >
                {item === "ALL" ? "All basis" : item} {count}
              </button>
            );
          })}
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
          {audit.line}
        </div>
        {audit.warning && (
          <div className="text-[11px] text-dim">{audit.warning}</div>
        )}
      </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {visible.length === 0 ? (
          <p className="px-5 py-8 text-[13px] text-dim">No claims in this filter.</p>
        ) : (
          <table className="claim-table">
            <thead>
              <tr>
                <th>Decision</th>
                <th>Basis</th>
                <th>Status</th>
                <th>When</th>
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
                        {row.model === "jev"
                          ? "Jev"
                          : row.model === "register"
                            ? "Register"
                            : row.model === "rule"
                              ? "Rule"
                              : "Mock"}
                        {row.confidence != null
                          ? ` ${Math.round(row.confidence * 100)}%`
                          : ""}
                      </div>
                    </td>
                    <td>
                      <div className={`claim-basis claim-basis--${row.basis}`}>
                        {row.basis}
                      </div>
                    </td>
                    <td>
                      <div className={`claim-status claim-status--${row.status}`}>
                        {row.status}
                      </div>
                    </td>
                    <td>
                      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink">
                        {row.when || "—"}
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
                      {row.basis === "inferred" && row.reasoning && (
                        <ol className="mt-2 space-y-1 text-[11px] text-muted">
                          {row.reasoning.steps.map((step) => (
                            <li key={step.order}>
                              {step.order}. {step.text}
                            </li>
                          ))}
                          <li className="text-dim">{row.reasoning.disclaimer}</li>
                        </ol>
                      )}
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
                          {hostnameOf(row.url) || "Source"}
                          {row.sourceCount > 1 ? ` +${row.sourceCount - 1}` : ""}
                        </a>
                      ) : (
                        <span className="text-dim">—</span>
                      )}
                      <div className="mt-1 font-mono text-[10px] text-dim">
                        {formatPublished(row.publishedAt)}
                      </div>
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
