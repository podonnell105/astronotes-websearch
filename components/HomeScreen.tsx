"use client";

import { AccountHeader } from "@/components/AccountHeader";
import { AppShell } from "@/components/AppShell";
import { SearchBar } from "@/components/SearchBar";
import {
  emptySourcePolicy,
  sourcePolicyToSearchParams,
  writeStoredSourcePolicy,
} from "@/lib/sources";
import type { AuthUser, SessionSummary, SourcePolicy } from "@/lib/types";
import type { DataSourceId } from "@/lib/dataCatalog";
import { DEFAULT_AVAILABLE_SOURCES } from "@/lib/dataCatalog";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function HomeScreen({
  user,
  stripeEnabled,
  graphs,
  availableDataSources = DEFAULT_AVAILABLE_SOURCES,
}: {
  user: AuthUser;
  stripeEnabled: boolean;
  graphs: SessionSummary[];
  availableDataSources?: DataSourceId[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [policy, setPolicy] = useState<SourcePolicy>(emptySourcePolicy());

  const start = () => {
    const next = query.trim();
    if (!next) return;
    writeStoredSourcePolicy(policy);
    const params = sourcePolicyToSearchParams(policy);
    params.set("q", next);
    router.push(`/r/new?${params.toString()}`);
  };

  return (
    <AppShell trailing={<AccountHeader user={user} stripeEnabled={stripeEnabled} />}>
      <div className="min-h-0 flex-1 overflow-auto px-6 py-16">
        <SearchBar
          query={query}
          onQuery={setQuery}
          onSubmit={start}
          policy={policy}
          onPolicy={setPolicy}
          availableDataSources={availableDataSources}
        />
        <div className="mx-auto mt-16 w-full max-w-2xl">
          <div className="label mb-3">Saved graphs</div>
          {graphs.length === 0 ? (
            <p className="text-[13px] text-dim">
              No research yet. Ask a question to start a graph.
            </p>
          ) : (
            <ul className="divide-y divide-line border border-line">
              {graphs.map((graph) => (
                <li key={graph.id}>
                  <button
                    type="button"
                    onClick={() => router.push(`/r/${graph.id}`)}
                    className="flex w-full items-start justify-between gap-4 px-4 py-3 text-left hover:bg-panel-2"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] text-ink">
                        {graph.query}
                      </span>
                      <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.12em] text-dim">
                        {asOf(graph.frozenAt ?? graph.createdAt)} · {graph.entities} entities ·{" "}
                        {graph.relationships} claims
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                      {graph.status}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function asOf(stamp: number) {
  return new Date(stamp).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}