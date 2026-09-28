import type { DataSourceId } from "./dataCatalog";
import { DATA_CATALOG, DATA_SOURCE_IDS } from "./dataCatalog";
import type { RuntimeMode, SearchProvider } from "./types";

export function hasOpenAI(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function isOpenAIAuthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /401|api key has expired|invalid_api_key|incorrect api key|invalid api key/i.test(
    message,
  );
}

export function hasTavily(): boolean {
  return Boolean(process.env.TAVILY_API_KEY?.trim());
}

export function getJevApiKey(): string | undefined {
  const key =
    process.env.JEV_API_KEY?.trim() || process.env.TYPESAFE_API_KEY?.trim();
  return key || undefined;
}

export function hasJev(): boolean {
  return Boolean(getJevApiKey());
}

const OAUTH_CLIENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function companiesHouseApiKey(): string | undefined {
  const key = process.env.COMPANIES_HOUSE_API_KEY?.trim();
  if (!key || OAUTH_CLIENT_ID.test(key)) return undefined;
  return key;
}

export function companiesHouseSkipReason(): string {
  const raw = process.env.COMPANIES_HOUSE_API_KEY?.trim();
  if (raw && OAUTH_CLIENT_ID.test(raw)) {
    return "Companies House skipped (need a REST API key, not a web OAuth client)";
  }
  return "Companies House skipped (no API key)";
}

export function detectRuntime(): {
  mode: RuntimeMode;
  search: SearchProvider;
  jev: "jev" | "mock";
} {
  const openai = hasOpenAI();
  const jev = hasJev();
  const search: SearchProvider = !openai
    ? "mock"
    : hasTavily()
      ? "tavily"
      : "openai";
  if (!openai) {
    return { mode: "demo", search, jev: "mock" };
  }
  if (!jev) {
    return { mode: "partial", search, jev: "mock" };
  }
  return { mode: "live", search, jev: "jev" };
}

export function nowStamp(): string {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

export function dataSourceAvailability(): Record<DataSourceId, boolean> {
  const companiesHouse = Boolean(companiesHouseApiKey());
  const patents = Boolean(process.env.PATENTSVIEW_API_KEY?.trim());
  const sam = Boolean(process.env.SAM_API_KEY?.trim());
  const sanctions = Boolean(process.env.OPENSANCTIONS_API_KEY?.trim());
  const congress = Boolean(
    process.env.CONGRESS_GOV_API_KEY?.trim() || process.env.DATA_GOV_API_KEY?.trim(),
  );
  const availability = {} as Record<DataSourceId, boolean>;
  for (const id of DATA_SOURCE_IDS) {
    const def = DATA_CATALOG.find((item) => item.id === id);
    if (def?.needsEnv === "COMPANIES_HOUSE_API_KEY") availability[id] = companiesHouse;
    else if (def?.needsEnv === "PATENTSVIEW_API_KEY") availability[id] = patents;
    else if (def?.needsEnv === "SAM_API_KEY") availability[id] = sam;
    else if (def?.needsEnv === "OPENSANCTIONS_API_KEY") availability[id] = sanctions;
    else if (def?.needsEnv === "CONGRESS_GOV_API_KEY") availability[id] = congress;
    else availability[id] = true;
  }
  return availability;
}

export function availableDataSources(): DataSourceId[] {
  const availability = dataSourceAvailability();
  return DATA_SOURCE_IDS.filter((id) => availability[id]);
}
