import type { Document } from "./search";

const TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const SUBMISSIONS_URL = "https://data.sec.gov/submissions";
const EFTS_URL = "https://efts.sec.gov/LATEST/search-index";
const TIMEOUT_MS = 10000;
const WANTED_FORMS = new Set(["8-K", "8-K/A", "10-K", "10-K/A", "10-Q", "D", "D/A", "4"]);
const FORM_PRIORITY = ["10-K", "8-K", "D", "4", "10-Q"];
const MAX_FILINGS = 5;

type TickerRow = { cik_str: number; ticker: string; title: string };

let tickerCache: Promise<TickerRow[]> | null = null;

export function secUserAgent(): string {
  return (
    process.env.SEC_USER_AGENT?.trim() ||
    "Astronotes/0.1 (research; contact@astronotes.test)"
  );
}

export async function lookupEdgarFilings(
  names: string[],
  excludeUrls: string[] = [],
): Promise<Document[]> {
  const skip = new Set(excludeUrls);
  const found: Document[] = [];
  const seen = new Set<string>();

  for (const name of names.slice(0, 3)) {
    if (found.length >= MAX_FILINGS) break;
    const cik = await resolveCik(name);
    const filings = cik
      ? await filingsForCik(cik, name)
      : await searchEdgarIndex(name);
    for (const filing of filings) {
      if (found.length >= MAX_FILINGS) break;
      if (skip.has(filing.url) || seen.has(filing.url)) continue;
      seen.add(filing.url);
      found.push(filing);
    }
  }

  return found;
}

async function resolveCik(name: string): Promise<string | null> {
  const tickers = await loadTickers();
  const needle = normalizeName(name);
  if (needle.length < 3) return null;

  let best: { row: TickerRow; score: number } | null = null;
  for (const row of tickers) {
    const score = nameScore(needle, normalizeName(row.title), row.ticker);
    if (score < 8) continue;
    if (!best || score > best.score) best = { row, score };
  }
  if (!best) return null;
  return padCik(best.row.cik_str);
}

async function filingsForCik(cik: string, queryName: string): Promise<Document[]> {
  const data = await getJson<{
    name?: string;
    cik?: string | number;
    tickers?: string[];
    filings?: {
      recent?: {
        accessionNumber?: string[];
        filingDate?: string[];
        form?: string[];
        primaryDocument?: string[];
        primaryDocDescription?: string[];
      };
    };
  }>(`${SUBMISSIONS_URL}/CIK${cik}.json`);
  if (!data) return [];

  const recent = data.filings?.recent;
  const forms = recent?.form ?? [];
  const accessions = recent?.accessionNumber ?? [];
  const dates = recent?.filingDate ?? [];
  const documents = recent?.primaryDocument ?? [];
  const descriptions = recent?.primaryDocDescription ?? [];
  const legalName = String(data.name || queryName).trim();
  const picked: Document[] = [];
  const usedForms = new Set<string>();

  for (const wanted of FORM_PRIORITY) {
    for (let i = 0; i < forms.length && picked.length < MAX_FILINGS; i++) {
      const form = String(forms[i] ?? "").toUpperCase();
      if (!formMatches(form, wanted)) continue;
      const root = form.replace(/\/A$/, "");
      if (usedForms.has(root) && root !== "8-K" && root !== "D") continue;
      const accession = String(accessions[i] ?? "");
      const primary = String(documents[i] ?? "");
      const url = filingUrl(cik, accession, primary);
      if (!url) continue;
      const publishedAt = String(dates[i] ?? "").slice(0, 10);
      usedForms.add(root);
      picked.push(
        filingDocument({
          legalName,
          cik,
          form,
          accession,
          publishedAt,
          description: String(descriptions[i] ?? ""),
          url,
        }),
      );
      if (root !== "8-K") break;
      if (picked.filter((item) => item.title.includes("8-K")).length >= 2) break;
    }
  }

  return picked.slice(0, MAX_FILINGS);
}

async function searchEdgarIndex(name: string): Promise<Document[]> {
  const params = new URLSearchParams({
    q: `"${name}"`,
    forms: "8-K,10-K,D,4,10-Q",
    dateRange: "custom",
    startdt: yearsAgo(8),
    enddt: todayStamp(),
  });
  const data = await getJson<{
    hits?: {
      hits?: Array<{
        _id?: string;
        _source?: {
          file_date?: string;
          display_names?: string[];
          form_type?: string;
          ciks?: string[];
        };
      }>;
    };
  }>(`${EFTS_URL}?${params.toString()}`);
  const hits = data?.hits?.hits ?? [];
  const picked: Document[] = [];
  const usedForms = new Set<string>();

  for (const hit of hits) {
    if (picked.length >= MAX_FILINGS) break;
    const source = hit._source ?? {};
    const form = String(source.form_type ?? "").toUpperCase();
    if (!WANTED_FORMS.has(form) && !WANTED_FORMS.has(form.replace(/\/A$/, ""))) {
      continue;
    }
    const root = form.replace(/\/A$/, "");
    if (usedForms.has(root) && root !== "8-K" && root !== "D") continue;
    const cik = padCik(source.ciks?.[0] ?? "");
    const [accession, primary] = String(hit._id ?? "").split(":");
    const url = filingUrl(cik, accession, primary);
    if (!url) continue;
    usedForms.add(root);
    const display = String(source.display_names?.[0] ?? name);
    picked.push(
      filingDocument({
        legalName: display.replace(/\s+\(.*\)$/, "").trim() || name,
        cik,
        form,
        accession: accession ?? "",
        publishedAt: String(source.file_date ?? "").slice(0, 10),
        description: "",
        url,
      }),
    );
  }

  return picked;
}

function filingDocument(input: {
  legalName: string;
  cik: string;
  form: string;
  accession: string;
  publishedAt: string;
  description: string;
  url: string;
}): Document {
  const accession = input.accession.replace(/-/g, "");
  const snippet = [
    `SEC ${input.form} filing for ${input.legalName}.`,
    `CIK ${input.cik}.`,
    input.accession ? `Accession ${input.accession}.` : "",
    input.publishedAt ? `Filed ${input.publishedAt}.` : "",
    input.description ? input.description : "",
    "Primary SEC record, not a press snippet.",
  ]
    .filter(Boolean)
    .join(" ");
  const text = [
    snippet,
    `Form type: ${input.form}.`,
    `Company: ${input.legalName}.`,
    `CIK: ${input.cik}.`,
    `Accession: ${input.accession || accession}.`,
    `Evidence URL: ${input.url}.`,
    "Use this filing as primary evidence when labeling deployed versus announced claims.",
  ].join(" ");
  return {
    title: `${input.form} — ${input.legalName}${input.publishedAt ? ` (${input.publishedAt})` : ""}`,
    url: input.url,
    snippet,
    source: "sec.gov",
    publishedAt: input.publishedAt || undefined,
    text,
  };
}

function filingUrl(cik: string, accession: string, primary: string): string | null {
  const digits = String(cik).replace(/^0+/, "") || String(cik);
  const acc = String(accession).replace(/-/g, "").trim();
  const file = String(primary).trim();
  if (!digits || !acc) return null;
  if (file) {
    return `https://www.sec.gov/Archives/edgar/data/${digits}/${acc}/${file}`;
  }
  return `https://www.sec.gov/Archives/edgar/data/${digits}/${acc}/${accession}-index.html`;
}

function formMatches(form: string, wanted: string): boolean {
  return form === wanted || form === `${wanted}/A`;
}

function loadTickers(): Promise<TickerRow[]> {
  if (!tickerCache) {
    tickerCache = getJson<Record<string, TickerRow>>(TICKERS_URL).then((data) => {
      if (!data) return [];
      return Object.values(data).filter(
        (row) => row && typeof row.cik_str === "number" && row.title,
      );
    });
  }
  return tickerCache;
}

function nameScore(query: string, title: string, ticker: string): number {
  if (!query || !title) return 0;
  if (query === title) return 100;
  if (query === ticker.toLowerCase()) return 90;
  if (title.startsWith(query) || query.startsWith(title)) return 70;
  if (title.includes(query) || query.includes(title)) {
    return 40 + Math.min(query.length, title.length);
  }
  const qTokens = tokens(query);
  const tTokens = tokens(title);
  if (qTokens.length === 0) return 0;
  const hits = qTokens.filter((token) => tTokens.includes(token));
  if (hits.length === 0) return 0;
  if (hits.length === qTokens.length) return 50 + hits.length * 5;
  if (hits.some((token) => token.length >= 6) && hits.length >= Math.min(2, qTokens.length)) {
    return 20 + hits.length * 8;
  }
  return 0;
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(
      /\b(the|inc|incorporated|corp|corporation|co|ltd|llc|llp|plc|lp|holdings|group|company|companies|sa|ag|nv|oyj|gmbh)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string): string[] {
  return value.split(" ").filter((token) => token.length >= 3);
}

function padCik(value: string | number): string {
  return String(value).replace(/\D/g, "").padStart(10, "0");
}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function yearsAgo(years: number): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  return date.toISOString().slice(0, 10);
}

async function getJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "User-Agent": secUserAgent(),
        Accept: "application/json",
      },
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
