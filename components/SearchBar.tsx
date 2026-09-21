"use client";

import {
  ANALYST_ROLES,
  DATA_CATALOG,
  DEFAULT_AVAILABLE_SOURCES,
  ROLE_LABELS,
  applyRolePreset,
  toggleDataSource,
  type DataSourceId,
} from "@/lib/dataCatalog";
import { EXAMPLE_QUERIES } from "@/lib/templates";
import {
  emptySourcePolicy,
  parseDomainList,
  parseUrlList,
  sourcePolicyActive,
} from "@/lib/sources";
import type { SourcePolicy } from "@/lib/types";
import { useEffect, useState } from "react";

export function SearchBar({
  query,
  onQuery,
  onSubmit,
  disabled,
  compact,
  onNewGraph,
  onCollapse,
  policy = emptySourcePolicy(),
  onPolicy,
  availableDataSources = DEFAULT_AVAILABLE_SOURCES,
}: {
  query: string;
  onQuery: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  compact?: boolean;
  onNewGraph?: () => void;
  onCollapse?: () => void;
  policy?: SourcePolicy;
  onPolicy?: (policy: SourcePolicy) => void;
  availableDataSources?: DataSourceId[];
}) {
  const [open, setOpen] = useState(sourcePolicyActive(policy));
  const [allow, setAllow] = useState(policy.allowDomains.join(", "));
  const [deny, setDeny] = useState(policy.denyDomains.join(", "));
  const [urls, setUrls] = useState(policy.onlyUrls.join("\n"));
  const [focused, setFocused] = useState(false);
  const active = sourcePolicyActive(policy);
  const available = new Set(availableDataSources);
  const roleBit =
    policy.role !== "custom" ? ` · ${ROLE_LABELS[policy.role] ?? policy.role}` : "";
  const sourcesLabel = `Sources${roleBit}${active ? " on" : ""}`;
  const animateExamples = !compact && !query.trim() && !focused;
  const example = useTypedExample(animateExamples);

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
            placeholder=""
            className="min-w-0 flex-1 bg-transparent text-[13px] leading-6 text-ink outline-none placeholder:text-dim"
          />
        ) : (
          <div className="relative">
            {animateExamples && example ? (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 text-[14px] leading-6 text-dim"
              >
                {example}
                <span className="ml-px inline-block h-[1em] w-px translate-y-[0.15em] animate-pulse bg-dim" />
              </div>
            ) : null}
            <textarea
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSubmit();
                }
              }}
              rows={2}
              placeholder=""
              className="relative w-full resize-none bg-transparent text-[14px] leading-6 text-ink outline-none placeholder:text-dim"
            />
          </div>
        )}
        {compact && (
          <div className="flex shrink-0 items-center gap-2">
            {onPolicy && (
              <button
                type="button"
                onClick={() => setOpen((current) => !current)}
                className={`border px-2 py-1 text-[11px] tracking-wide transition-colors ${
                  active || open
                    ? "border-line-strong text-ink"
                    : "border-line text-muted hover:border-line-strong hover:text-ink"
                }`}
              >
                {sourcesLabel}
              </button>
            )}
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
            {onCollapse && (
              <button
                type="button"
                onClick={onCollapse}
                className="border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted hover:border-line-strong hover:text-ink"
                title="Hide search"
              >
                Hide
              </button>
            )}
          </div>
        )}
      </div>
      {!compact && (
        <div className="mt-3 flex items-center justify-end gap-2">
          {onPolicy && (
            <button
              type="button"
              onClick={() => setOpen((current) => !current)}
              className={`border px-3 py-1.5 text-[12px] tracking-wide transition-colors ${
                active || open
                  ? "border-line-strong text-ink"
                  : "border-line text-muted hover:border-line-strong hover:text-ink"
              }`}
            >
              {sourcesLabel}
            </button>
          )}
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
      {onPolicy && open && (
        <div className="mt-3 grid gap-3 border border-line bg-panel px-4 py-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <span className="label mb-2 block">Role</span>
            <div className="flex flex-wrap gap-2">
              {ANALYST_ROLES.map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => onPolicy({ ...policy, ...applyRolePreset(role) })}
                  className={`border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${
                    policy.role === role
                      ? "border-line-strong text-ink"
                      : "border-line text-muted hover:border-line-strong hover:text-ink"
                  }`}
                >
                  {ROLE_LABELS[role]}
                </button>
              ))}
            </div>
          </div>
          <div className="sm:col-span-2">
            <span className="label mb-2 block">Structured data</span>
            <div className="grid gap-2 sm:grid-cols-2">
              {DATA_CATALOG.map((item) => {
                const checked = policy.dataSources.includes(item.id);
                const ready = available.has(item.id);
                return (
                  <label
                    key={item.id}
                    className={`flex items-start gap-2 text-[13px] ${ready ? "text-ink" : "text-dim"}`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={checked}
                      onChange={() =>
                        onPolicy({
                          ...policy,
                          ...toggleDataSource(policy.dataSources, item.id),
                        })
                      }
                    />
                    <span>
                      {item.label}
                      {!ready && item.needsEnv ? (
                        <span className="block font-mono text-[10px] uppercase tracking-[0.12em] text-dim">
                          Needs {item.needsEnv}
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
          <Field
            label="Allow domains"
            placeholder="nasa.gov, nokia.com"
            value={allow}
            onChange={(value) => {
              setAllow(value);
              onPolicy({ ...policy, allowDomains: parseDomainList(value) });
            }}
          />
          <Field
            label="Deny domains"
            placeholder="medium.com, blogspot.com"
            value={deny}
            onChange={(value) => {
              setDeny(value);
              onPolicy({ ...policy, denyDomains: parseDomainList(value) });
            }}
          />
          <label className="block">
            <span className="label mb-1 block">Published after</span>
            <input
              type="date"
              value={policy.publishedAfter ?? ""}
              onChange={(event) =>
                onPolicy({
                  ...policy,
                  publishedAfter: event.target.value || undefined,
                })
              }
              className="w-full border border-line bg-transparent px-2 py-1.5 text-[13px] text-ink outline-none"
            />
          </label>
          <label className="block">
            <span className="label mb-1 block">Published before</span>
            <input
              type="date"
              value={policy.publishedBefore ?? ""}
              onChange={(event) =>
                onPolicy({
                  ...policy,
                  publishedBefore: event.target.value || undefined,
                })
              }
              className="w-full border border-line bg-transparent px-2 py-1.5 text-[13px] text-ink outline-none"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="label mb-1 block">Only these URLs</span>
            <textarea
              rows={compact ? 2 : 3}
              placeholder="https://www.nasa.gov/..."
              value={urls}
              onChange={(event) => {
                setUrls(event.target.value);
                onPolicy({ ...policy, onlyUrls: parseUrlList(event.target.value) });
              }}
              className="w-full resize-y border border-line bg-transparent px-2 py-1.5 font-mono text-[12px] text-ink outline-none"
            />
          </label>
        </div>
      )}
    </div>
  );
}

function useTypedExample(enabled: boolean): string {
  const [text, setText] = useState(EXAMPLE_QUERIES[0] ?? "");

  useEffect(() => {
    if (!enabled) {
      setText("");
      return;
    }
    const examples = EXAMPLE_QUERIES.filter(Boolean);
    if (examples.length === 0) return;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setText(examples[0]);
      return;
    }

    let index = 0;
    let pos = 0;
    let deleting = false;
    let timer = 0;

    const tick = () => {
      const full = examples[index];
      if (!deleting) {
        pos += 1;
        setText(full.slice(0, pos));
        if (pos >= full.length) {
          deleting = true;
          timer = window.setTimeout(tick, 2400);
          return;
        }
        timer = window.setTimeout(tick, 22);
        return;
      }
      pos -= 1;
      setText(full.slice(0, Math.max(0, pos)));
      if (pos <= 0) {
        deleting = false;
        index = (index + 1) % examples.length;
        timer = window.setTimeout(tick, 360);
        return;
      }
      timer = window.setTimeout(tick, 12);
    };

    timer = window.setTimeout(tick, 280);
    return () => window.clearTimeout(timer);
  }, [enabled]);

  return text;
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="block">
      <span className="label mb-1 block">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full border border-line bg-transparent px-2 py-1.5 text-[13px] text-ink outline-none placeholder:text-dim"
      />
    </label>
  );
}
