"use client";

import { AccountHeader } from "@/components/AccountHeader";
import { AppShell } from "@/components/AppShell";
import { ChatPanel } from "@/components/ChatPanel";
import { ClaimTable } from "@/components/ClaimTable";
import { EntityInfoPanel } from "@/components/EntityInfoPanel";
import { ModeBadge, ResearchStatus } from "@/components/ModeBadge";
import { PixelComposeMotif, formatElapsed } from "@/components/PixelComposeMotif";
import { ResearchFeed } from "@/components/ResearchFeed";
import { SearchBar } from "@/components/SearchBar";
import { buildPackCsv, buildPackMarkdown } from "@/lib/pack";
import { formatAsOf } from "@/lib/claims";
import { hasResearchIntent } from "@/lib/researchIntent";
import { DEFAULT_QUERY } from "@/lib/templates";
import type {
  AuthUser,
  ChatTurn,
  Entity,
  EvidenceRecord,
  GraphQueryResponse,
  Relationship,
  ResearchEvent,
  RuntimeMode,
  SearchResult,
  SessionView,
  Validation,
} from "@/lib/types";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const KnowledgeGraph = dynamic(
  () => import("@/components/KnowledgeGraph").then((m) => m.KnowledgeGraph),
  { ssr: false },
);

type Status = "idle" | "running" | "complete" | "error";
type MainView = "graph" | "claims";

function applyView(session: SessionView) {
  return {
    query: session.query,
    started: true,
    status: session.status as Status,
    mode: session.mode,
    jevStatus: session.jevStatus,
    sessionId: session.id,
    entities: session.entities,
    relationships: session.relationships,
    validations: session.validations,
    evidence: session.evidence,
    sources: session.sources,
    logs: session.logs,
    stats: session.stats,
    chat: session.chat,
    frozenAt: session.frozenAt ?? session.createdAt,
  };
}

export function ResearchWorkspace({
  user,
  stripeEnabled = false,
  initialSession = null,
  initialQuery,
  autoStart = false,
  readOnly = false,
}: {
  user?: AuthUser | null;
  stripeEnabled?: boolean;
  initialSession?: SessionView | null;
  initialQuery?: string;
  autoStart?: boolean;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const seeded = initialSession ? applyView(initialSession) : null;
  const [query, setQuery] = useState(seeded?.query ?? initialQuery ?? DEFAULT_QUERY);
  const [started, setStarted] = useState(Boolean(seeded));
  const [status, setStatus] = useState<Status>(seeded?.status ?? "idle");
  const [mode, setMode] = useState<RuntimeMode | null>(seeded?.mode ?? null);
  const [jevStatus, setJevStatus] = useState<"jev" | "mock">(seeded?.jevStatus ?? "mock");
  const [sessionId, setSessionId] = useState<string | null>(seeded?.sessionId ?? null);
  const [entities, setEntities] = useState<Entity[]>(seeded?.entities ?? []);
  const [relationships, setRelationships] = useState<Relationship[]>(
    seeded?.relationships ?? [],
  );
  const [validations, setValidations] = useState<Record<string, Validation>>(
    seeded?.validations ?? {},
  );
  const [evidence, setEvidence] = useState<Record<string, EvidenceRecord>>(
    seeded?.evidence ?? {},
  );
  const [sources, setSources] = useState<SearchResult[]>(seeded?.sources ?? []);
  const [logs, setLogs] = useState<Extract<ResearchEvent, { type: "log" }>[]>(
    seeded?.logs ?? [],
  );
  const [stats, setStats] = useState(
    seeded?.stats ?? { sources: 0, entities: 0, relationships: 0, validations: 0 },
  );
  const [error, setError] = useState<string | null>(null);
  const [selectedRelationshipId, setSelectedRelationshipId] = useState<string | null>(
    null,
  );
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [focusedEntityIds, setFocusedEntityIds] = useState<string[]>([]);
  const [focusedRelationshipIds, setFocusedRelationshipIds] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatTurn[]>(seeded?.chat ?? []);
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [view, setView] = useState<MainView>(
    seeded && seeded.status === "complete" && seeded.relationships.length > 0
      ? "claims"
      : "graph",
  );
  const [frozenAt, setFrozenAt] = useState<number | null>(seeded?.frozenAt ?? null);
  const [createdAt, setCreatedAt] = useState<number | null>(
    initialSession?.createdAt ?? null,
  );
  const [credits, setCredits] = useState(user?.credits ?? 0);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const runStartedAtRef = useRef<number | null>(null);
  const sessionIdRef = useRef<string | null>(sessionId);
  const autoStarted = useRef(false);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const resetGraph = () => {
    setEntities([]);
    setRelationships([]);
    setValidations({});
    setEvidence({});
    setSources([]);
    setLogs([]);
    setStats({ sources: 0, entities: 0, relationships: 0, validations: 0 });
    setSelectedRelationshipId(null);
    setSelectedEntityId(null);
    setFocusedEntityIds([]);
    setFocusedRelationshipIds([]);
    setExpanded(false);
    setChatMessages([]);
    setQueryError(null);
    setError(null);
    setElapsedMs(null);
    setFrozenAt(null);
    setView("graph");
    runStartedAtRef.current = null;
    setCreatedAt(null);
  };

  const startNewGraph = () => {
    router.push("/");
  };

  const refreshCredits = async () => {
    const response = await fetch("/api/auth/me");
    const payload = (await response.json()) as { user?: AuthUser | null };
    if (payload.user) setCredits(payload.user.credits);
  };

  const handleEvent = useCallback((event: ResearchEvent) => {
    switch (event.type) {
      case "session":
        setSessionId(event.sessionId);
        if (typeof window !== "undefined" && window.location.pathname.startsWith("/r/")) {
          window.history.replaceState(null, "", `/r/${event.sessionId}`);
        }
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
          validations: event.validations ?? event.relationships,
        });
        break;
      case "complete":
        setSessionId(event.sessionId);
        setStatus("complete");
        setFrozenAt(Date.now());
        setView("claims");
        if (runStartedAtRef.current != null) {
          setElapsedMs(Date.now() - runStartedAtRef.current);
        }
        void refreshCredits();
        break;
      case "error":
        setError(event.message);
        setStatus("error");
        if (runStartedAtRef.current != null) {
          setElapsedMs(Date.now() - runStartedAtRef.current);
        }
        void refreshCredits();
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
    setView("graph");
    setError(null);
    if (extending) {
      setQueryError(null);
    } else {
      resetGraph();
      setCreatedAt(Date.now());
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

  useEffect(() => {
    if (!autoStart || initialSession) return;
    const next = (initialQuery ?? query).trim();
    if (!next) return;
    const timer = window.setTimeout(() => {
      if (autoStarted.current) return;
      autoStarted.current = true;
      void runResearchStream(next);
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, initialSession, initialQuery]);

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

  const exportPack = async (format: "md" | "csv") => {
    if (readOnly) {
      const view: SessionView = {
        id: sessionId ?? "share",
        query,
        queries: [query],
        mode: mode ?? "demo",
        createdAt: frozenAt ?? Date.now(),
        frozenAt,
        entities,
        relationships,
        validations,
        evidence,
        sources,
        logs,
        chat: chatMessages,
        status: status === "idle" ? "complete" : status,
        jevStatus,
        stats,
      };
      const text = format === "csv" ? buildPackCsv(view) : buildPackMarkdown(view);
      const blob = new Blob([text], {
        type: format === "csv" ? "text/csv; charset=utf-8" : "text/markdown; charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download =
        format === "csv" ? "astronotes-share.csv" : "astronotes-share.md";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      return;
    }
    if (!sessionId) return;
    const response = await fetch(`/api/research/${sessionId}/export?format=${format}`);
    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setError(payload.error || "Export failed");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download =
      format === "csv"
        ? `astronotes-${sessionId.slice(0, 8)}.csv`
        : `astronotes-${sessionId.slice(0, 8)}.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const sharePack = async () => {
    if (!sessionId) return;
    const response = await fetch(`/api/research/${sessionId}/share`, { method: "POST" });
    const payload = (await response.json()) as { urlPath?: string; error?: string };
    if (!response.ok || !payload.urlPath) {
      setShareNotice(payload.error || "Share failed");
      return;
    }
    const url = `${window.location.origin}${payload.urlPath}`;
    try {
      await navigator.clipboard.writeText(url);
      setShareNotice("Share link copied");
    } catch {
      setShareNotice(url);
    }
  };

  const accountUser = user ? { ...user, credits } : null;
  const asOfStamp = frozenAt ?? createdAt;

  return (
    <AppShell
      trailing={
        <>
          {started && asOfStamp != null && (
            <span className="hidden font-mono text-[10px] uppercase tracking-[0.12em] text-dim lg:inline">
              As of {formatAsOf({ frozenAt: asOfStamp, createdAt: asOfStamp })}
            </span>
          )}
          <ModeBadge mode={mode} jevStatus={jevStatus} />
          <ResearchStatus status={status} elapsedMs={elapsedMs} />
          {accountUser && !readOnly && (
            <AccountHeader user={accountUser} stripeEnabled={stripeEnabled} />
          )}
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
            showTemplates
          />
        </div>
      ) : (
        <>
          {!readOnly && (
            <div className="shrink-0 border-b border-line px-4 py-2">
              <SearchBar
                query={query}
                onQuery={setQuery}
                onSubmit={runResearch}
                disabled={status === "running"}
                compact
                onNewGraph={startNewGraph}
              />
              {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
            </div>
          )}
          {readOnly && (
            <div className="shrink-0 border-b border-line px-4 py-3">
              <div className="label">Shared evidence pack</div>
              <p className="mt-1 text-[13px] text-ink">{query}</p>
            </div>
          )}
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2">
            <button
              type="button"
              onClick={() => setView("graph")}
              className={`border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${
                view === "graph"
                  ? "border-line-strong text-ink"
                  : "border-line text-muted hover:text-ink"
              }`}
            >
              Graph
            </button>
            <button
              type="button"
              onClick={() => setView("claims")}
              className={`border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${
                view === "claims"
                  ? "border-line-strong text-ink"
                  : "border-line text-muted hover:text-ink"
              }`}
            >
              Claims
            </button>
            {(readOnly || sessionId) && (
              <>
                <button
                  type="button"
                  onClick={() => void exportPack("md")}
                  disabled={relationships.length === 0}
                  className={`${readOnly ? "ml-auto" : "ml-auto"} border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted hover:text-ink disabled:opacity-40`}
                >
                  Export md
                </button>
                <button
                  type="button"
                  onClick={() => void exportPack("csv")}
                  disabled={relationships.length === 0}
                  className="border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted hover:text-ink disabled:opacity-40"
                >
                  Export csv
                </button>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => void sharePack()}
                    disabled={relationships.length === 0}
                    className="border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted hover:text-ink disabled:opacity-40"
                  >
                    Share
                  </button>
                )}
              </>
            )}
            {shareNotice && (
              <span className="font-mono text-[10px] text-live">{shareNotice}</span>
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
              ) : view === "claims" ? (
                <ClaimTable
                  entities={entities}
                  relationships={relationships}
                  validations={validations}
                  evidence={evidence}
                  sources={sources}
                  selectedRelationshipId={selectedRelationshipId}
                  onSelect={(id) => {
                    selectRelationship(id);
                    setView("graph");
                  }}
                />
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
            {!readOnly && (
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
            )}
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
