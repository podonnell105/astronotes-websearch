import { getJson } from "./fetchJson";
import type { Document } from "./search";

const PER_SOURCE = 2;

export async function lookupSamOpportunities(names: string[]): Promise<Document[]> {
  const apiKey = process.env.SAM_API_KEY?.trim();
  if (!apiKey) return [];

  const found: Document[] = [];
  const postedFrom = "01/01/2020";
  const postedTo = formatSamDate(new Date());
  for (const name of names.slice(0, 2)) {
    if (found.length >= PER_SOURCE) break;
    const params = new URLSearchParams({
      api_key: apiKey,
      limit: String(PER_SOURCE),
      q: name,
      postedFrom,
      postedTo,
    });
    const data = await getJson<{
      opportunitiesData?: Array<{
        noticeId?: string;
        title?: string;
        postedDate?: string;
        typeOfSetAsideDescription?: string;
        type?: string;
        department?: string;
      }>;
    }>(`https://api.sam.gov/opportunities/v2/search?${params.toString()}`);
    for (const row of data?.opportunitiesData ?? []) {
      if (found.length >= PER_SOURCE) break;
      const notice = String(row.noticeId ?? "").trim();
      if (!notice) continue;
      const url = `https://sam.gov/opp/${encodeURIComponent(notice)}/view`;
      const snippet = [
        `SAM.gov opportunity ${notice}: ${row.title || name}.`,
        row.department ? `Department ${row.department}.` : "",
        row.type ? `Type ${row.type}.` : "",
        row.postedDate ? `Posted ${row.postedDate}.` : "",
        "A solicitation is announced/bid evidence, not an award. Prefer USASpending for awarded contracts.",
      ]
        .filter(Boolean)
        .join(" ");
      found.push({
        title: row.title || `SAM ${notice}`,
        url,
        snippet,
        source: "sam.gov",
        publishedAt: String(row.postedDate ?? "").slice(0, 10) || undefined,
        text: snippet,
      });
    }
  }
  return found.slice(0, PER_SOURCE);
}

function formatSamDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}/${day}/${date.getFullYear()}`;
}
