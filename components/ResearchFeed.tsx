import type { ResearchEvent, SearchResult } from "@/lib/types";
import { useEffect, useRef } from "react";

export function ResearchFeed({
  events,
  stats,
  sources,
}: {
  events: Extract<ResearchEvent, { type: "log" }>[];
  stats: { sources: number; entities: number; relationships: number };
  sources: SearchResult[];
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  return (
    <section className="flex h-[132px] shrink-0 flex-col border-t border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line px-4 py-2">
        <div className="label">Live research</div>
        <div className="flex gap-4 font-mono text-[11px] text-dim">
          <span>✓ Found {stats.sources} sources</span>
          <span>✓ Extracted {stats.entities} entities</span>
          <span>✓ Validated {stats.relationships} relationships</span>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
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
        <div className="w-[240px] shrink-0 overflow-y-auto border-l border-line px-3 py-2">
          <div className="label mb-2">Sources</div>
          <ul className="space-y-1.5">
            {sources.map((source) => (
              <li key={source.url}>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate font-mono text-[11px] text-muted hover:text-ink"
                >
                  {source.source || source.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
