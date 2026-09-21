import { postJson } from "./fetchJson";
import type { Document } from "./search";

const PER_SOURCE = 2;

export async function lookupNihReporter(names: string[]): Promise<Document[]> {
  const found: Document[] = [];
  for (const name of names.slice(0, 2)) {
    if (found.length >= PER_SOURCE) break;
    const data = await postJson<{
      results?: Array<{
        project_num?: string;
        core_project_num?: string;
        project_title?: string;
        org_name?: string;
        award_amount?: number;
        fiscal_year?: number;
        abstract_text?: string;
      }>;
    }>("https://api.reporter.nih.gov/v2/projects/search", {
      criteria: { org_names: [name] },
      offset: 0,
      limit: PER_SOURCE,
    });
    for (const row of data?.results ?? []) {
      if (found.length >= PER_SOURCE) break;
      const project = String(row.core_project_num || row.project_num || "").trim();
      if (!project) continue;
      const url = `https://reporter.nih.gov/project-details/${encodeURIComponent(project)}`;
      const amount =
        typeof row.award_amount === "number"
          ? new Intl.NumberFormat("en-US", {
              style: "currency",
              currency: "USD",
              maximumFractionDigits: 0,
            }).format(row.award_amount)
          : "";
      const snippet = [
        `NIH RePORTER award ${project} to ${row.org_name || name}.`,
        row.project_title || "",
        amount ? `Amount ${amount}.` : "",
        row.fiscal_year ? `FY ${row.fiscal_year}.` : "",
        "This is a funded grant record, not an announcement.",
      ]
        .filter(Boolean)
        .join(" ");
      found.push({
        title: `${project} — ${row.project_title || name}`,
        url,
        snippet,
        source: "reporter.nih.gov",
        publishedAt: row.fiscal_year ? `${row.fiscal_year}-01-01` : undefined,
        text: `${snippet} ${String(row.abstract_text ?? "").slice(0, 400)}`,
      });
    }
  }
  return found.slice(0, PER_SOURCE);
}
