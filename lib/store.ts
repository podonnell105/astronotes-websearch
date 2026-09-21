import type {
  EvidenceRecord,
  Entity,
  Relationship,
  ResearchEvent,
  RuntimeMode,
  SearchResult,
  Validation,
} from "./types";

export type SessionRecord = {
  id: string;
  query: string;
  queries: string[];
  mode: RuntimeMode;
  createdAt: number;
  entities: Map<string, Entity>;
  relationships: Map<string, Relationship>;
  validations: Map<string, Validation>;
  evidence: Map<string, EvidenceRecord>;
  sources: SearchResult[];
  events: ResearchEvent[];
  status: "running" | "complete" | "error";
  jevStatus: "jev" | "mock";
};

const sessions = new Map<string, SessionRecord>();

export function createSession(query: string, mode: RuntimeMode): SessionRecord {
  const session: SessionRecord = {
    id: crypto.randomUUID(),
    query,
    queries: [query],
    mode,
    createdAt: Date.now(),
    entities: new Map(),
    relationships: new Map(),
    validations: new Map(),
    evidence: new Map(),
    sources: [],
    events: [],
    status: "running",
    jevStatus: mode === "live" ? "jev" : "mock",
  };
  sessions.set(session.id, session);
  return session;
}

export function resumeSession(id: string, query: string): SessionRecord | undefined {
  const session = sessions.get(id);
  if (!session) return undefined;
  session.status = "running";
  session.queries.push(query);
  return session;
}

export function getSession(id: string): SessionRecord | undefined {
  return sessions.get(id);
}

export function rememberEvent(session: SessionRecord, event: ResearchEvent) {
  session.events.push(event);
  if (session.events.length > 400) {
    session.events.splice(0, session.events.length - 400);
  }
}
