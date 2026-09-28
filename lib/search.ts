import { hasOpenAI, hasTavily } from "./config";
import { DEMO_SEARCH_RESULTS } from "./demo";
import { SEARCH_MODELS } from "./models";
import {
  applySourcePolicy,
  MIN_KEEP,
  tavilyExcludeDomains,
  tavilyIncludeDomains,
} from "./sources";
import { rankSearchResults } from "./sourceQuality";
import type { DroppedSource, SearchProvider, SearchResult, SourcePolicy } from "./types";

const MAX_RESULTS = 12;
const PAGE_TIMEOUT_MS = 4000;
const PAGE_CHAR_LIMIT = 2400;
const FETCH_COUNT = 8;
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
  broaden?: boolean;
  policy?: SourcePolicy;
};

export type SearchOutcome = {
  results: SearchResult[];
  provider: SearchProvider;
  dropped: DroppedSource[];
  recovered?: boolean;
};

const MAX_SEARCH_TOKENS = 12;

const SEARCH_STOP = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "do",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "how",
  "in",
  "into",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "there",
  "these",
  "this",
  "those",
  "to",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "versus",
  "vs",
  "he",
  "she",
  "him",
  "his",
  "her",
  "they",
  "them",
  "we",
  "our",
  "you",
  "your",
  "i",
  "me",
  "my",
  "did",
  "doing",
  "involved",
  "involvement",
  "setup",
  "connected",
  "connection",
  "connections",
  "relationship",
  "relationships",
  "public",
  "evidence",
  "evidenced",
]);

const SEARCH_WRAPPERS = [
  /\bwhich relationships have public evidence\b/gi,
  /\bhow are\b/gi,
  /\bconnected on\b/gi,
  /\band which\b/gi,
  /\bi'?m interested in (learning more about|knowing more about|learning about)\b/gi,
  /\bi want to (know|learn|understand|find out) (more )?(about )?/gi,
  /\btell me (more )?about\b/gi,
  /\bcan you (find|research|look up|tell me)\b/gi,
];

export function compactSearchQuery(question: string): string {
  let text = question.trim();
  for (const wrapper of SEARCH_WRAPPERS) text = text.replace(wrapper, " ");
  const tokens = text
    .replace(/[?!,;:()]+/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^["']+|["']+$/g, ""))
    .filter(Boolean);
  const kept: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    const key = token.toLowerCase();
    if (SEARCH_STOP.has(key) || key.length < 2 || seen.has(key)) continue;
    seen.add(key);
    kept.push(token);
    if (kept.length >= MAX_SEARCH_TOKENS) break;
  }
  return (kept.join(" ") || question.trim()).slice(0, TAVILY_QUERY_LIMIT);
}

const BIO_INTENT =
  /\b(who is|who's|who was|what does|what do|what is he|what is she|involved in|biography|background|profile)\b/i;

/** Compact the question and, for bio/involvement asks, bias Tavily toward encyclopedic hits. */
export function strategicSearchQuery(question: string): string {
  const compact = compactSearchQuery(question);
  if (/\b(donors?|donations?|fundraising)\b/i.test(question)) return compact;
  if (!BIO_INTENT.test(question)) return compact;
  if (/\bbiograph/i.test(compact)) return compact;
  const tokens = compact.split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 6) return compact;
  return `${compact} biography`.slice(0, TAVILY_QUERY_LIMIT);
}

export function nameOnlySearchQuery(question: string): string {
  const names = [...question.matchAll(/\b[A-Z][A-Za-z0-9]{1,}\b/g)]
    .map((match) => match[0])
    .filter((name) => !SEARCH_STOP.has(name.toLowerCase()));
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(name);
  }
  return (unique.slice(0, 8).join(" ") || compactSearchQuery(question)).slice(
    0,
    TAVILY_QUERY_LIMIT,
  );
}

const pageTextCache = new Map<string, string>();
const pageMetaCache = new Map<string, { text: string; publishedAt?: string }>();
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
  if (context.policy?.onlyUrls.length) {
    const pinned = context.policy.onlyUrls.map((url) => ({
      title: hostname(url) || url,
      url,
      snippet: "",
      source: hostname(url),
    }));
    return finishSearch(applySearchContext(pinned, context), "mock", context);
  }

  if (!hasOpenAI()) {
    return finishSearch(
      applySearchContext(DEMO_SEARCH_RESULTS, context),
      "mock",
      context,
    );
  }

  const compact = compactSearchQuery(query);
  const names = nameOnlySearchQuery(query);

  if (hasTavily()) {
    try {
      const collected: SearchResult[] = [];
      const ingestTavily = async (q: string) => {
        const hits = applySearchContext(await searchWithTavily(q, context), context);
        collected.push(...hits);
        return applySourcePolicy(mergeResults(collected), context.policy).results;
      };

      let allowed = await ingestTavily(query);
      if (allowed.length < MIN_KEEP && compact !== query) {
        allowed = await ingestTavily(compact);
      }
      if (
        allowed.length < MIN_KEEP &&
        names !== compact &&
        names !== query
      ) {
        allowed = await ingestTavily(names);
      }

      const shouldMergeOpenAI = Boolean(context.broaden) || allowed.length < MIN_KEEP;
      if (shouldMergeOpenAI) {
        try {
          const openaiHits = applySearchContext(
            await searchWithOpenAI(names || compact || query, context),
            context,
          );
          collected.push(...openaiHits);
          return finishSearch(
            mergeResults(collected),
            allowed.length > 0 ? "tavily" : "openai",
            context,
            true,
          );
        } catch {
          // Keep whatever Tavily already returned.
        }
      }

      if (collected.length > 0) {
        return finishSearch(mergeResults(collected), "tavily", context);
      }
    } catch {
      // Fall through to OpenAI web_search.
    }
  }

  const results = applySearchContext(
    await searchWithOpenAI(compact || query, context),
    context,
  );
  return finishSearch(results, "openai", context, Boolean(context.broaden));
}

function finishSearch(
  results: SearchResult[],
  provider: SearchProvider,
  context: SearchContext,
  recovered = false,
): SearchOutcome {
  const policy = applySourcePolicy(results, context.policy);
  return {
    results: rankSearchResults(policy.results).slice(0, MAX_RESULTS),
    provider,
    dropped: policy.dropped,
    recovered,
  };
}

export function mergeSearchOutcomes(outcomes: SearchOutcome[]): SearchOutcome {
  const collected = outcomes.flatMap((outcome) => outcome.results);
  const dropped = outcomes.flatMap((outcome) => outcome.dropped);
  const recovered = outcomes.some((outcome) => outcome.recovered);
  const withHits = outcomes.find((outcome) => outcome.results.length > 0);
  return {
    results: rankSearchResults(mergeResults(collected)).slice(0, 16),
    provider: withHits?.provider ?? outcomes[0]?.provider ?? "mock",
    dropped,
    recovered,
  };
}

function mergeResults(results: SearchResult[]): SearchResult[] {
  const found = new Map<string, SearchResult>();
  for (const item of results) upsertResult(found, item);
  return [...found.values()];
}

async function searchWithTavily(
  query: string,
  context: SearchContext,
): Promise<SearchResult[]> {
  const tavilyQuery = buildTavilyQuery(query);
  const cacheKey = searchCacheKey(
    tavilyQuery,
    context.excludeUrls ?? [],
    context.policy,
  );
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
        exclude_domains: tavilyExcludeDomains(context.policy),
        ...(tavilyIncludeDomains(context.policy)
          ? { include_domains: tavilyIncludeDomains(context.policy) }
          : {}),
        ...(context.policy?.publishedAfter
          ? { start_date: context.policy.publishedAfter }
          : {}),
        ...(context.policy?.publishedBefore
          ? { end_date: context.policy.publishedBefore }
          : {}),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Tavily search failed (${response.status})`);
    }
    const data: unknown = await response.json();
    const results = parseTavilyResults(data);
    if (results.length >= MIN_KEEP) {
      searchResultCache.set(cacheKey, results);
    }
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

function searchCacheKey(
  query: string,
  excludeUrls: string[],
  policy?: SourcePolicy,
): string {
  return JSON.stringify({
    q: query,
    skip: [...excludeUrls].sort(),
    policy: policy ?? null,
  });
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
              publishedAt:
                typeof s.publishedAt === "string"
                  ? s.publishedAt
                  : typeof s.published_date === "string"
                    ? s.published_date
                    : undefined,
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
    found.set(item.url, {
      ...existing,
      ...item,
      source: item.source || existing.source,
      publishedAt: item.publishedAt || existing.publishedAt,
    });
    return;
  }
  if (item.publishedAt && !existing.publishedAt) {
    found.set(item.url, { ...existing, publishedAt: item.publishedAt });
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
    "Return a JSON object: {\"results\":[{\"title\",\"url\",\"snippet\",\"source\",\"publishedAt\"}]}",
    "publishedAt is YYYY-MM-DD when known; omit it if unknown.",
    "Prefer primary sources (agencies, companies, reputable news, biographies). 8–12 results.",
    "Skip Facebook, Instagram, TikTok, X/Twitter, Reddit, Pinterest, and URL shorteners.",
    "Do not write a narrative answer. JSON only.",
  ];
  if (context.policy?.allowDomains.length) {
    lines.push(
      "Only include these domains:",
      JSON.stringify(context.policy.allowDomains),
    );
  }
  if (context.policy?.denyDomains.length) {
    lines.push(
      "Also skip these domains:",
      JSON.stringify(context.policy.denyDomains),
    );
  }
  if (context.policy?.publishedAfter || context.policy?.publishedBefore) {
    lines.push(
      `Prefer sources published between ${context.policy.publishedAfter ?? "any"} and ${context.policy.publishedBefore ?? "any"}.`,
    );
  }
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
  return skip.size ? results.filter((result) => !skip.has(result.url)) : results;
}

function rememberPageText(url: string, text: string) {
  const clipped = text.replace(/\s+/g, " ").trim().slice(0, PAGE_CHAR_LIMIT);
  if (clipped.length > MIN_PAGE_CHARS) pageTextCache.set(url, clipped);
}

export async function fetchPages(results: SearchResult[]): Promise<{
  documents: Document[];
  failed: SearchResult[];
}> {
  const failed: SearchResult[] = [];
  const pages = await Promise.all(
    results.map(async (result) => {
      const page = await fetchPage(result.url);
      if (!page) {
        failed.push(result);
        return { ...result, text: result.snippet };
      }
      return {
        ...result,
        text: page.text,
        publishedAt: result.publishedAt || page.publishedAt,
      };
    }),
  );
  return { documents: pages, failed };
}

export async function fetchRelevantPages(results: SearchResult[]): Promise<{
  documents: Document[];
  failed: SearchResult[];
}> {
  const ranked = rankSearchResults(results);
  const subset = ranked.slice(0, FETCH_COUNT);
  const fetched = await fetchPages(subset);
  const remainder = ranked.slice(FETCH_COUNT).map((r) => ({ ...r, text: r.snippet }));
  return { documents: [...fetched.documents, ...remainder], failed: fetched.failed };
}

async function fetchPage(
  url: string,
): Promise<{ text: string; publishedAt?: string } | null> {
  const cached = pageMetaCache.get(url);
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
    const publishedAt = extractPublishedAt(html);
    const page = { text, publishedAt };
    pageMetaCache.set(url, page);
    pageTextCache.set(url, text);
    return page;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function extractPublishedAt(html: string): string | undefined {
  const patterns = [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["']/i,
    /<meta[^>]+name=["']pubdate["'][^>]+content=["']([^"']+)/i,
    /<meta[^>]+name=["']date["'][^>]+content=["']([^"']+)/i,
    /<time[^>]+datetime=["']([^"']+)/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    const normalized = normalizePublishedAt(match?.[1]);
    if (normalized) return normalized;
  }
  return undefined;
}

function normalizePublishedAt(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const day = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  if (day) return day[1];
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return undefined;
  return new Date(parsed).toISOString().slice(0, 10);
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
