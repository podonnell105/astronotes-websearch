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

export type Entity = {
  id: string;
  name: string;
  type: EntityType;
};

export type Relationship = {
  id: string;
  source: string;
  target: string;
  type: string;
  claim: string;
  sourceUrl?: string;
  evidenceSnippet?: string;
};

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
  edgeReferences?: GraphEdgeReference[];
};

export type Emit = (event: ResearchEvent) => void;
