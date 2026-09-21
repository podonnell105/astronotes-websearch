import { getJson } from "./fetchJson";
import type { Document } from "./search";

const PER_SOURCE = 2;

export async function lookupOpenSanctions(names: string[]): Promise<Document[]> {
  const apiKey = process.env.OPENSANCTIONS_API_KEY?.trim();
  if (!apiKey) return [];

  const found: Document[] = [];
  for (const name of names.slice(0, 2)) {
    if (found.length >= PER_SOURCE) break;
    const params = new URLSearchParams({ q: name, limit: String(PER_SOURCE) });
    const data = await getJson<{
      results?: Array<{
        id?: string;
        caption?: string;
        schema?: string;
        datasets?: string[];
        properties?: { topics?: string[] };
      }>;
    }>(`https://api.opensanctions.org/search/default?${params.toString()}`, {
      Authorization: `ApiKey ${apiKey}`,
    });
    for (const hit of data?.results ?? []) {
      if (found.length >= PER_SOURCE) break;
      const id = String(hit.id ?? "").trim();
      if (!id) continue;
      const url = `https://www.opensanctions.org/entities/${encodeURIComponent(id)}`;
      const topics = (hit.properties?.topics ?? []).slice(0, 4).join(", ");
      const snippet = [
        `OpenSanctions ${id}: ${hit.caption || name}.`,
        hit.schema ? `Schema ${hit.schema}.` : "",
        topics ? `Topics ${topics}.` : "",
        hit.datasets?.length ? `Datasets ${hit.datasets.slice(0, 4).join(", ")}.` : "",
        "Sanctions or PEP flags belong as risk rows, not gossip.",
      ]
        .filter(Boolean)
        .join(" ");
      found.push({
        title: `${hit.caption || name} (${id})`,
        url,
        snippet,
        source: "opensanctions.org",
        text: snippet,
      });
    }
  }
  return found.slice(0, PER_SOURCE);
}
