"use client";

import { AccountHeader } from "@/components/AccountHeader";
import { AppShell } from "@/components/AppShell";
import { SearchBar } from "@/components/SearchBar";
import { DEFAULT_QUERY } from "@/lib/templates";
import type { AuthUser, SessionSummary } from "@/lib/types";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function HomeScreen({
  user,
  stripeEnabled,
  graphs,
}: {
  user: AuthUser;
  stripeEnabled: boolean;
  graphs: SessionSummary[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState(DEFAULT_QUERY);

  const start = () => {
    const next = query.trim();
    if (!next) return;
    router.push(`/r/new?q=${encodeURIComponent(next)}`);
  };

  return (
    <AppShell trailing={<AccountHeader user={user} stripeEnabled={stripeEnabled} />}>
      <div className="min-h-0 flex-1 overflow-auto px-6 py-16">
        <SearchBar
          query={query}
          onQuery={setQuery}
          onSubmit={start}
          showTemplates
        />
        <div className="mx-auto mt-16 w-full max-w-2xl">
          <div className="label mb-3">Saved graphs</div>
          {graphs.length === 0 ? (
            <p className="text-[13px] text-dim">
              No research yet. Start with a landscape, counterparty, or claim-audit query.
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