import { formatElapsed } from "@/components/PixelComposeMotif";
import type { RuntimeMode } from "@/lib/types";

export function ModeBadge({
  mode,
  jevStatus,
}: {
  mode: RuntimeMode | null;
  jevStatus: "jev" | "mock";
}) {
  if (!mode) return null;

  if (mode === "demo") {
    return <Badge tone="warn">DEMO MODE</Badge>;
  }

  if (mode === "partial" || jevStatus === "mock") {
    return (
      <div className="flex items-center gap-2">
        <Badge tone="live">LIVE SEARCH</Badge>
        <Badge tone="warn">MOCK JEV</Badge>
      </div>
    );
  }

  return <Badge tone="live">LIVE</Badge>;
}

function Badge({
  children,
  tone,
}: {
  children: string;
  tone: "live" | "warn";
}) {
  const color = tone === "live" ? "text-live border-live/30" : "text-warn border-warn/30";
  return (
    <span
      className={`label rounded-sm border px-2 py-1 ${color}`}
    >
      {children}
    </span>
  );
}

export function ResearchStatus({
  status,
  elapsedMs,
}: {
  status: "idle" | "running" | "complete" | "error";
  elapsedMs?: number | null;
}) {
  const dot =
    status === "running"
      ? "bg-live research-pulse"
      : status === "error"
        ? "bg-danger"
        : status === "complete"
          ? "bg-accent"
          : "bg-dim";

  return (
    <div className="flex items-center gap-2 text-[12px] text-muted">
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
      <span>Research</span>
      {elapsedMs != null && (
        <span className="font-mono text-[11px] text-dim">
          {formatElapsed(elapsedMs)}
        </span>
      )}
    </div>
  );
}
