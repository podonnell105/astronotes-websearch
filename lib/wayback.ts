import { getText } from "./fetchJson";
import type { Document } from "./search";

const PER_SOURCE = 2;

export async function lookupWayback(names: string[]): Promise<Document[]> {
  const found: Document[] = [];
  for (const name of names.slice(0, 2)) {
    if (found.length >= PER_SOURCE) break;
    const domain = domainGuess(name);
    if (!domain) continue;
    const params = new URLSearchParams({
      url: domain,
      output: "json",
      filter: "statuscode:200",
      fl: "timestamp,original,statuscode",
      limit: "2",
      from: "1996",
    });
    const raw = await getText(
      `https://web.archive.org/cdx/search/cdx?${params.toString()}`,
    );
    let rows: string[][] = [];
    try {
      const parsed = raw ? JSON.parse(raw) : [];
      rows = Array.isArray(parsed) ? parsed : [];
    } catch {
      rows = [];
    }
    const records = rows.slice(1);
    for (const row of records) {
      if (found.length >= PER_SOURCE) break;
      const timestamp = String(row?.[0] ?? "");
      const original = String(row?.[1] ?? `https://${domain}`);
      if (!timestamp) continue;
      const day = `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`;
      const url = `https://web.archive.org/web/${timestamp}/${original}`;
      const snippet = [
        `Wayback capture of ${domain} on ${day}.`,
        `Original URL ${original}.`,
        "An archived product or company page is evidence the site existed then; it is not a contract.",
      ].join(" ");
      found.push({
        title: `${domain} — ${day}`,
        url,
        snippet,
        source: "web.archive.org",
        publishedAt: day,
        text: snippet,
      });
    }
  }
  return found.slice(0, PER_SOURCE);
}

function domainGuess(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\b(inc|corp|corporation|co|ltd|llc|plc|group|holdings|company)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "");
  if (slug.length < 3) return "";
  return `${slug}.com`;
}
