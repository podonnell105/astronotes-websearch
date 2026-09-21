import type { DataSourceId } from "./dataCatalog";
import { DATA_CATALOG, DATA_SOURCE_IDS } from "./dataCatalog";
import type { RuntimeMode, SearchProvider } from "./types";

export function hasOpenAI(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
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
  const companiesHouse = Boolean(process.env.COMPANIES_HOUSE_API_KEY?.trim());
  const patents = Boolean(process.env.PATENTSVIEW_API_KEY?.trim());
  const sam = Boolean(process.env.SAM_API_KEY?.trim());
  const sanctions = Boolean(process.env.OPENSANCTIONS_API_KEY?.trim());
  const availability = {} as Record<DataSourceId, boolean>;
  for (const id of DATA_SOURCE_IDS) {
    const def = DATA_CATALOG.find((item) => item.id === id);
    if (def?.needsEnv === "COMPANIES_HOUSE_API_KEY") availability[id] = companiesHouse;
    else if (def?.needsEnv === "PATENTSVIEW_API_KEY") availability[id] = patents;
    else if (def?.needsEnv === "SAM_API_KEY") availability[id] = sam;
    else if (def?.needsEnv === "OPENSANCTIONS_API_KEY") availability[id] = sanctions;
    else availability[id] = true;
  }
  return availability;
}

export function availableDataSources(): DataSourceId[] {
  const availability = dataSourceAvailability();
  return DATA_SOURCE_IDS.filter((id) => availability[id]);
}
