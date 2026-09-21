import { isCatalogHost } from "./dataCatalog";
import { hostnameOf } from "./sources";

const ENCYCLOPEDIA = new Set([
  "wikipedia.org",
  "en.wikipedia.org",
  "britannica.com",
  "ebsco.com",
]);

const NEWS = new Set([
  "reuters.com",
  "apnews.com",
  "bloomberg.com",
  "wsj.com",
  "ft.com",
  "bbc.com",
  "bbc.co.uk",
  "dw.com",
  "nytimes.com",
  "washingtonpost.com",
  "economist.com",
]);

const DEMOTE = new Set([
  "youtube.com",
  "youtu.be",
  "goodreads.com",
  "indigo.ca",
  "amazon.com",
  "amazon.co.uk",
  "ebay.com",
  "pinterest.com",
  "tiktok.com",
]);

const FIRST_PARTY_HINTS = [
  "/team/",
  "/about",
  "/people/",
  "/author/",
];

/** Role facts that already happened. Not contract-vs-PR. */
export const IDENTITY_REL_TYPES = new Set([
  "founded",
  "cofounded",
  "chairs",
  "chairman",
  "partner_at",
  "educated_at",
  "created",
]);

export function sourceTrust(url: string): number {
  const host = hostnameOf(url);
  let path = "";
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    path = "";
  }

  if (!host) return 0;
  if (isCatalogHost(url)) return 96;
  if (host.endsWith(".gov") || host.endsWith(".gov.uk")) return 90;
  if (ENCYCLOPEDIA.has(host) || host.endsWith(".wikipedia.org")) return 88;
  if (host.endsWith(".edu")) return 74;
  if (NEWS.has(host) && path.includes("/opinion")) return 42;
  if (NEWS.has(host)) return 76;
  if (DEMOTE.has(host)) return 10;
  if (FIRST_PARTY_HINTS.some((hint) => path.includes(hint))) return 44;
  return 52;
}

export function rankSearchResults<T extends { url: string; snippet?: string }>(
  results: T[],
): T[] {
  return [...results].sort((a, b) => {
    const trust = sourceTrust(b.url) - sourceTrust(a.url);
    if (trust !== 0) return trust;
    return (b.snippet?.length ?? 0) - (a.snippet?.length ?? 0);
  });
}

export function isChromeText(value: string): boolean {
  return /skip to (main )?content|subscribe for full access|click to expand|sign up site categories|got a tip\?/i.test(
    value,
  );
}
