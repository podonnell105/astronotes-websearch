import { mutate, read } from "./db";
import { remoteSessionList, useRemoteStore } from "./remote";
import { emptySourcePolicy, hostIsDenied, normalizeSourcePolicy } from "./sources";
import type {
  ChatTurn,
  DroppedSource,
  EvidenceRecord,
  Entity,
  Relationship,
  ResearchEvent,
  RuntimeMode,
  SearchResult,
  SessionSummary,
  SessionView,
  SourcePolicy,
  Validation,
} from "./types";
import { normalizeRelationshipStatus } from "./types";

export type SessionRecord = {
  id: string;
  userId: string;
  query: string;
  queries: string[];
  mode: RuntimeMode;
  createdAt: number;
  frozenAt: number | null;
  entities: Map<string, Entity>;
  relationships: Map<string, Relationship>;
  validations: Map<string, Validation>;
  evidence: Map<string, EvidenceRecord>;
  sources: SearchResult[];
  sourcePolicy: SourcePolicy;
  droppedSources: DroppedSource[];
  events: ResearchEvent[];
  chat: ChatTurn[];
  status: "running" | "complete" | "error";
  jevStatus: "jev" | "mock";
};

type Payload = {
  queries: string[];
  entities: Entity[];
  relationships: Relationship[];
  validations: [string, Validation][];
  evidence: [string, EvidenceRecord][];
  sources: SearchResult[];
  sourcePolicy?: SourcePolicy;
  droppedSources?: DroppedSource[];
  events: ResearchEvent[];
  chat: ChatTurn[];
};

const memory = new Map<string, SessionRecord>();

const PERSIST_EVENTS = new Set([
  "session",
  "mode",
  "jev_status",
  "source",
  "entity",
  "relationship",
  "validation",
  "evidence",
  "dropped_sources",
  "complete",
  "error",
]);

export async function createSession(
  userId: string,
  query: string,
  mode: RuntimeMode,
  sourcePolicy: SourcePolicy = emptySourcePolicy(),
): Promise<SessionRecord> {
  const session: SessionRecord = {
    id: crypto.randomUUID(),
    userId,
    query,
    queries: [query],
    mode,
    createdAt: Date.now(),
    frozenAt: null,
    entities: new Map(),
    relationships: new Map(),
    validations: new Map(),
    evidence: new Map(),
    sources: [],
    sourcePolicy,
    droppedSources: [],
    events: [],
    chat: [],
    status: "running",
    jevStatus: mode === "live" ? "jev" : "mock",
  };
  memory.set(session.id, session);
  await persistSession(session);
  return session;
}

export async function resumeSession(
  id: string,
  query: string,
): Promise<SessionRecord | undefined> {
  const session = await getSession(id);
  if (!session) return undefined;
  session.status = "running";
  session.queries.push(query);
  await persistSession(session);
  return session;
}

export async function getSession(id: string): Promise<SessionRecord | undefined> {
  const cached = memory.get(id);
  if (cached) return cached;
  const loaded = await loadSession(id);
  if (loaded) memory.set(id, loaded);
  return loaded;
}

export function rememberEvent(session: SessionRecord, event: ResearchEvent) {
  session.events.push(event);
  if (session.events.length > 400) {
    session.events.splice(0, session.events.length - 400);
  }
  if (event.type === "complete" || event.type === "error") {
    session.frozenAt = Date.now();
  }
  if (PERSIST_EVENTS.has(event.type)) void persistSession(session);
}

export async function appendChat(session: SessionRecord, turns: ChatTurn[]) {
  session.chat.push(...turns);
  await persistSession(session);
}

export async function persistSession(session: SessionRecord) {
  const payload: Payload = {
    queries: session.queries,
    entities: [...session.entities.values()],
    relationships: [...session.relationships.values()],
    validations: [...session.validations.entries()],
    evidence: [...session.evidence.entries()],
    sources: session.sources,
    sourcePolicy: session.sourcePolicy,
    droppedSources: session.droppedSources,
    events: session.events,
    chat: session.chat,
  };
  await mutate((store) => {
    const row = {
      id: session.id,
      user_id: session.userId,
      query: session.query,
      status: session.status,
      mode: session.mode,
      jev_status: session.jevStatus,
      created_at: session.createdAt,
      frozen_at: session.frozenAt,
      sources: session.sources.length,
      entities: session.entities.size,
      relationships: session.relationships.size,
      validations: session.validations.size,
      payload: JSON.stringify(payload),
    };
    const index = store.research_sessions.findIndex((item) => item.id === session.id);
    if (index >= 0) store.research_sessions[index] = row;
    else store.research_sessions.push(row);
  });
}

export function toSessionView(session: SessionRecord): SessionView {
  const logs = session.events.filter(
    (event): event is Extract<ResearchEvent, { type: "log" }> => event.type === "log",
  );
  return {
    id: session.id,
    query: session.query,
    queries: session.queries,
    mode: session.mode,
    createdAt: session.createdAt,
    frozenAt: session.frozenAt,
    entities: [...session.entities.values()],
    relationships: [...session.relationships.values()],
    validations: Object.fromEntries(session.validations),
    evidence: Object.fromEntries(session.evidence),
    sources: session.sources,
    sourcePolicy: session.sourcePolicy,
    droppedSources: session.droppedSources,
    logs,
    chat: session.chat,
    status: session.status,
    jevStatus: session.jevStatus,
    stats: {
      sources: session.sources.length,
      entities: session.entities.size,
      relationships: session.relationships.size,
      validations: session.validations.size,
    },
  };
}

export function parseSessionView(raw: string): SessionView {
  const parsed = JSON.parse(raw) as SessionView;
  return {
    ...parsed,
    sourcePolicy: normalizeSourcePolicy(parsed.sourcePolicy),
    droppedSources: parsed.droppedSources ?? [],
  };
}

export async function listSessionsForUser(userId: string): Promise<SessionSummary[]> {
  if (useRemoteStore()) return remoteSessionList();
  return read((store) =>
    store.research_sessions
      .filter((row) => row.user_id === userId)
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, 50)
      .map((row) => ({
        id: row.id,
        query: row.query,
        createdAt: row.created_at,
        frozenAt: row.frozen_at,
        status: row.status,
        mode: row.mode,
        jevStatus: row.jev_status,
        sources: row.sources,
        entities: row.entities,
        relationships: row.relationships,
        validations: row.validations,
      })),
  );
}

async function loadSession(id: string): Promise<SessionRecord | undefined> {
  const row = await read((store) => store.research_sessions.find((item) => item.id === id));
  if (!row) return undefined;

  const payload = JSON.parse(row.payload) as Payload;
  return {
    id: row.id,
    userId: row.user_id,
    query: row.query,
    queries: payload.queries ?? [row.query],
    mode: row.mode,
    createdAt: row.created_at,
    frozenAt: row.frozen_at,
    entities: new Map((payload.entities ?? []).map((entity) => [entity.id, entity])),
    relationships: new Map(
      (payload.relationships ?? []).map((rel) => [
        rel.id,
        { ...rel, status: normalizeRelationshipStatus(rel.status) },
      ]),
    ),
    validations: new Map(payload.validations ?? []),
    evidence: new Map(
      (payload.evidence ?? []).map(([id, record]) => [
        id,
        {
          ...record,
          sources: (record.sources ?? []).filter((source) => !hostIsDenied(source.url)),
        },
      ]),
    ),
    sources: (payload.sources ?? []).filter((source) => !hostIsDenied(source.url)),
    sourcePolicy: normalizeSourcePolicy(payload.sourcePolicy),
    droppedSources: payload.droppedSources ?? [],
    events: payload.events ?? [],
    chat: payload.chat ?? [],
    status: row.status,
    jevStatus: row.jev_status,
  };
}
