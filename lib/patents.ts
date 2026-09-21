import { postJson } from "./fetchJson";
import type { Document } from "./search";

const PER_SOURCE = 2;

export async function lookupPatents(names: string[]): Promise<Document[]> {
  const apiKey = process.env.PATENTSVIEW_API_KEY?.trim();
  if (!apiKey) return [];

  const found: Document[] = [];
  for (const name of names.slice(0, 2)) {
    if (found.length >= PER_SOURCE) break;
    const data = await postJson<{
      patents?: Array<{
        patent_id?: string;
        patent_title?: string;
        patent_date?: string;
        assignees?: Array<{ assignee_organization?: string }>;
      }>;
      error?: unknown;
    }>(
      "https://search.patentsview.org/api/v1/patent/",
      {
        q: { _text_any: { "assignees.assignee_organization": name } },
        f: ["patent_id", "patent_title", "patent_date", "assignees"],
        s: [{ patent_date: "desc" }],
        o: { size: PER_SOURCE },
      },
      { "X-Api-Key": apiKey },
    );
    for (const patent of data?.patents ?? []) {
      if (found.length >= PER_SOURCE) break;
      const id = String(patent.patent_id ?? "").trim();
      if (!id) continue;
      const assignee = patent.assignees?.[0]?.assignee_organization || name;
      const url = `https://patents.google.com/patent/US${id.replace(/^US/i, "")}/en`;
      const snippet = [
        `USPTO patent ${id}: ${patent.patent_title || "Untitled"}.`,
        `Assignee ${assignee}.`,
        patent.patent_date ? `Date ${patent.patent_date}.` : "",
        "A granted or filed patent is capability evidence, not a product launch.",
      ]
        .filter(Boolean)
        .join(" ");
      found.push({
        title: `${id} — ${patent.patent_title || assignee}`,
        url,
        snippet,
        source: "patentsview.org",
        publishedAt: patent.patent_date?.slice(0, 10),
        text: snippet,
      });
    }
  }
  return found.slice(0, PER_SOURCE);
}
