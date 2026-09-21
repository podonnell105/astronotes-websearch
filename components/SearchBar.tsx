"use client";

import { DEMO_QUERY } from "@/lib/demo";

export function SearchBar({
  query,
  onQuery,
  onSubmit,
  disabled,
  compact,
  onNewGraph,
}: {
  query: string;
  onQuery: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  compact?: boolean;
  onNewGraph?: () => void;
}) {
  return (
    <div className={compact ? "w-full" : "mx-auto w-full max-w-2xl"}>
      {!compact && (
        <p className="mb-4 text-[15px] text-muted">What do you want to understand?</p>
      )}
      <div
        className={`border border-line bg-panel ${compact ? "flex items-center gap-3 px-3 py-2" : "px-4 py-3"}`}
      >
        {compact ? (
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSubmit();
              }
            }}
            placeholder={DEMO_QUERY}
            className="min-w-0 flex-1 bg-transparent text-[13px] leading-6 text-ink outline-none placeholder:text-dim"
          />
        ) : (
          <textarea
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSubmit();
              }
            }}
            rows={2}
            placeholder={DEMO_QUERY}
            className="w-full resize-none bg-transparent text-[14px] leading-6 text-ink outline-none placeholder:text-dim"
          />
        )}
        {compact && (
          <div className="flex shrink-0 items-center gap-2">
            {onNewGraph && (
              <button
                type="button"
                onClick={onNewGraph}
                disabled={disabled}
                className="border border-line px-2 py-1 text-[11px] tracking-wide text-muted transition-colors hover:border-line-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                New graph
              </button>
            )}
            <button
              type="button"
              onClick={onSubmit}
              disabled={disabled || !query.trim()}
              className="border border-line-strong bg-panel-2 px-3 py-1 text-[12px] tracking-wide text-ink transition-colors hover:border-accent/50 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              Research →
            </button>
          </div>
        )}
      </div>
      {!compact && (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={onSubmit}
            disabled={disabled || !query.trim()}
            className="border border-line-strong bg-panel-2 px-4 py-1.5 text-[12px] tracking-wide text-ink transition-colors hover:border-accent/50 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            Research →
          </button>
        </div>
      )}
    </div>
  );
}
