import {
  ROLE_LABELS,
  normalizeAnalystRole,
  normalizeDataSources,
  presetForRole,
  roleMatchingSources,
} from "./dataCatalog";
import type { DroppedSource, SearchResult, SourcePolicy } from "./types";

export const MIN_KEEP = 4;
export const SOURCE_POLICY_STORAGE_KEY = "an_source_policy";

export const SOCIAL_DOMAINS = [
  "facebook.com",
  "fb.com",
  "instagram.com",
  "tiktok.com",
  "x.com",
  "twitter.com",
  "pinterest.com",
  "reddit.com",
];

export const DENIED_DOMAINS = ["t.co", "bit.ly", "tinyurl.com", "ow.ly"];

export function emptySourcePolicy(): SourcePolicy {
  return {
    allowDomains: [],
    denyDomains: [],
    onlyUrls: [],
    role: "custom",
    dataSources: [],
  };
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function hostMatchesDomain(host: string, domain: string): boolean {
  const needle = domain.replace(/^www\./, "").toLowerCase().trim();
  if (!host || !needle) return false;
  return host === needle || host.endsWith(`.${needle}`);
}

export function hostIsDenied(url: string, extra: string[] = []): boolean {
  const host = hostnameOf(url);
  if (!host) return false;
  return [...DENIED_DOMAINS, ...extra].some((domain) => hostMatchesDomain(host, domain));
}

export function isSocialDiscoveryHost(url: string): boolean {
  const host = hostnameOf(url);
  if (!host) return false;
  return SOCIAL_DOMAINS.some((domain) => hostMatchesDomain(host, domain));
}

export function parseDomainList(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of value.split(/[\s,]+/)) {
    const raw = part.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    const domain = raw.replace(/^www\./, "");
    if (!domain || !domain.includes(".")) continue;
    if (seen.has(domain)) continue;
    seen.add(domain);
    out.push(domain);
  }
  return out;
}

export function parseUrlList(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of value.split(/[\s,]+/)) {
    const raw = part.trim();
    if (!raw) continue;
    try {
      const url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
      if (!url.hostname) continue;
      const href = url.href;
      if (seen.has(href)) continue;
      seen.add(href);
      out.push(href);
    } catch {
      /* skip */
    }
  }
  return out;
}

export function normalizeSourcePolicy(value: unknown): SourcePolicy {
  const rec =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const allowDomains = Array.isArray(rec.allowDomains)
    ? parseDomainList(rec.allowDomains.join(","))
    : parseDomainList(String(rec.allowDomains ?? rec.allow ?? ""));
  const denyDomains = Array.isArray(rec.denyDomains)
    ? parseDomainList(rec.denyDomains.join(","))
    : parseDomainList(String(rec.denyDomains ?? rec.deny ?? ""));
  const onlyUrls = Array.isArray(rec.onlyUrls)
    ? parseUrlList(rec.onlyUrls.join("\n"))
    : parseUrlList(String(rec.onlyUrls ?? rec.urls ?? ""));
  const publishedAfter = normalizeDay(rec.publishedAfter ?? rec.from);
  const publishedBefore = normalizeDay(rec.publishedBefore ?? rec.to);
  const explicitSources = rec.dataSources != null || rec.data != null;
  const dataSources = normalizeDataSources(rec.dataSources ?? rec.data);
  let role = normalizeAnalystRole(rec.role);
  if (!explicitSources) {
    const named = role !== "custom";
    return {
      allowDomains,
      denyDomains,
      onlyUrls,
      role: named ? role : "custom",
      dataSources: named ? presetForRole(role) : [],
      ...(publishedAfter ? { publishedAfter } : {}),
      ...(publishedBefore ? { publishedBefore } : {}),
    };
  }
  const sources = dataSources;
  role = roleMatchingSources(sources);
  return {
    allowDomains,
    denyDomains,
    onlyUrls,
    role,
    dataSources: sources,
    ...(publishedAfter ? { publishedAfter } : {}),
    ...(publishedBefore ? { publishedBefore } : {}),
  };
}

export function sourcePolicyActive(policy: SourcePolicy | undefined): boolean {
  if (!policy) return false;
  return Boolean(
    policy.dataSources.length ||
      policy.allowDomains.length ||
      policy.denyDomains.length ||
      policy.onlyUrls.length ||
      policy.publishedAfter ||
      policy.publishedBefore,
  );
}

export function formatSourcePolicy(policy: SourcePolicy | undefined): string {
  const next = policy ?? emptySourcePolicy();
  if (!sourcePolicyActive(next)) return "Sources off";
  const parts = [
    `Role: ${ROLE_LABELS[next.role] ?? next.role}`,
    `Data: ${next.dataSources.join(", ") || "none"}`,
  ];
  if (next.allowDomains.length) parts.push(`allow ${next.allowDomains.join(", ")}`);
  if (next.denyDomains.length) parts.push(`deny ${next.denyDomains.join(", ")}`);
  if (next.publishedAfter || next.publishedBefore) {
    parts.push(
      `dates ${next.publishedAfter ?? "…"}–${next.publishedBefore ?? "…"}`,
    );
  }
  if (next.onlyUrls.length) parts.push(`${next.onlyUrls.length} pinned URLs`);
  return parts.join(" · ");
}

export function sourcePolicyToSearchParams(policy: SourcePolicy): URLSearchParams {
  const params = new URLSearchParams();
  if (policy.allowDomains.length) params.set("allow", policy.allowDomains.join(","));
  if (policy.denyDomains.length) params.set("deny", policy.denyDomains.join(","));
  if (policy.publishedAfter) params.set("from", policy.publishedAfter);
  if (policy.publishedBefore) params.set("to", policy.publishedBefore);
  if (policy.role && policy.role !== "custom") params.set("role", policy.role);
  if (policy.role === "custom" && policy.dataSources.length) {
    params.set("data", policy.dataSources.join(","));
  }
  return params;
}

export function sourcePolicyFromSearchParams(
  params:
    | URLSearchParams
    | {
        allow?: string;
        deny?: string;
        from?: string;
        to?: string;
        role?: string;
        data?: string;
      },
): SourcePolicy {
  const get = (key: "allow" | "deny" | "from" | "to" | "role" | "data") =>
    params instanceof URLSearchParams ? (params.get(key) ?? "") : (params[key] ?? "");
  return normalizeSourcePolicy({
    allowDomains: parseDomainList(get("allow")),
    denyDomains: parseDomainList(get("deny")),
    publishedAfter: get("from") || undefined,
    publishedBefore: get("to") || undefined,
    role: get("role") || undefined,
    dataSources: get("data") || undefined,
  });
}

export function writeStoredSourcePolicy(policy: SourcePolicy) {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(SOURCE_POLICY_STORAGE_KEY, JSON.stringify(policy));
}

export function readStoredSourcePolicy(): SourcePolicy | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SOURCE_POLICY_STORAGE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(SOURCE_POLICY_STORAGE_KEY);
    return normalizeSourcePolicy(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function tavilyExcludeDomains(policy?: SourcePolicy): string[] {
  return [...DENIED_DOMAINS, ...(policy?.denyDomains ?? [])];
}

export function tavilyIncludeDomains(policy?: SourcePolicy): string[] | undefined {
  return policy?.allowDomains.length ? policy.allowDomains : undefined;
}

export function applySourcePolicy(
  results: SearchResult[],
  policy: SourcePolicy = emptySourcePolicy(),
): { results: SearchResult[]; dropped: DroppedSource[] } {
  const allowed: SearchResult[] = [];
  const dropped: DroppedSource[] = [];
  const only = new Set(policy.onlyUrls);

  for (const result of results) {
    const reason = dropReason(result, policy, only);
    if (reason) {
      dropped.push({ url: result.url, title: result.title, reason });
    } else {
      allowed.push(result);
    }
  }

  return { results: allowed, dropped };
}

export function mergeDropped(
  current: DroppedSource[],
  extra: DroppedSource[],
): DroppedSource[] {
  const seen = new Set(current.map((item) => item.url));
  const next = [...current];
  for (const item of extra) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    next.push(item);
  }
  return next;
}

export function summarizeDropped(dropped: DroppedSource[]): string {
  if (dropped.length === 0) return "";
  const counts = new Map<string, number>();
  for (const item of dropped) {
    counts.set(item.reason, (counts.get(item.reason) ?? 0) + 1);
  }
  const reasons = [...counts.entries()]
    .map(([reason, count]) => `${count} ${reason.replace(/_/g, " ")}`)
    .join(", ");
  return `Dropped ${dropped.length} sources (${reasons})`;
}

function dropReason(
  result: SearchResult,
  policy: SourcePolicy,
  only: Set<string>,
): DroppedSource["reason"] | null {
  if (only.size > 0 && !only.has(result.url)) return "not_in_url_list";
  if (hostIsDenied(result.url, policy.denyDomains)) return "denied";
  if (
    policy.allowDomains.length > 0 &&
    !policy.allowDomains.some((domain) => hostMatchesDomain(hostnameOf(result.url), domain))
  ) {
    return "not_allowlisted";
  }
  if (result.publishedAt && dateOutOfRange(result.publishedAt, policy)) {
    return "out_of_range";
  }
  return null;
}

function dateOutOfRange(publishedAt: string, policy: SourcePolicy): boolean {
  const day = normalizeDay(publishedAt);
  if (!day) return false;
  if (policy.publishedAfter && day < policy.publishedAfter) return true;
  if (policy.publishedBefore && day > policy.publishedBefore) return true;
  return false;
}

function normalizeDay(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return undefined;
  return new Date(parsed).toISOString().slice(0, 10);
}
