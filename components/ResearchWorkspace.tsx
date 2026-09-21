"use client";

import { PixelComposeMotif, formatElapsed } from "@/components/PixelComposeMotif";
import { AppShell } from "@/components/AppShell";
import { ChatPanel } from "@/components/ChatPanel";
import { EntityInfoPanel } from "@/components/EntityInfoPanel";
import { ModeBadge, ResearchStatus } from "@/components/ModeBadge";
import { ResearchFeed } from "@/components/ResearchFeed";
import { SearchBar } from "@/components/SearchBar";
import { DEMO_QUERY } from "@/lib/demo";
import { hasResearchIntent } from "@/lib/researchIntent";
import type {
  ChatTurn,
  Entity,
  EvidenceRecord,
  GraphQueryResponse,
  Relationship,
  ResearchEvent,
  RuntimeMode,
  SearchResult,
  Validation,
} from "@/lib/types";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const KnowledgeGraph = dynamic(
  () => import("@/components/KnowledgeGraph").then((m) => m.KnowledgeGraph),
  { ssr: false },
);

type Status = "idle" | "running" | "complete" | "error";

export function ResearchWorkspace() {
  const [query, setQuery] = useState(DEMO_QUERY);
  const [started, setStarted] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [mode, setMode] = useState<RuntimeMode | null>(null);
  const [jevStatus, setJevStatus] = useState<"jev" | "mock">("mock");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [validations, setValidations] = useState<Record<string, Validation>>({});
  const [evidence, setEvidence] = useState<Record<string, EvidenceRecord>>({});
  const [sources, setSources] = useState<SearchResult[]>([]);
  const [logs, setLogs] = useState<Extract<ResearchEvent, { type: "log" }>[]>([]);
  const [stats, setStats] = useState({ sources: 0, entities: 0, relationships: 0 });
  const [error, setError] = useState<string | null>(null);
  const [selectedRelationshipId, setSelectedRelationshipId] = useState<string | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [focusedEntityIds, setFocusedEntityIds] = useState<string[]>([]);
  const [focusedRelationshipIds, setFocusedRelationshipIds] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatTurn[]>([]);
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const runStartedAtRef = useRef<number | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  sessionIdRef.current = sessionId;

  const resetGraph = () => {
    setEntities([]);
    setRelationships([]);
    setValidations({});
    setEvidence({});
    setSources([]);
    setLogs([]);
    setStats({ sources: 0, entities: 0, relationships: 0 });
    setSelectedRelationshipId(null);
    setSelectedEntityId(null);
    setFocusedEntityIds([]);
    setFocusedRelationshipIds([]);
    setExpanded(false);
    setChatMessages([]);
    setQueryError(null);
    setError(null);
    setElapsedMs(null);
    runStartedAtRef.current = null;
  };

  const startNewGraph = () => {
    resetGraph();
    setSessionId(null);
    setStarted(false);
    setStatus("idle");
    setMode(null);
    setJevStatus("mock");
    setQuery(DEMO_QUERY);
  };

  const handleEvent = useCallback((event: ResearchEvent) => {
    switch (event.type) {
      case "session":
        setSessionId(event.sessionId);
        break;
      case "mode":
        setMode(event.mode);
        setJevStatus(event.jev);
        break;
      case "jev_status":
        setJevStatus(event.status);
        break;
      case "log":
        setLogs((current) => [...current, event]);
        break;
      case "source":
        setSources((current) =>
          current.some((s) => s.url === event.result.url)
            ? current
            : [...current, event.result],
        );
        break;
      case "entity":
        setEntities((current) =>
          current.some((e) => e.id === event.entity.id)
            ? current
            : [...current, event.entity],
        );
        break;
      case "relationship":
        setRelationships((current) =>
          current.some((r) => r.id === event.relationship.id)
            ? current
            : [...current, event.relationship],
        );
        break;
      case "validation":
        setValidations((current) => ({
          ...current,
          [event.relationshipId]: event.validation,
        }));
        setEvidence((current) => {
          const relId = event.relationshipId;
          const existing = current[relId];
          return {
            ...current,
            [relId]: {
              relationshipId: relId,
              claim: existing?.claim ?? "",
              snippet: existing?.snippet ?? "",
              sources: existing?.sources ?? [],
              validation: event.validation,
            },
          };
        });
        break;
      case "evidence":
        setEvidence((current) => ({
          ...current,
          [event.record.relationshipId]: event.record,
        }));
        break;
      case "stats":
        setStats({
          sources: event.sources,
          entities: event.entities,
          relationships: event.validations ?? event.relationships,
        });
        break;
      case "complete":
        setSessionId(event.sessionId);
        setStatus("complete");
        if (runStartedAtRef.current != null) {
          setElapsedMs(Date.now() - runStartedAtRef.current);
        }
        break;
      case "error":
        setError(event.message);
        setStatus("error");
        if (runStartedAtRef.current != null) {
          setElapsedMs(Date.now() - runStartedAtRef.current);
        }
        break;
    }
  }, []);

  useEffect(() => {
    if (status !== "running") return;
    const id = window.setInterval(() => {
      if (runStartedAtRef.current != null) {
        setElapsedMs(Date.now() - runStartedAtRef.current);
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [status]);

  const runResearchStream = async (
    nextQuery: string,
    options?: { preferExistingLinks?: boolean },
  ): Promise<string | null> => {
    const extending = Boolean(
      options?.preferExistingLinks && sessionId && entities.length > 0,
    );
    setStarted(true);
    setStatus("running");
    setError(null);
    if (extending) {
      setQueryError(null);
    } else {
      resetGraph();
    }
    runStartedAtRef.current = Date.now();
    setElapsedMs(0);

    let failMessage: string | null = null;
    try {
      const response = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: nextQuery,
          ...(extending && sessionId ? { sessionId } : {}),
          ...(options?.preferExistingLinks ? { preferExistingLinks: true } : {}),
        }),
      });
      if (!response.ok || !response.body) {
        let message = "Research request failed";
        try {
          const payload = (await response.json()) as { error?: string };
          if (payload.error) message = payload.error;
        } catch {
          /* keep default */
        }
        throw new Error(message);
      }
      await readSSE(response, (event) => {
        if (event.type === "error") failMessage = event.message;
        handleEvent(event);
      });
      return failMessage;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Research failed";
      setStatus("error");
      setError(message);
      if (runStartedAtRef.current != null) {
        setElapsedMs(Date.now() - runStartedAtRef.current);
      }
      return message;
    }
  };

  const runResearch = async () => {
    const nextQuery = query.trim();
    if (!nextQuery) return;
    await runResearchStream(nextQuery);
  };

  const selectedRelationship =
    relationships.find((r) => r.id === selectedRelationshipId) ?? null;

  const selectedEvidence = useMemo(() => {
    if (!selectedRelationship) return undefined;
    const stored = evidence[selectedRelationship.id];
    const relatedSources = sources.filter(
      (s) =>
        s.url === selectedRelationship.sourceUrl ||
        stored?.sources?.some((x) => x.url === s.url),
    );
    return {
      relationshipId: selectedRelationship.id,
      claim: selectedRelationship.claim,
      snippet:
        stored?.snippet ||
        selectedRelationship.evidenceSnippet ||
        relatedSources[0]?.snippet ||
        selectedRelationship.claim,
      sources: stored?.sources?.length ? stored.sources : relatedSources,
      validation:
        validations[selectedRelationship.id] ??
        stored?.validation ?? {
          decision: "PENDING",
          model: "mock" as const,
        },
    } satisfies EvidenceRecord;
  }, [selectedRelationship, evidence, sources, validations]);

  const selectEntity = useCallback(
    (id: string | null) => {
      setSelectedEntityId(id);
      setFocusedEntityIds(id ? [id] : []);
      setSelectedRelationshipId((current) => {
        if (!id || !current) return null;
        const rel = relationships.find((r) => r.id === current);
        if (rel && (rel.source === id || rel.target === id)) return current;
        return null;
      });
    },
    [relationships],
  );

  const selectRelationship = useCallback(
    (id: string | null, entityId?: string) => {
      if (!id) {
        setSelectedRelationshipId(null);
        return;
      }
      const rel = relationships.find((r) => r.id === id);
      if (!rel) return;
      const nextEntity = entityId ?? rel.source;
      setSelectedRelationshipId(id);
      setSelectedEntityId(nextEntity);
      setFocusedEntityIds([nextEntity]);
    },
    [relationships],
  );

  const askGraph = async (
    question: string,
    options: { extend?: boolean } = {},
  ) => {
    if (!sessionId) return;
    setQueryLoading(true);
    setQueryError(null);
    const userTurn: ChatTurn = {
      id: `user-${Date.now()}`,
      role: "user",
      text: question,
    };
    setChatMessages((current) => [...current, userTurn]);
    try {
      if (options.extend || hasResearchIntent(question)) {
        const failMessage = await runResearchStream(question, {
          preferExistingLinks: true,
        });
        if (failMessage) {
          setQueryError(failMessage);
          return;
        }
      }
      const queryId = sessionIdRef.current;
      if (!queryId) throw new Error("Research session not found");
      const response = await fetch(`/api/research/${queryId}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const payload = (await response.json()) as GraphQueryResponse & {
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "Query failed");
      setChatMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          text: payload.answer,
          model: payload.model,
          edgeReferences: payload.edgeReferences ?? [],
        },
      ]);
      setFocusedRelationshipIds(
        (payload.edgeReferences ?? []).map((r) => r.relationshipId),
      );
      setSelectedRelationshipId(null);
      setFocusedEntityIds(selectedEntityId ? [selectedEntityId] : []);
    } catch (err) {
      setQueryError(err instanceof Error ? err.message : "Query failed");
    } finally {
      setQueryLoading(false);
    }
  };

  return (
    <AppShell
      trailing={
        <>
          <ModeBadge mode={mode} jevStatus={jevStatus} />
          <ResearchStatus status={status} elapsedMs={elapsedMs} />
        </>
      }
    >
      {!started ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6">
          <SearchBar
            query={query}
            onQuery={setQuery}
            onSubmit={runResearch}
            disabled={status === "running"}
          />
        </div>
      ) : (
        <>
          <div className="shrink-0 border-b border-line px-4 py-2">
            <SearchBar
              query={query}
              onQuery={setQuery}
              onSubmit={runResearch}
              disabled={status === "running"}
              compact
              onNewGraph={startNewGraph}
            />
            {error && (
              <p className="mt-2 text-[12px] text-danger">{error}</p>
            )}
          </div>
          <div className="flex min-h-0 flex-1">
            <div className="relative min-h-0 min-w-0 flex-1">
              {entities.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
                  {status === "running" && (
                    <PixelComposeMotif className="pixel-compose-motif--lg" />
                  )}
                  <p className="text-[13px] text-dim">
                    {status === "running"
                      ? "Searching the live web and assembling a graph…"
                      : status === "error"
                        ? "Research stopped before a graph could be built."
                        : "No entities yet."}
                  </p>
                  {elapsedMs != null && status !== "idle" && (
                    <p className="font-mono text-[11px] text-dim">
                      {formatElapsed(elapsedMs)}
                    </p>
                  )}
                </div>
              ) : (
                <>
                  {status === "running" && (
                    <div className="pointer-events-none absolute right-4 top-12 z-10 flex items-center gap-3 border border-line bg-panel/90 px-3 py-2">
                      <PixelComposeMotif />
                      <div>
                        <div className="label">Composing</div>
                        <div className="font-mono text-[11px] text-dim">
                          {elapsedMs != null ? formatElapsed(elapsedMs) : "0ms"}
                        </div>
                      </div>
                    </div>
                  )}
                  {status === "complete" && elapsedMs != null && (
                    <div className="pointer-events-none absolute right-4 top-12 z-10 border border-line bg-panel/90 px-3 py-2 font-mono text-[11px] text-dim">
                      {formatElapsed(elapsedMs)}
                    </div>
                  )}
                  <KnowledgeGraph
                  entities={entities}
                  relationships={relationships}
                  validations={validations}
                  selectedRelationshipId={selectedRelationshipId}
                  selectedEntityId={selectedEntityId}
                  focusedEntityIds={focusedEntityIds}
                  focusedRelationshipIds={focusedRelationshipIds}
                  expanded={expanded}
                  onSelectRelationship={(id) => selectRelationship(id)}
                  onSelectEntity={selectEntity}
                  onToggleExpand={() => setExpanded((v) => !v)}
                  onResetSelection={() => {
                    selectEntity(null);
                    setFocusedRelationshipIds([]);
                    setExpanded(false);
                  }}
                />
                <EntityInfoPanel
                  entity={entities.find((e) => e.id === selectedEntityId) ?? null}
                  entities={entities}
                  relationships={relationships}
                  selectedRelationshipId={selectedRelationshipId}
                  evidence={selectedEvidence}
                  onClose={() => selectEntity(null)}
                  onSelectConnection={selectRelationship}
                />
                </>
              )}
            </div>
            <div className="h-full w-[340px] shrink-0">
              <ChatPanel
                disabled={status === "running" || !sessionId || entities.length === 0}
                onAsk={askGraph}
                messages={chatMessages}
                loading={queryLoading}
                error={queryError}
                selectedEntityId={selectedEntityId}
                selectedRelationshipId={selectedRelationshipId}
                onSelectEdge={(id) => selectRelationship(id)}
              />
            </div>
          </div>
          <ResearchFeed events={logs} stats={stats} sources={sources} />
        </>
      )}
    </AppShell>
  );
}

async function readSSE(
  response: Response,
  onEvent: (event: ResearchEvent) => void,
) {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk
        .split("\n")
        .find((entry) => entry.startsWith("data:"));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      onEvent(JSON.parse(payload) as ResearchEvent);
    }
  }
}
