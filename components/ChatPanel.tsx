"use client";

import { PixelComposeMotif, formatElapsed } from "@/components/PixelComposeMotif";
import { linkifyEntityText } from "@/lib/entityLinks";
import type { ChatTurn, Entity } from "@/lib/types";
import { useEffect, useRef, useState } from "react";

export function ChatPanel({
  disabled,
  onAsk,
  messages,
  loading,
  error,
  entities,
  selectedEntityId,
  selectedRelationshipId,
  onSelectEdge,
  onSelectEntity,
}: {
  disabled?: boolean;
  onAsk: (question: string, options: { extend: boolean }) => void;
  messages: ChatTurn[];
  loading: boolean;
  error: string | null;
  entities: Entity[];
  selectedEntityId: string | null;
  selectedRelationshipId: string | null;
  onSelectEdge: (relationshipId: string) => void;
  onSelectEntity: (id: string | null) => void;
}) {
  const [question, setQuestion] = useState("");
  const [extend, setExtend] = useState(false);
  const startedAt = useRef<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (loading) {
      startedAt.current = Date.now();
      setElapsedMs(0);
      const id = window.setInterval(() => {
        if (startedAt.current != null) {
          setElapsedMs(Date.now() - startedAt.current);
        }
      }, 100);
      return () => window.clearInterval(id);
    }
    if (startedAt.current != null) {
      setElapsedMs(Date.now() - startedAt.current);
      startedAt.current = null;
    }
  }, [loading]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-line bg-panel">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-4">
        {loading && <PixelComposeMotif />}
        <div className="label">Ask this research</div>
        {elapsedMs != null && (
          <span className="ml-auto font-mono text-[10px] text-dim">
            {formatElapsed(elapsedMs)}
          </span>
        )}
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 && !loading && (
          <p className="text-[13px] leading-6 text-dim">
            Ask a question. Entity names in the answer are links to graph nodes. Cited edges light up when selected.
          </p>
        )}
        <div className="space-y-4">
          {messages.map((msg) => (
            <div key={msg.id} className="space-y-2">
              <div className="label">{msg.role === "user" ? "You" : "Answer"}</div>
              {msg.role === "assistant" && msg.model === "mock" && (
                <span className="label text-warn">Demo answer · graph only</span>
              )}
              {msg.role === "assistant" ? (
                <LinkedAnswer
                  text={msg.text}
                  entities={entities}
                  preferredIds={msg.references?.map((ref) => ref.entityId) ?? []}
                  selectedEntityId={selectedEntityId}
                  onSelectEntity={onSelectEntity}
                />
              ) : (
                <p className="whitespace-pre-wrap text-[13px] leading-5 text-muted">
                  {msg.text}
                </p>
              )}
              {msg.role === "assistant" && (msg.edgeReferences?.length ?? 0) > 0 && (
                <div>
                  <div className="label mb-1.5">Context</div>
                  <div className="flex flex-col gap-1.5">
                    {msg.edgeReferences?.map((ref) => {
                      const active = selectedRelationshipId === ref.relationshipId;
                      const involvesEntity =
                        selectedEntityId === ref.sourceId ||
                        selectedEntityId === ref.targetId;
                      return (
                        <button
                          key={ref.relationshipId}
                          type="button"
                          onClick={() => onSelectEdge(ref.relationshipId)}
                          className={`chat-edge-chip ${
                            active
                              ? "chat-edge-chip--active"
                              : involvesEntity
                                ? "chat-edge-chip--entity"
                                : ""
                          }`}
                        >
                          <span className="chat-edge-chip__type">{ref.type}</span>
                          <span className="chat-edge-chip__ends">
                            {ref.sourceName} → {ref.targetName}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        {error && <p className="mt-3 text-[12px] text-danger">{error}</p>}
      </div>

      <form
        className="shrink-0 border-t border-line px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (question.trim()) onAsk(question.trim(), { extend });
        }}
      >
        <label className="mb-2 flex cursor-pointer items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
          <input
            id="extend-graph"
            type="checkbox"
            checked={extend}
            disabled={disabled || loading}
            onChange={(e) => setExtend(e.target.checked)}
            className="border-line accent-current"
          />
          Extend graph
        </label>
        <div className="flex gap-2">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (question.trim()) onAsk(question.trim(), { extend });
              }
            }}
            disabled={disabled || loading}
            rows={2}
            placeholder="Ask a question about the graph..."
            className="min-w-0 flex-1 resize-none border border-line bg-canvas px-3 py-1.5 text-[13px] text-ink outline-none placeholder:text-dim focus:border-line-strong"
          />
          <button
            type="submit"
            disabled={disabled || loading || !question.trim()}
            className="self-end border border-line-strong px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted hover:text-ink disabled:opacity-40"
          >
            {loading ? (extend ? "Extending" : "Asking") : extend ? "Extend & ask" : "Ask"}
          </button>
        </div>
      </form>
    </aside>
  );
}

function LinkedAnswer({
  text,
  entities,
  preferredIds,
  selectedEntityId,
  onSelectEntity,
}: {
  text: string;
  entities: Entity[];
  preferredIds: string[];
  selectedEntityId: string | null;
  onSelectEntity: (id: string) => void;
}) {
  const segments = linkifyEntityText(text, entities, preferredIds);
  return (
    <p className="whitespace-pre-wrap text-[13px] leading-5 text-muted">
      {segments.map((segment, index) => {
        if (segment.type === "text") {
          return <span key={`t-${index}`}>{segment.text}</span>;
        }
        const active = selectedEntityId === segment.entityId;
        return (
          <a
            key={`e-${index}-${segment.entityId}`}
            href={`#node/${segment.entityId}`}
            className={`chat-entity-link ${active ? "chat-entity-link--active" : ""}`}
            onClick={(event) => {
              event.preventDefault();
              onSelectEntity(segment.entityId);
            }}
          >
            {segment.text}
          </a>
        );
      })}
    </p>
  );
}
