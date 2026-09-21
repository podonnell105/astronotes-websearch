import { getJson } from "./fetchJson";
import type { Document } from "./search";

const PER_SOURCE = 2;

export async function lookupOpenAlex(names: string[]): Promise<Document[]> {
  const found: Document[] = [];
  for (const name of names.slice(0, 2)) {
    if (found.length >= PER_SOURCE) break;
    const params = new URLSearchParams({
      search: name,
      per_page: String(PER_SOURCE),
    });
    const data = await getJson<{
      results?: Array<{
        id?: string;
        doi?: string;
        display_name?: string;
        publication_date?: string;
        authorships?: Array<{ institutions?: Array<{ display_name?: string }> }>;
      }>;
    }>(`https://api.openalex.org/works?${params.toString()}`, {
      "User-Agent": "Astronotes/0.1 (mailto:contact@astronotes.test)",
    });
    for (const work of data?.results ?? []) {
      if (found.length >= PER_SOURCE) break;
      const openAlexId = String(work.id ?? "").trim();
      const url =
        work.doi && String(work.doi).startsWith("http")
          ? String(work.doi)
          : openAlexId || "";
      if (!url) continue;
      const orgs = (work.authorships ?? [])
        .flatMap((item) => item.institutions ?? [])
        .map((item) => item.display_name)
        .filter(Boolean)
        .slice(0, 3);
      const snippet = [
        `OpenAlex paper: ${work.display_name || "Untitled"}.`,
        orgs.length ? `Affiliations ${orgs.join("; ")}.` : "",
        work.publication_date ? `Published ${work.publication_date}.` : "",
        "A paper with this affiliation is research evidence, not a product announcement.",
      ]
        .filter(Boolean)
        .join(" ");
      found.push({
        title: work.display_name || "OpenAlex work",
        url,
        snippet,
        source: "openalex.org",
        publishedAt: work.publication_date?.slice(0, 10),
        text: snippet,
      });
    }
  }
  return found.slice(0, PER_SOURCE);
}
