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
          <Meta
            label="Jev decision"
            value={validation?.decision ?? "PENDING"}
          />
          {typeof validation?.confidence === "number" && (
            <Meta label="Jev confidence" value={formatPct(validation.confidence)} />
          )}
          <Meta
            label="Validator"
            value={validation?.model === "jev" ? "Jev (live)" : "Mock / demo"}
            tone={validation?.model === "jev" ? "live" : "warn"}
          />
        </div>

        <section className="mt-8">
          <div className="label mb-3">Evidence</div>
          <p className="text-[13px] leading-6 text-muted">
            “{evidence?.snippet || relationship.evidenceSnippet || relationship.claim}”
          </p>
          {primaryUrl(relationship, evidence) && (
            <a
              href={primaryUrl(relationship, evidence)}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block font-mono text-[11px] uppercase tracking-[0.12em] text-accent hover:text-ink"
            >
              Open source
            </a>
          )}
        </section>

        <section className="mt-8">
          <div className="label mb-3">Sources</div>
          <ol className="space-y-2">
            {(evidence?.sources.length
              ? evidence.sources
              : relationship.sourceUrl
                ? [{ title: relationship.sourceUrl, url: relationship.sourceUrl, snippet: "" }]
                : []
            ).map((sourceItem, index) => (
              <li key={sourceItem.url} className="flex gap-2 text-[13px] text-muted">
                <span className="font-mono text-[11px] text-dim">{index + 1}.</span>
                <a
                  href={sourceItem.url}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-ink"
                >
                  {sourceItem.source || sourceItem.title}
                </a>
              </li>
            ))}
          </ol>
        </section>
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

function primaryUrl(relationship: Relationship, evidence?: EvidenceRecord) {
  return evidence?.sources[0]?.url || relationship.sourceUrl;
}
