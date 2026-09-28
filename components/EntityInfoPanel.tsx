"use client";

import { formatPublished } from "@/lib/claims";
import { hostnameOf } from "@/lib/sources";
import { formatEpisodeTime } from "@/lib/timeline";
import {
  entityTypeChip,
  type Entity,
  type EvidenceRecord,
  type Relationship,
  type SearchResult,
} from "@/lib/types";

export function EntityInfoPanel({
  entity,
  entities,
  relationships,
  selectedRelationshipId,
  evidence,
  onClose,
  onSelectConnection,
}: {
  entity: Entity | null;
  entities: Entity[];
  relationships: Relationship[];
  selectedRelationshipId: string | null;
  evidence?: EvidenceRecord;
  onClose: () => void;
  onSelectConnection: (relationshipId: string, peerId: string) => void;
}) {
  if (!entity) return null;

  const connections = relationships.filter(
    (rel) => rel.source === entity.id || rel.target === entity.id,
  );
  const nameById = new Map(entities.map((item) => [item.id, item.name]));
  const selected = connections.find((rel) => rel.id === selectedRelationshipId);

  const hasTimeline = relationships.some((rel) => rel.time);

  return (
    <aside className={`entity-info ${hasTimeline ? "entity-info--raised" : ""}`}>
      <div className="entity-info-header">
        <div className="min-w-0">
          <div className="type-chip" title={entity.type}>
            {entityTypeChip(entity.type)}
          </div>
          <div className="mt-1 truncate text-[14px] font-medium text-ink">
            {entity.name}
          </div>
          {(entity.jurisdiction || (entity.identifiers?.length ?? 0) > 0) && (
            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-dim">
              {[entity.jurisdiction, ...(entity.identifiers ?? []).map((item) => `${item.scheme} ${item.value}`)]
                .filter(Boolean)
                .join(" · ")}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="border border-line px-2 py-0.5 font-mono text-[11px] text-muted hover:border-line-strong hover:text-ink"
          title="Close"
        >
          ×
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="label mb-2">
          Connections ({connections.length})
        </div>
        {connections.length === 0 ? (
          <p className="text-[12px] text-dim">No connections</p>
        ) : (
          <div className="space-y-1.5">
            {connections.map((rel) => {
              const outgoing = rel.source === entity.id;
              const peerId = outgoing ? rel.target : rel.source;
              const peerName = nameById.get(peerId) ?? peerId;
              const here = entity.name;
              const active = rel.id === selectedRelationshipId;
              return (
                <button
                  key={rel.id}
                  type="button"
                  onClick={() => onSelectConnection(rel.id, peerId)}
                  className={`entity-connection ${active ? "entity-connection--active" : ""}`}
                  title={`${outgoing ? here : peerName} - ${rel.type} - ${outgoing ? peerName : here}`}
                >
                  <div className="entity-connection-line">
                    {outgoing ? (
                      <>
                        <span className="entity-connection-here">{here}</span>
                        <span className="entity-connection-sep"> - </span>
                        <span className="entity-connection-type">{rel.type}</span>
                        {formatEpisodeTime(rel.time) ? (
                          <>
                            <span className="entity-connection-sep"> </span>
                            <span className="entity-connection-when">
                              {formatEpisodeTime(rel.time)}
                            </span>
                          </>
                        ) : null}
                        <span className="entity-connection-sep"> - </span>
                        <span className="entity-connection-peer">{peerName}</span>
                      </>
                    ) : (
                      <>
                        <span className="entity-connection-peer">{peerName}</span>
                        <span className="entity-connection-sep"> - </span>
                        <span className="entity-connection-type">{rel.type}</span>
                        {formatEpisodeTime(rel.time) ? (
                          <>
                            <span className="entity-connection-sep"> </span>
                            <span className="entity-connection-when">
                              {formatEpisodeTime(rel.time)}
                            </span>
                          </>
                        ) : null}
                        <span className="entity-connection-sep"> - </span>
                        <span className="entity-connection-here">{here}</span>
                      </>
                    )}
                  </div>
                  {(rel.claim || rel.evidenceSnippet || rel.basis) && (
                    <>
                      {(rel.claim || rel.evidenceSnippet) && (
                        <div className="entity-connection-fact">
                          {rel.claim || rel.evidenceSnippet}
                        </div>
                      )}
                      {rel.basis && (
                        <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-dim">
                          {rel.basis}
                          {rel.unresolved ? " · unresolved name" : ""}
                        </div>
                      )}
                    </>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {selected && (
          <div className="mt-4 border-t border-line pt-3">
            <div className="label mb-2">Why is this here?</div>
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-dim">
              {(selected.knowledge ?? selected.basis ?? "extracted")}
              {selected.provenance?.fieldPath ? ` · ${selected.provenance.fieldPath}` : ""}
            </p>
            <p className="mt-2 text-[12px] leading-5 text-muted">
              “{evidence?.snippet || selected.evidenceSnippet || selected.claim}”
            </p>
            {typeof evidence?.validation?.decision === "string" && (
              <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-dim">
                {evidence.validation.decision}
                {typeof evidence.validation.confidence === "number"
                  ? ` · ${Math.round(evidence.validation.confidence * 100)}%`
                  : ""}
                {evidence.validation.model === "register"
                  ? " · register"
                  : evidence.validation.model === "rule"
                    ? " · rule"
                    : evidence.validation.model === "jev"
                      ? " · jev"
                      : " · mock"}
              </p>
            )}
            {selected.basis === "inferred" && selected.reasoning && (
              <div className="mt-3">
                <div className="label mb-2">Reasoning</div>
                <ol className="space-y-1 text-[12px] leading-5 text-muted">
                  {selected.reasoning.steps.map((step) => (
                    <li key={step.order}>
                      {step.order}. {step.text}
                    </li>
                  ))}
                </ol>
                <p className="mt-2 text-[12px] leading-5 text-dim">
                  {selected.reasoning.disclaimer}
                </p>
              </div>
            )}
            <EvidenceSources
              sources={
                evidence?.sources.length
                  ? evidence.sources
                  : selected.sourceUrl
                    ? [{ title: selected.sourceUrl, url: selected.sourceUrl, snippet: "" }]
                    : []
              }
            />
          </div>
        )}
      </div>
    </aside>
  );
}

function EvidenceSources({ sources }: { sources: SearchResult[] }) {
  if (sources.length === 0) return null;

  return (
    <div className="mt-3">
      <div className="label mb-2">Sources</div>
      <ol className="space-y-3">
        {sources.map((sourceItem, index) => (
          <li key={sourceItem.url} className="text-[12px] text-muted">
            <div className="flex gap-2">
              <span className="font-mono text-[10px] text-dim">{index + 1}.</span>
              <a
                href={sourceItem.url}
                target="_blank"
                rel="noreferrer"
                className="truncate font-mono text-[10px] uppercase tracking-[0.12em] text-accent hover:text-ink"
              >
                {sourceItem.source || hostnameOf(sourceItem.url) || sourceItem.title}
              </a>
            </div>
            <div className="mt-1 pl-5 font-mono text-[10px] text-dim">
              {formatPublished(sourceItem.publishedAt)}
            </div>
            {sourceItem.snippet && (
              <p className="mt-1 pl-5 text-[12px] leading-5 text-dim">
                “{sourceItem.snippet}”
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
