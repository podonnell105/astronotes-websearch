import {
  buildClaimRows,
  decisionCounts,
  formatAsOf,
  type ClaimRow,
} from "./claims";
import type { SessionView } from "./types";

export function buildPackMarkdown(view: SessionView): string {
  const rows = buildClaimRows(view);
  const counts = decisionCounts(rows);
  const gaps = rows.filter(
    (row) =>
      row.decision === "UNCERTAIN" ||
      row.decision === "CONTRADICTED" ||
      row.decision === "PENDING",
  );
  const unanswered = unansweredFromChat(view);

  const lines = [
    `# Astronotes evidence pack`,
    ``,
    `Query: ${view.query}`,
    `As of: ${formatAsOf(view)}`,
    `Mode: ${view.mode}`,
    `Jev: ${view.jevStatus === "jev" ? "live" : "mock"}`,
    `Sources: ${view.stats.sources} · Entities: ${view.stats.entities} · Claims: ${rows.length}`,
    `Supported ${counts.SUPPORTED} · Uncertain ${counts.UNCERTAIN} · Contradicted ${counts.CONTRADICTED} · Pending ${counts.PENDING}`,
    ``,
    `## Claims`,
    ``,
    `| Decision | ${esc("Actor")} | Relation | ${esc("Actor")} | Claim | Confidence | Validator | Source | Published |`,
    `| --- | --- | --- | --- | --- | --- | --- | --- | --- |`,
    ...rows.map(markdownRow),
    ``,
    `## Gaps`,
    ``,
  ];

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

  return lines.join("\n");
}

export function buildPackCsv(view: SessionView): string {
  const rows = buildClaimRows(view);
  const header = [
    "decision",
    "source",
    "relation",
    "target",
    "claim",
    "confidence",
    "validator",
    "snippet",
    "url",
    "publishedAt",
  ];
  const body = rows.map((row) =>
    [
      row.decision,
      row.sourceName,
      row.type,
      row.targetName,
      row.claim,
      row.confidence == null ? "" : String(Math.round(row.confidence * 100) / 100),
      row.model,
      row.snippet,
      row.url ?? "",
      row.publishedAt ?? "",
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...body].join("\n");
}

function markdownRow(row: ClaimRow): string {
  const confidence =
    row.confidence == null ? "" : `${Math.round(row.confidence * 100)}%`;
  return `| ${row.decision} | ${esc(row.sourceName)} | ${esc(row.type)} | ${esc(row.targetName)} | ${esc(row.claim)} | ${confidence} | ${row.model} | ${row.url ?? ""} | ${row.publishedAt ?? ""} |`;
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
