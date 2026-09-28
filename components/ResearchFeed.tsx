"use client";

import type { ResearchEvent } from "@/lib/types";
import { useEffect, useRef } from "react";

export function ResearchFeed({
  events,
  stats,
  collapsed = false,
  onToggle,
}: {
  events: Extract<ResearchEvent, { type: "log" }>[];
  stats: { sources: number; entities: number; relationships: number };
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (collapsed) return;
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [collapsed, events.length]);

  const counts = (
    <div className="flex gap-4 font-mono text-[11px] text-dim">
      <span>✓ Found {stats.sources} sources</span>
      <span>✓ Extracted {stats.entities} entities</span>
      <span>✓ Validated {stats.relationships} relationships</span>
    </div>
  );

  if (collapsed) {
    return (
      <section className="flex h-8 shrink-0 items-center justify-between gap-3 border-t border-line bg-panel px-4">
        <button
          type="button"
          onClick={onToggle}
          className="label hover:text-ink"
          title="Show live research"
        >
          Live research
        </button>
        <div className="flex min-w-0 items-center gap-3">
          {counts}
          {onToggle && (
            <button
              type="button"
              onClick={onToggle}
              className="border border-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted hover:border-line-strong hover:text-ink"
              title="Show live research"
            >
              Show
            </button>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="flex h-[132px] shrink-0 flex-col border-t border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line px-4 py-2">
        <button
          type="button"
          onClick={onToggle}
          className="label hover:text-ink"
          title="Hide live research"
        >
          Live research
        </button>
        <div className="flex items-center gap-3">
          {counts}
          {onToggle && (
            <button
              type="button"
              onClick={onToggle}
              className="border border-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted hover:border-line-strong hover:text-ink"
              title="Hide live research"
            >
              Hide
            </button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
        {events.map((event, index) => (
          <div
            key={`${event.timestamp}-${index}`}
            className="flex gap-3 py-0.5 font-mono text-[11px] leading-5"
            style={{ animation: "feed-in 220ms ease-out" }}
          >
            <span className="shrink-0 text-dim">{event.timestamp}</span>
            <span className="text-muted">{event.message}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </section>
  );
}
