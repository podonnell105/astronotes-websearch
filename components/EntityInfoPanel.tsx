"use client";

import { formatEpisodeTime } from "@/lib/timeline";
import {
  entityTypeChip,
  type Entity,
  type EvidenceRecord,
  type Relationship,
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
                  {(rel.claim || rel.evidenceSnippet) && (
                    <div className="entity-connection-fact">
                      {rel.claim || rel.evidenceSnippet}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {selected && (
          <div className="mt-4 border-t border-line pt-3">
            <div className="label mb-2">Evidence</div>
            <p className="text-[12px] leading-5 text-muted">
              “{evidence?.snippet || selected.evidenceSnippet || selected.claim}”
            </p>
            {typeof evidence?.validation?.decision === "string" && (
              <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-dim">
                {evidence.validation.decision}
                {typeof evidence.validation.confidence === "number"
                  ? ` · ${Math.round(evidence.validation.confidence * 100)}%`
                  : ""}
              </p>
            )}
            {(evidence?.sources.length
              ? evidence.sources
              : selected.sourceUrl
                ? [{ title: selected.sourceUrl, url: selected.sourceUrl, snippet: "" }]
                : []
            ).slice(0, 3).map((source) => (
              <a
                key={source.url}
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 block truncate font-mono text-[10px] uppercase tracking-[0.12em] text-accent hover:text-ink"
              >
                {source.source || source.title}
              </a>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
