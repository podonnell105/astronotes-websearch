import type { AnalystRole, DataSourceId } from "./dataCatalog";

export type EntityType = string;

export const ENTITY_TYPES = [
  "person",
  "organization",
  "company",
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

const ENTITY_TYPE_CHIPS: Record<string, string> = {
  person: "PER",
  organization: "ORG",
  company: "CO",
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
};

export function normalizeRelationshipStatus(value: unknown): RelationshipStatus {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "deployed" || raw === "announced" || raw === "unclear") return raw;
  return "unclear";
}

export type ValidationDecision = "SUPPORTED" | "CONTRADICTED" | "UNCERTAIN";

export type Validation = {
  decision: string;
  confidence?: number;
  model: "jev" | "mock";
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

export type QueryTemplate = {
  id: "landscape" | "counterparty" | "audit";
  label: string;
  query: string;
};
