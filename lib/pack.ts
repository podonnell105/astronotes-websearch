import {
  buildClaimRows,
  claimAuditSummary,
  decisionCounts,
  formatAsOf,
  formatPublished,
  statusCounts,
  type ClaimRow,
} from "./claims";
import { isCatalogHost } from "./dataCatalog";
import { formatSourcePolicy, hostnameOf } from "./sources";
import type { RelationshipStatus, SessionView } from "./types";

const STATUS_SECTIONS: RelationshipStatus[] = ["deployed", "announced", "unclear"];

export function buildPackMarkdown(view: SessionView): string {
  const rows = buildClaimRows(view);
  const counts = decisionCounts(rows);
  const statuses = statusCounts(rows);
  const audit = claimAuditSummary(counts);
  const gaps = rows.filter(
    (row) =>
      row.decision === "UNCERTAIN" ||
      row.decision === "CONTRADICTED" ||
      row.decision === "PENDING",
  );
  const unanswered = unansweredFromChat(view);
  const dropped = view.droppedSources ?? [];

  const lines = [
    `# Astronotes evidence pack`,
    ``,
    `Query: ${view.query}`,
    `As of: ${formatAsOf(view)}`,
    `Mode: ${view.mode}`,
    `Jev: ${view.jevStatus === "jev" ? "live" : "mock"}`,
    `Sources: ${view.stats.sources} · Entities: ${view.stats.entities} · Claims: ${rows.length}`,
    `Status: deployed ${statuses.deployed} · announced ${statuses.announced} · unclear ${statuses.unclear}`,
    audit.line,
    ...(audit.warning ? [audit.warning] : []),
    `Recorded facts and extracted claims are listed separately from inferred overlaps. Inferred overlaps are possible connections, not findings.`,
    `Source policy: ${formatSourcePolicy(view.sourcePolicy)}`,
    ...primaryCoverLines(view.sources),
    ``,
  ];

  if (dropped.length > 0) {
    lines.push(`Dropped sources: ${dropped.length}`);
    for (const item of dropped) {
      lines.push(
        `- ${hostnameOf(item.url) || item.url} — ${item.reason.replace(/_/g, " ")} (${item.url})`,
      );
    }
    lines.push("");
  }

  for (const status of STATUS_SECTIONS) {
    const section = rows.filter((row) => row.status === status);
    lines.push(`## ${titleCase(status)}`);
    lines.push("");
    if (section.length === 0) {
      lines.push("None.");
      lines.push("");
      continue;
    }
    lines.push(
      `| Decision | Basis | When | ${esc("Actor")} | Relation | ${esc("Actor")} | Claim | Confidence | Validator | Sources | Published |`,
    );
    lines.push(`| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`);
    for (const row of section) lines.push(markdownRow(row));
    lines.push("");
  }

  lines.push(`## Gaps`, ``);

  if (gaps.length === 0 && unanswered.length === 0) {
    lines.push("No uncertain, contradicted, or pending claims.");
  } else {
    for (const row of gaps) {
      lines.push(
        `- **${row.decision}** ${row.sourceName} ${row.type} ${row.targetName} — ${row.claim}`,
      );
    }
    for (const item of unanswered) {
      lines.push(`- Graph could not answer: ${item}`);
    }
  }

  const inferred = rows.filter((row) => row.basis === "inferred");
  if (inferred.length > 0) {
    lines.push("", `## Possible overlaps`, ``);
    lines.push("These are inferred from recorded facts. They are not proof of misconduct.");
    lines.push("");
    for (const row of inferred) {
      lines.push(`- ${row.sourceName} → ${row.targetName}: ${row.claim}`);
      if (row.reasoning) {
        for (const step of row.reasoning.steps) {
          lines.push(`  ${step.order}. ${step.text}`);
        }
        lines.push(`  ${row.reasoning.disclaimer}`);
      }
    }
  }

  return lines.join("\n");
}

export function buildPackCsv(view: SessionView): string {
  const rows = buildClaimRows(view);
  const header = [
    "decision",
    "status",
    "source",
    "relation",
    "target",
    "when",
    "claim",
    "confidence",
    "validator",
    "basis",
    "snippet",
    "url",
    "extraUrls",
    "publishedAt",
    "reasoning",
  ];
  const body = rows.map((row) =>
    [
      row.decision,
      row.status,
      row.sourceName,
      row.type,
      row.targetName,
      row.when,
      row.claim,
      row.confidence == null ? "" : String(Math.round(row.confidence * 100) / 100),
      row.model,
      row.basis,
      row.snippet,
      row.url ?? "",
      row.extraUrls.join(" "),
      row.publishedAt ?? "",
      row.reasoning
        ? `${row.reasoning.ruleId}: ${row.reasoning.steps.map((step) => step.text).join(" ")} ${row.reasoning.disclaimer}`
        : "",
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...body].join("\n");
}

function markdownRow(row: ClaimRow): string {
  const confidence =
    row.confidence == null ? "" : `${Math.round(row.confidence * 100)}%`;
  const urls = [row.url, ...row.extraUrls].filter(Boolean).join(" ");
  return `| ${row.decision} | ${esc(row.basis)} | ${esc(row.when || "—")} | ${esc(row.sourceName)} | ${esc(row.type)} | ${esc(row.targetName)} | ${esc(row.claim)} | ${confidence} | ${row.model} | ${esc(urls)} | ${formatPublished(row.publishedAt)} |`;
}

function primaryCoverLines(sources: SessionView["sources"]): string[] {
  const primary = sources.filter((source) => isCatalogHost(source.url));
  if (primary.length === 0) return [];
  const byHost = new Map<string, number>();
  for (const source of primary) {
    const host = hostnameOf(source.url) || "record";
    byHost.set(host, (byHost.get(host) ?? 0) + 1);
  }
  const summary = [...byHost.entries()]
    .map(([host, count]) => `${count} ${host}`)
    .join(" · ");
  const lines = [`Primary records: ${primary.length} (${summary})`];
  for (const source of primary) {
    lines.push(`- ${source.title} — ${source.url}`);
  }
  return lines;
}

function titleCase(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function esc(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function unansweredFromChat(view: SessionView): string[] {
  const hits: string[] = [];
  for (let i = 0; i < view.chat.length; i++) {
    const turn = view.chat[i];
    if (turn.role !== "assistant") continue;
    if (!/cannot answer|does not contain enough|could not answer/i.test(turn.text)) {
      continue;
    }
    const prev = view.chat[i - 1];
    if (prev?.role === "user") hits.push(prev.text);
  }
  return hits;
}
