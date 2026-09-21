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
