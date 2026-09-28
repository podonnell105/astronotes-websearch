import type { AnalystRole, DataSourceId } from "./dataCatalog";

export type EntityType = string;

export const ENTITY_TYPES = [
  "person",
  "organization",
  "company",
  "office",
  "legislation",
  "sector",
  "technology",
  "mission",
  "location",
  "product",
  "spacecraft",
  "concept",
  "service",
  "event",
  "process",
] as const;

export const ENTITY_KINDS = [
  "person",
  "organization",
  "company",
  "office",
  "legislation",
  "sector",
] as const;

export type EntityKind = (typeof ENTITY_KINDS)[number];

export type EntityIdentifier = {
  scheme: string;
  value: string;
};

export const RELATIONSHIP_BASES = ["recorded", "extracted", "inferred"] as const;
export type RelationshipBasis = (typeof RELATIONSHIP_BASES)[number];

export const POLITICAL_PREDICATES = [
  "holds_office",
  "member_of",
  "declared_interest",
  "officer_of",
  "psc_of",
  "parent_of",
  "donated_to",
  "lobbied_on",
  "sponsored",
  "voted_on",
  "spoke_on",
  "questioned",
  "awarded_contract",
  "classified_as",
  "same_as",
  "possible_overlap",
] as const;

export type PoliticalPredicate = (typeof POLITICAL_PREDICATES)[number];

export const INTEREST_CATEGORIES = [
  "employment",
  "shareholding",
  "directorship",
  "gift",
  "visit",
  "other",
] as const;

export type InterestCategory = (typeof INTEREST_CATEGORIES)[number];

export type Provenance = {
  sourceId?: string;
  recordUrl?: string;
  externalId?: string;
  fieldPath?: string;
  fetchedAt?: string;
};

export type ReasoningStep = {
  order: number;
  relationshipId: string;
  text: string;
};

export type ReasoningChain = {
  ruleId: string;
  premiseIds: string[];
  steps: ReasoningStep[];
  disclaimer: string;
};

const ENTITY_TYPE_CHIPS: Record<string, string> = {
  person: "PER",
  organization: "ORG",
  company: "CO",
  office: "OFF",
  legislation: "BILL",
  sector: "SEC",
  technology: "TECH",
  mission: "MSN",
  location: "LOC",
  product: "PRD",
  spacecraft: "SC",
  concept: "CON",
  service: "SVC",
  event: "EVT",
  process: "PRC",
};

const TYPE_ALIASES: Record<string, string> = {
  org: "organization",
  organisation: "organization",
  organizations: "organization",
  corp: "company",
  corporation: "company",
  companies: "company",
  tech: "technology",
  loc: "location",
  svc: "service",
  people: "person",
  persons: "person",
  products: "product",
  missions: "mission",
  concepts: "concept",
  services: "service",
  events: "event",
  processes: "process",
  politician: "person",
  mp: "person",
  mla: "person",
  mep: "person",
  senator: "person",
  bill: "legislation",
  act: "legislation",
  statute: "legislation",
  industry: "sector",
  post: "office",
};

export function normalizeEntityType(value: unknown): EntityType {
  const words = String(value ?? "")
    .trim()
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length >= 2);
  if (words.length === 0) return "concept";
  const preferred = words.find((word) =>
    (ENTITY_TYPES as readonly string[]).includes(TYPE_ALIASES[word] ?? word),
  );
  const picked = preferred ?? words[words.length - 1];
  return TYPE_ALIASES[picked] ?? picked;
}

export function entityTypeChip(type: string): string {
  const key = normalizeEntityType(type);
  if (ENTITY_TYPE_CHIPS[key]) return ENTITY_TYPE_CHIPS[key];
  return key.slice(0, 4).toUpperCase() || "ENT";
}

export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
  source?: string;
  publishedAt?: string;
};

export type SourcePolicy = {
  allowDomains: string[];
  denyDomains: string[];
  publishedAfter?: string;
  publishedBefore?: string;
  onlyUrls: string[];
  role: AnalystRole;
  dataSources: DataSourceId[];
};

export type DroppedReason =
  | "denied"
  | "not_allowlisted"
  | "out_of_range"
  | "not_in_url_list"
  | "failed_fetch"
  | "irrelevant";

export type DroppedSource = {
  url: string;
  title?: string;
  reason: DroppedReason;
};

export type Entity = {
  id: string;
  name: string;
  type: EntityType;
  kind?: EntityKind;
  identifiers?: EntityIdentifier[];
  jurisdiction?: string;
};

export type RelationshipStatus = "deployed" | "announced" | "unclear";

export type EpisodeTime = {
  start: string;
  end?: string;
  estimated?: boolean;
};

export type Relationship = {
  id: string;
  source: string;
  target: string;
  type: string;
  claim: string;
  status: RelationshipStatus;
  sourceUrl?: string;
  evidenceSnippet?: string;
  time?: EpisodeTime;
  basis?: RelationshipBasis;
  category?: InterestCategory | string;
  estimated?: boolean;
  unresolved?: boolean;
  reasoning?: ReasoningChain;
  provenance?: Provenance;
};

export function normalizeRelationshipBasis(value: unknown): RelationshipBasis {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "recorded" || raw === "extracted" || raw === "inferred") return raw;
  return "extracted";
}

export function normalizeRelationshipStatus(value: unknown): RelationshipStatus {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "deployed" || raw === "announced" || raw === "unclear") return raw;
  return "unclear";
}

export type ValidationDecision = "SUPPORTED" | "CONTRADICTED" | "UNCERTAIN";

export function normalizeEntityKind(value: unknown, type?: string): EntityKind | undefined {
  const raw = String(value ?? type ?? "")
    .trim()
    .toLowerCase();
  if ((ENTITY_KINDS as readonly string[]).includes(raw)) return raw as EntityKind;
  if (raw === "organisation" || raw === "org") return "organization";
  if (raw === "bill" || raw === "act" || raw === "statute") return "legislation";
  if (raw === "industry") return "sector";
  if (raw === "post" || raw === "seat") return "office";
  return undefined;
}

export type ValidatorModel = "jev" | "mock" | "register" | "rule";

export type Validation = {
  decision: string;
  confidence?: number;
  model: ValidatorModel;
  probabilities?: Record<string, number>;
  jevModelVersion?: string;
};

export type EvidenceRecord = {
  relationshipId: string;
  claim: string;
  snippet: string;
  sources: SearchResult[];
  validation: Validation;
};

export type RuntimeMode = "live" | "partial" | "demo";

export type SearchProvider = "tavily" | "openai" | "mock";

export type ResearchEvent =
  | {
      type: "session";
      sessionId: string;
    }
  | {
      type: "mode";
      mode: RuntimeMode;
      search: SearchProvider;
      jev: "jev" | "mock";
    }
  | {
      type: "jev_status";
      status: "jev" | "mock";
      reason?: string;
    }
  | {
      type: "log";
      timestamp: string;
      message: string;
    }
  | {
      type: "source";
      result: SearchResult;
    }
  | {
      type: "entity";
      entity: Entity;
    }
  | {
      type: "relationship";
      relationship: Relationship;
    }
  | {
      type: "validation";
      relationshipId: string;
      validation: Validation;
    }
  | {
      type: "evidence";
      record: EvidenceRecord;
    }
  | {
      type: "stats";
      sources: number;
      entities: number;
      relationships: number;
      validations?: number;
    }
  | {
      type: "dropped_sources";
      policy: SourcePolicy;
      dropped: DroppedSource[];
    }
  | {
      type: "graph";
      entities: Entity[];
      relationships: Relationship[];
    }
  | {
      type: "complete";
      sessionId: string;
    }
  | {
      type: "error";
      message: string;
    };

export type GraphQueryReference = {
  entityId: string;
  name: string;
};

export type GraphEdgeReference = {
  relationshipId: string;
  type: string;
  sourceId: string;
  targetId: string;
  sourceName: string;
  targetName: string;
};

export type GraphQueryResponse = {
  answer: string;
  references: GraphQueryReference[];
  edgeReferences: GraphEdgeReference[];
  model: "openai" | "mock";
};

export type ChatTurn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  model?: "openai" | "mock";
  references?: GraphQueryReference[];
  edgeReferences?: GraphEdgeReference[];
};

export type Emit = (event: ResearchEvent) => void;

export type SessionView = {
  id: string;
  query: string;
  queries: string[];
  mode: RuntimeMode;
  createdAt: number;
  frozenAt: number | null;
  entities: Entity[];
  relationships: Relationship[];
  validations: Record<string, Validation>;
  evidence: Record<string, EvidenceRecord>;
  sources: SearchResult[];
  sourcePolicy: SourcePolicy;
  droppedSources: DroppedSource[];
  logs: Extract<ResearchEvent, { type: "log" }>[];
  chat: ChatTurn[];
  status: "running" | "complete" | "error";
  jevStatus: "jev" | "mock";
  stats: {
    sources: number;
    entities: number;
    relationships: number;
    validations: number;
  };
};

export type SessionSummary = {
  id: string;
  query: string;
  createdAt: number;
  frozenAt: number | null;
  status: "running" | "complete" | "error";
  mode: RuntimeMode;
  jevStatus: "jev" | "mock";
  sources: number;
  entities: number;
  relationships: number;
  validations: number;
};

export type AuthUser = {
  id: string;
  email: string;
  credits: number;
};
