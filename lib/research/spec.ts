import { detectJurisdictions, extractFocusSubjects } from "../researchPlan";
import type { Entity, Relationship } from "../types";
import {
  detectFacets,
  uniqueFacets,
  type FacetId,
} from "./facets";
import {
  detectObjective,
  rankFacetsForObjective,
  type ResearchObjective,
} from "./objectives";

export type ResearchIntent =
  | "understand"
  | "investigate"
  | "compare"
  | "find"
  | "trace"
  | "verify"
  | "discover";

export type ResearchDepth = "quick" | "standard" | "deep";

export type EntitySubjectRole = "subject" | "comparison" | "anchor";

export type EntityReference = {
  name: string;
  type?: string;
  role: EntitySubjectRole;
};

export type ResearchBudgets = {
  maxIterations: number;
  maxQueries: number;
  maxPages: number;
  maxDepth: number;
};

export type ResearchSpec = {
  question: string;
  subjects: EntityReference[];
  intent: ResearchIntent;
  objective: ResearchObjective;
  facets: FacetId[];
  timeRange?: { start?: string; end?: string };
  geography?: string[];
  constraints?: string[];
  requestedRelationships?: string[];
  depth: ResearchDepth;
  budgets: ResearchBudgets;
};

const COMPANY_HINT =
  /\b(inc|ltd|llc|corp|plc|gmbh|ag\b|company|companies|startup|organisation|organization)\b/i;
const PRODUCT_HINT = /\b(product|app\b|platform|tool)\b/i;
const PERSON_HINT =
  /\b(who is|person|founder|ceo|minister|mp\b|mla\b|politician|researcher)\b/i;
const SUBJECT_PREFIX = /^(person|company|product|organisation|organization|question)\s*:\s*/i;

export function budgetsForDepth(depth: ResearchDepth): ResearchBudgets {
  if (depth === "quick") {
    return { maxIterations: 1, maxQueries: 2, maxPages: 3, maxDepth: 1 };
  }
  if (depth === "deep") {
    return { maxIterations: 5, maxQueries: 8, maxPages: 4, maxDepth: 3 };
  }
  return { maxIterations: 3, maxQueries: 4, maxPages: 3, maxDepth: 2 };
}

export function detectIntent(question: string): ResearchIntent {
  if (/\bcompare\b|\bvs\.?\b|\bversus\b/i.test(question)) return "compare";
  if (/\bhow (is|are).+connected\b|\btrace\b/i.test(question)) return "trace";
  if (/\bverify\b|\bis it true\b/i.test(question)) return "verify";
  if (/\bfind (companies|people|investors)\b|\bcompanies like\b/i.test(question)) return "discover";
  if (/\bfind\b/i.test(question)) return "find";
  if (/\binvestigat|map (publicly )?documented/i.test(question)) return "investigate";
  return "understand";
}

export function detectDepth(question: string): ResearchDepth {
  if (/\b(deep|thorough|exhaustive|full dossier)\b/i.test(question)) return "deep";
  if (/\b(quick|brief|overview only)\b/i.test(question)) return "quick";
  return "standard";
}

export function inferSubjectType(name: string, question: string): string | undefined {
  const prefix = question.match(SUBJECT_PREFIX);
  if (prefix) {
    const kind = prefix[1].toLowerCase();
    if (kind === "person") return "person";
    if (kind === "company" || kind === "organisation" || kind === "organization") return "company";
    if (kind === "product") return "product";
  }
  if (COMPANY_HINT.test(name) || COMPANY_HINT.test(question)) return "company";
  if (PERSON_HINT.test(question) && !PRODUCT_HINT.test(question)) return "person";
  if (looksLikePersonName(name) && !COMPANY_HINT.test(question)) return "person";
  if (PRODUCT_HINT.test(question) && name.split(/\s+/).length <= 2) return "product";
  if (name.split(/\s+/).length === 1) return "company";
  return undefined;
}

function looksLikePersonName(name: string): boolean {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2 || parts.length > 4) return false;
  return parts.every((part) => /^[A-Z][a-zA-Z'’.-]+$/.test(part));
}

export function compileResearchSpec(
  question: string,
  session?: {
    spec?: ResearchSpec;
    entities?: Entity[];
    relationships?: Relationship[];
  },
): ResearchSpec {
  const existing = session?.spec;
  const cleaned = question.replace(SUBJECT_PREFIX, "").trim() || question.trim();
  const intent = detectIntent(cleaned);
  const objective = detectObjective(cleaned);
  const depth = detectDepth(cleaned);
  const mentioned = detectFacets(cleaned);
  const extracted = extractFocusSubjects(cleaned);
  const geography = detectJurisdictions(cleaned, extracted);
  const subjects = mergeSubjects(
    existing?.subjects ?? [],
    extracted.map((name, index) => ({
      name,
      type: inferSubjectType(name, question),
      role:
        intent === "compare" && index > 0
          ? "comparison"
          : intent === "trace" && index > 0
            ? "anchor"
            : "subject",
    })),
  );
  const entityTypes = uniqueStrings(
    subjects.map((subject) => subject.type).filter((type): type is string => Boolean(type)),
  );
  const ranked = rankFacetsForObjective(objective, entityTypes, mentioned);
  const facets = uniqueFacets([
    ...mentioned,
    ...(existing?.facets ?? []),
    ...ranked.slice(0, mentioned.length ? 10 : 8),
  ]);

  if (!existing) {
    return {
      question: cleaned,
      subjects,
      intent,
      objective,
      facets,
      geography: geography.length ? geography : undefined,
      depth,
      budgets: budgetsForDepth(depth),
    };
  }

  return {
    ...existing,
    question: cleaned,
    subjects: subjects.length ? subjects : existing.subjects,
    intent: intent === "understand" ? existing.intent : intent,
    objective: objective === "understand" ? existing.objective : objective,
    facets: uniqueFacets([...existing.facets, ...facets]),
    geography: uniqueStrings([...(existing.geography ?? []), ...geography]),
    depth: existing.depth === "deep" || depth === "deep" ? "deep" : existing.depth,
    budgets: budgetsForDepth(
      existing.depth === "deep" || depth === "deep" ? "deep" : existing.depth,
    ),
  };
}

function mergeSubjects(existing: EntityReference[], incoming: EntityReference[]): EntityReference[] {
  const out: EntityReference[] = [];
  const seen = new Set<string>();
  for (const subject of [...incoming, ...existing]) {
    const key = subject.name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(subject);
  }
  return out.slice(0, 6);
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.trim();
    if (!key) continue;
    const lower = key.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(key);
  }
  return out;
}
