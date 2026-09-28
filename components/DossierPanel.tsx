"use client";

import { buildDossier } from "@/lib/research/dossier";
import type { Entity, Relationship } from "@/lib/types";
import { useMemo } from "react";

export function DossierPanel({
  entities,
  relationships,
  selectedRelationshipId,
  onSelect,
}: {
  entities: Entity[];
  relationships: Relationship[];
  selectedRelationshipId: string | null;
  onSelect: (relationshipId: string) => void;
}) {
  const sections = useMemo(
    () => buildDossier({ entities, relationships }),
    [entities, relationships],
  );

  if (sections.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-[13px] text-dim">
        No dossier sections yet.
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-canvas px-5 py-5">
      <div className="label mb-4">Dossier</div>
      <div className="space-y-8">
        {sections.map((section) => (
          <section key={section.id}>
            <div className="label mb-3">{section.title}</div>
            <ul className="space-y-2">
              {section.items.map((item) => (
                <li key={`${section.id}-${item.relationshipId}`}>
                  <button
                    type="button"
                    onClick={() => onSelect(item.relationshipId)}
                    className={`w-full border px-3 py-2 text-left text-[13px] leading-5 ${
                      selectedRelationshipId === item.relationshipId
                        ? "border-line-strong text-ink"
                        : "border-line text-muted hover:text-ink"
                    }`}
                  >
                    <div>{item.claim}</div>
                    <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-dim">
                      {item.type}
                      {item.knowledge ? ` · ${item.knowledge}` : ""}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
