import type { Document } from "./search";

const GLEIF_URL = "https://api.gleif.org/api/v1/lei-records";
const COMPANIES_HOUSE_URL = "https://api.company-information.service.gov.uk/search/companies";
const TIMEOUT_MS = 10000;

/**
 * Legal-entity identity: GLEIF (always) and Companies House (API key).
 * Called from the live path only when the user enables those catalog sources.
 */
export async function fetchIdentityRecords(
  names: string[],
  excludeUrls: string[] = [],
): Promise<Document[]> {
  const skip = new Set(excludeUrls);
  const [gleif, house] = await Promise.all([
    lookupGleif(names),
    lookupCompaniesHouse(names),
  ]);
  const found: Document[] = [];
  const seen = new Set(skip);
  for (const doc of [...gleif, ...house]) {
    if (seen.has(doc.url)) continue;
    seen.add(doc.url);
    found.push(doc);
  }
  return found.slice(0, 6);
}

export async function lookupGleif(names: string[]): Promise<Document[]> {
  const found: Document[] = [];
  for (const name of names.slice(0, 2)) {
    const params = new URLSearchParams({
      "filter[entity.legalName]": name,
      "page[size]": "2",
    });
    const data = await getJson<{
      data?: Array<{
        id?: string;
        attributes?: {
          entity?: {
            legalName?: { name?: string };
            legalAddress?: { country?: string };
            status?: string;
          };
          registration?: { status?: string };
        };
        relationships?: {
          "direct-parent"?: { data?: { id?: string } | null };
        };
      }>;
    }>(`${GLEIF_URL}?${params.toString()}`, {
      Accept: "application/vnd.api+json",
    });
    for (const record of data?.data ?? []) {
      const lei = String(record.id ?? "").trim();
      if (!lei) continue;
      const legalName = record.attributes?.entity?.legalName?.name || name;
      const country = record.attributes?.entity?.legalAddress?.country || "";
      const parent = record.relationships?.["direct-parent"]?.data?.id || "";
      const status = record.attributes?.entity?.status || "";
      const url = `https://search.gleif.org/#/record/${lei}`;
      const snippet = [
        `GLEIF LEI ${lei} for ${legalName}.`,
        country ? `Country ${country}.` : "",
        status ? `Entity status ${status}.` : "",
        parent ? `Direct parent LEI ${parent}.` : "No direct parent LEI on this record.",
      ]
        .filter(Boolean)
        .join(" ");
      found.push({
        title: `LEI ${lei} — ${legalName}`,
        url,
        snippet,
        source: "gleif.org",
        text: `${snippet} Use LEI and parent LEI to keep legal entities distinct in the graph.`,
      });
    }
  }
  return found;
}

export async function lookupCompaniesHouse(names: string[]): Promise<Document[]> {
  const apiKey = process.env.COMPANIES_HOUSE_API_KEY?.trim();
  if (!apiKey) return [];

  const found: Document[] = [];
  const auth = Buffer.from(`${apiKey}:`).toString("base64");
  for (const name of names.slice(0, 2)) {
    const params = new URLSearchParams({ q: name, items_per_page: "2" });
    const data = await getJson<{
      items?: Array<{
        company_number?: string;
        title?: string;
        company_status?: string;
        company_type?: string;
        address_snippet?: string;
        date_of_creation?: string;
      }>;
    }>(`${COMPANIES_HOUSE_URL}?${params.toString()}`, {
      Accept: "application/json",
      Authorization: `Basic ${auth}`,
    });
    for (const item of data?.items ?? []) {
      const number = String(item.company_number ?? "").trim();
      if (!number) continue;
      const title = item.title || name;
      const url = `https://find-and-update.company-information.service.gov.uk/company/${number}`;
      const snippet = [
        `Companies House ${number} — ${title}.`,
        item.company_status ? `Status ${item.company_status}.` : "",
        item.company_type ? `Type ${item.company_type}.` : "",
        item.address_snippet || "",
        item.date_of_creation ? `Incorporated ${item.date_of_creation}.` : "",
      ]
        .filter(Boolean)
        .join(" ");
      found.push({
        title: `${title} (${number})`,
        url,
        snippet,
        source: "companieshouse.gov.uk",
        publishedAt: item.date_of_creation,
        text: `${snippet} Officers and PSCs belong on this company number, not a similarly named affiliate.`,
      });
    }
  }
  return found;
}

async function getJson<T>(
  url: string,
  headers: Record<string, string>,
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers,
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
