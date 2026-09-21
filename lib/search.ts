import { hasOpenAI, hasTavily } from "./config";
import { DEMO_SEARCH_RESULTS } from "./demo";
import { SEARCH_MODELS } from "./models";
import type { SearchProvider, SearchResult } from "./types";

const MAX_RESULTS = 12;
const PAGE_TIMEOUT_MS = 4000;
const PAGE_CHAR_LIMIT = 2400;
const FETCH_COUNT = 6;
const TAVILY_TIMEOUT_MS = 15000;
const TAVILY_QUERY_LIMIT = 400;
const MIN_PAGE_CHARS = 40;

export type Document = SearchResult & { text?: string };

export type KnownEntity = {
  id: string;
  name: string;
  type: string;
};

export type SearchContext = {
  knownEntities?: KnownEntity[];
  excludeUrls?: string[];
  gaps?: string[];
};

export type SearchOutcome = {
  results: SearchResult[];
  provider: SearchProvider;
};

const pageTextCache = new Map<string, string>();
const searchResultCache = new Map<string, SearchResult[]>();

export function rankKnownEntities(
  query: string,
  entities: KnownEntity[],
): KnownEntity[] {
  const scored = entities.map((entity, index) => ({
    entity,
    mentioned: entityMatchesQuery(query, entity.name),
    index,
  }));
  scored.sort((a, b) => {
    if (a.mentioned !== b.mentioned) return a.mentioned ? -1 : 1;
    return a.index - b.index;
  });
  return scored.map((item) => item.entity);
}

export function entityMatchesQuery(query: string, name: string): boolean {
  const q = query.toLowerCase();
  const n = name.trim().toLowerCase();
  if (n.length >= 2 && q.includes(n)) return true;
  const qTokens = tokenize(q);
  const nTokens = [...tokenize(n)];
  if (nTokens.length === 0) return false;
  const hits = nTokens.filter(
    (token) => qTokens.has(token) || (token.length >= 5 && q.includes(token)),
  );
  return hits.length >= Math.min(2, nTokens.length) || hits.some((token) => token.length >= 6);
}

function tokenize(value: string): Set<string> {
  return new Set(
    value.split(/[^a-z0-9]+/).filter((token) => token.length >= 4),
  );
}

export async function searchWeb(
  query: string,
  context: SearchContext = {},
): Promise<SearchOutcome> {
  if (!hasOpenAI()) {
    return { results: applySearchContext(DEMO_SEARCH_RESULTS, context), provider: "mock" };
  }

  if (hasTavily()) {
    try {
      const results = applySearchContext(await searchWithTavily(query, context), context);
      return { results, provider: "tavily" };
    } catch {
      // Fall through to OpenAI web_search.
    }
  }

  const results = applySearchContext(await searchWithOpenAI(query, context), context);
  return { results, provider: "openai" };
}

async function searchWithTavily(
  query: string,
  context: SearchContext,
): Promise<SearchResult[]> {
  const tavilyQuery = buildTavilyQuery(query);
  const cacheKey = searchCacheKey(tavilyQuery, context.excludeUrls ?? []);
  const cached = searchResultCache.get(cacheKey);
  if (cached) return cached;

  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) throw new Error("Tavily API key missing");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TAVILY_TIMEOUT_MS);
  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        api_key: apiKey,
        query: tavilyQuery,
        search_depth: "basic",
        max_results: 10,
        chunks_per_source: 3,
        include_answer: false,
        include_raw_content: false,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Tavily search failed (${response.status})`);
    }
    const data: unknown = await response.json();
    const results = parseTavilyResults(data);
    searchResultCache.set(cacheKey, results);
    return results;
  } finally {
    clearTimeout(timer);
  }
}

function parseTavilyResults(data: unknown): SearchResult[] {
  const root = data as { results?: unknown[] };
  if (!Array.isArray(root.results)) return [];

  const found = new Map<string, SearchResult>();
  for (const item of root.results) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.url !== "string") continue;
    const content = String(rec.content ?? rec.snippet ?? "");
    upsertResult(found, {
      title: String(rec.title ?? rec.url),
      url: rec.url,
      snippet: content,
      source: hostname(rec.url),
      publishedAt:
        typeof rec.published_date === "string"
          ? rec.published_date
          : typeof rec.publishedAt === "string"
            ? rec.publishedAt
            : undefined,
    });
    rememberPageText(rec.url, content);
  }
  return [...found.values()];
}

function buildTavilyQuery(query: string): string {
  return query.trim().slice(0, TAVILY_QUERY_LIMIT);
}

function searchCacheKey(query: string, excludeUrls: string[]): string {
  return JSON.stringify({ q: query, skip: [...excludeUrls].sort() });
}

async function searchWithOpenAI(
  query: string,
  context: SearchContext,
): Promise<SearchResult[]> {
  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const prompt = buildSearchPrompt(query, context);

  let lastError: unknown;

  for (const model of SEARCH_MODELS) {
    try {
      const response = await client.responses.create({
        model,
        tools: [{ type: "web_search" }],
        tool_choice: "required",
        include: ["web_search_call.action.sources"],
        input: prompt,
      });
      const results = parseSearchResponse(response);
      if (results.length > 0) return results;
    } catch (error) {
      lastError = error;
      try {
        const response = await client.responses.create({
          model,
          tools: [{ type: "web_search" }],
          tool_choice: "required",
          input: prompt,
        });
        const results = parseSearchResponse(response);
        if (results.length > 0) return results;
      } catch (retryError) {
        lastError = retryError;
      }
    }
  }

  throw new Error(
    `Web search failed${lastError instanceof Error ? `: ${lastError.message}` : ""}`,
  );
}

function parseSearchResponse(response: unknown): SearchResult[] {
  const found = new Map<string, SearchResult>();
  const root = response as {
    output_text?: string;
    output?: unknown[];
  };

  collectFromOutput(root.output, found);

  if (root.output_text) {
    for (const item of parseJsonResults(root.output_text)) {
      upsertResult(found, item);
    }
  }

  return [...found.values()];
}

function collectFromOutput(output: unknown[] | undefined, found: Map<string, SearchResult>) {
  if (!Array.isArray(output)) return;

  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;

    if (rec.type === "web_search_call") {
      const action = rec.action as Record<string, unknown> | undefined;
      const sources = (action?.sources ?? rec.sources ?? rec.results) as unknown;
      if (Array.isArray(sources)) {
        for (const source of sources) {
          if (source && typeof source === "object") {
            const s = source as Record<string, unknown>;
            upsertResult(found, {
              title: String(s.title ?? s.url ?? "Source"),
              url: String(s.url ?? ""),
              snippet: String(s.snippet ?? s.description ?? ""),
              source: hostname(String(s.url ?? "")),
            });
          }
        }
      }
    }

    if (rec.type === "message" && Array.isArray(rec.content)) {
      for (const content of rec.content) {
        if (!content || typeof content !== "object") continue;
        const c = content as Record<string, unknown>;
        if (typeof c.text === "string") {
          for (const parsed of parseJsonResults(c.text)) upsertResult(found, parsed);
        }
        if (Array.isArray(c.annotations)) {
          for (const ann of c.annotations) {
            if (!ann || typeof ann !== "object") continue;
            const a = ann as Record<string, unknown>;
            if (a.type === "url_citation" && typeof a.url === "string") {
              upsertResult(found, {
                title: String(a.title ?? a.url),
                url: a.url,
                snippet: String(a.snippet ?? ""),
                source: hostname(a.url),
              });
            }
          }
        }
      }
    }
  }
}

function parseJsonResults(text: string): SearchResult[] {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1) return [];
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as {
      results?: unknown[];
    };
    if (!Array.isArray(parsed.results)) return [];
    return parsed.results.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const r = item as Record<string, unknown>;
      if (typeof r.url !== "string") return [];
      return [
        {
          title: String(r.title ?? r.url),
          url: r.url,
          snippet: String(r.snippet ?? ""),
          source: String(r.source ?? hostname(r.url)),
          publishedAt: typeof r.publishedAt === "string" ? r.publishedAt : undefined,
        },
      ];
    });
  } catch {
    return [];
  }
}

function upsertResult(found: Map<string, SearchResult>, item: SearchResult) {
  if (!item.url.startsWith("http")) return;
  const existing = found.get(item.url);
  if (!existing) {
    found.set(item.url, {
      ...item,
      source: item.source || hostname(item.url),
    });
    return;
  }
  if (item.snippet && item.snippet.length > (existing.snippet?.length ?? 0)) {
    found.set(item.url, { ...existing, ...item, source: item.source || existing.source });
  }
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function buildSearchPrompt(query: string, context: SearchContext): string {
  const lines = [
    "Search the live web for the most relevant sources for this research question.",
    "Return a JSON object: {\"results\":[{\"title\",\"url\",\"snippet\",\"source\"}]}",
    "Prefer primary sources (agencies, companies, reputable news, biographies). 8–12 results.",
    "Do not write a narrative answer. JSON only.",
  ];
  if (context.gaps?.length) {
    lines.push(
      "Fill these missing graph facets with NEW sources:",
      JSON.stringify(context.gaps),
    );
  }
  if (context.knownEntities?.length) {
    lines.push(
      "Focus on these entities already in the graph. Prefer sources that add missing facts about them, not pages that only repeat known links:",
      JSON.stringify(context.knownEntities.slice(0, 3)),
    );
  }
  if (context.excludeUrls?.length) {
    lines.push(
      "Skip these already-used URLs:",
      JSON.stringify(context.excludeUrls),
    );
  }
  lines.push(`Search query: ${query}`);
  return lines.join("\n");
}

function applySearchContext(
  results: SearchResult[],
  context: SearchContext,
): SearchResult[] {
  const skip = new Set(context.excludeUrls ?? []);
  const fresh = skip.size ? results.filter((result) => !skip.has(result.url)) : results;
  return fresh.slice(0, MAX_RESULTS);
}

function rememberPageText(url: string, text: string) {
  const clipped = text.replace(/\s+/g, " ").trim().slice(0, PAGE_CHAR_LIMIT);
  if (clipped.length > MIN_PAGE_CHARS) pageTextCache.set(url, clipped);
}

export async function fetchRelevantPages(results: SearchResult[]): Promise<Document[]> {
  const subset = results.slice(0, FETCH_COUNT);
  const pages = await Promise.all(
    subset.map(async (result) => {
      const text = await fetchPageText(result.url);
      return { ...result, text: text ?? result.snippet };
    }),
  );
  const remainder = results.slice(FETCH_COUNT).map((r) => ({ ...r, text: r.snippet }));
  return [...pages, ...remainder];
}

async function fetchPageText(url: string): Promise<string | null> {
  const cached = pageTextCache.get(url);
  if (cached) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "User-Agent": "AstronotesResearch/0.1",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!response.ok) return null;
    const html = await response.text();
    const text = htmlToText(html).slice(0, PAGE_CHAR_LIMIT);
    if (text.length <= MIN_PAGE_CHARS) return null;
    pageTextCache.set(url, text);
    return text;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}
