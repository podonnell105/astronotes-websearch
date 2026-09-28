import { formatPublished } from "@/lib/claims";
import { hostnameOf } from "@/lib/sources";
import type { Entity, EvidenceRecord, Relationship, Validation } from "@/lib/types";

export function EvidencePanel({
  relationship,
  source,
  target,
  evidence,
}: {
  relationship: Relationship | null;
  source?: Entity;
  target?: Entity;
  evidence?: EvidenceRecord;
}) {
  if (!relationship) {
    return (
      <aside className="flex h-full min-h-0 flex-col border-l border-line bg-panel">
        <div className="border-b border-line px-4 py-3">
          <div className="label">Evidence</div>
        </div>
        <div className="flex flex-1 items-center px-5 text-[13px] leading-6 text-dim">
          Select a relationship to inspect its audit trail.
        </div>
      </aside>
    );
  }

  const validation: Validation | undefined = evidence?.validation;
  const sources = evidence?.sources.length
    ? evidence.sources
    : relationship.sourceUrl
      ? [{ title: relationship.sourceUrl, url: relationship.sourceUrl, snippet: "" }]
      : [];

  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-line bg-panel">
      <div className="border-b border-line px-4 py-3">
        <div className="label">Evidence</div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <div className="space-y-2">
          <div className="text-[15px]">{source?.name ?? relationship.source}</div>
          <div className="flex items-center gap-2 text-dim">
            <span className="block h-8 w-px bg-line-strong" />
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
              {relationship.type}
            </span>
          </div>
          <div className="text-[15px]">{target?.name ?? relationship.target}</div>
        </div>

        <div className="mt-8 space-y-5">
          <Meta label="Basis" value={relationship.basis ?? "extracted"} />
          <Meta
            label="Jev decision"
            value={validation?.decision ?? (relationship.basis === "recorded" ? "SUPPORTED" : "PENDING")}
          />
          {typeof validation?.confidence === "number" && (
            <Meta label="Jev confidence" value={formatPct(validation.confidence)} />
          )}
          <Meta
            label="Validator"
            value={
              validation?.model === "jev"
                ? "Jev (live)"
                : validation?.model === "register"
                  ? "Register record"
                  : validation?.model === "rule"
                    ? "Named inference rule"
                    : "Mock / demo"
            }
            tone={
              validation?.model === "jev" || validation?.model === "register"
                ? "live"
                : "warn"
            }
          />
          <Meta label="Status" value={relationship.status} />
        </div>

        <section className="mt-8">
          <div className="label mb-3">Primary excerpt</div>
          <p className="text-[13px] leading-6 text-muted">
            “{evidence?.snippet || relationship.evidenceSnippet || relationship.claim}”
          </p>
        </section>

        <section className="mt-8">
          <div className="label mb-3">Sources</div>
          <ol className="space-y-4">
            {sources.map((sourceItem, index) => (
              <li key={sourceItem.url} className="text-[13px] text-muted">
                <div className="flex gap-2">
                  <span className="font-mono text-[11px] text-dim">{index + 1}.</span>
                  <a
                    href={sourceItem.url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[11px] uppercase tracking-[0.12em] text-accent hover:text-ink"
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
        </section>

        {relationship.basis === "inferred" && relationship.reasoning && (
          <section className="mt-8">
            <div className="label mb-3">Reasoning</div>
            <ol className="space-y-2 text-[13px] leading-6 text-muted">
              {relationship.reasoning.steps.map((step) => (
                <li key={step.order}>
                  {step.order}. {step.text}
                </li>
              ))}
            </ol>
            <p className="mt-3 text-[13px] leading-6 text-dim">
              {relationship.reasoning.disclaimer}
            </p>
          </section>
        )}
      </div>
    </aside>
  );
}

function Meta({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "live" | "warn";
}) {
  return (
    <div>
      <div className="label mb-1">{label}</div>
      <div
        className={`text-[13px] ${
          tone === "live" ? "text-live" : tone === "warn" ? "text-warn" : "text-ink"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function formatPct(value: number) {
  return `${Math.round(value * 100)}%`;
}
