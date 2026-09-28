import {
  IDENTIFIER_SCHEMES,
  makeEntity,
  recordedRelationship,
  sourceFromProvenance,
} from "../ontology";
import { politicalGetJson } from "./http";
import type { PoliticalAdapterInput, PoliticalFragment } from "./types";
import { emptyFragment } from "./types";

export async function lookupEuroparl(input: PoliticalAdapterInput): Promise<PoliticalFragment> {
  const name = input.subject.person?.name || input.subject.names[0] || input.query;
  const mepId = input.subject.person?.identifiers?.find(
    (item) => item.scheme === IDENTIFIER_SCHEMES.europarlMep,
  )?.value;

  const url = mepId
    ? `https://data.europarl.europa.eu/api/v2/meps/${encodeURIComponent(mepId)}?format=application/ld+json`
    : `https://data.europarl.europa.eu/api/v2/meps?name=${encodeURIComponent(name)}&format=application/ld+json`;
  const data = await politicalGetJson<unknown>(url);
  const rows = asMeps(data);
  const hit = rows[0];
  if (!hit) return emptyFragment();

  const display = hit.label || name;
  const id = hit.id || mepId || display;
  const person = makeEntity({
    name: display,
    type: "person",
    kind: "person",
    jurisdiction: "EU",
    identifiers: [{ scheme: IDENTIFIER_SCHEMES.europarlMep, value: String(id) }],
    id: display,
  });
  const office = makeEntity({
    name: "Member of the European Parliament",
    type: "office",
    kind: "office",
    jurisdiction: "EU",
    id: "office-eu-mep",
  });
  const group = hit.group
    ? makeEntity({
        name: hit.group,
        type: "organization",
        kind: "organization",
        jurisdiction: "EU",
        id: hit.group,
      })
    : undefined;
  const profile = hit.homepage || `https://www.europarl.europa.eu/meps/en/${id}`;
  const entities = [person, office, ...(group ? [group] : [])];
  const relationships = [
    recordedRelationship({
      source: person.id,
      target: office.id,
      type: "holds_office",
      claim: `${display} holds office as a Member of the European Parliament.`,
      sourceUrl: profile,
      evidenceSnippet: `${display} is listed in European Parliament open data.`,
      provenance: { sourceId: "europarl", externalId: String(id), fieldPath: "meps" },
    }),
  ];
  if (group) {
    relationships.push(
      recordedRelationship({
        source: person.id,
        target: group.id,
        type: "member_of",
        claim: `${display} is a member of ${hit.group}.`,
        sourceUrl: profile,
        evidenceSnippet: `Political group: ${hit.group}.`,
        provenance: { sourceId: "europarl", externalId: String(id), fieldPath: "politicalGroup" },
      }),
    );
  }
  return {
    entities,
    relationships,
    sources: [
      sourceFromProvenance(
        `${display} — European Parliament`,
        profile,
        `${display}, MEP${hit.group ? `, ${hit.group}` : ""}.`,
        "europarl.europa.eu",
      ),
    ],
    skipped: [],
  };
}

function asMeps(data: unknown): Array<{ id?: string; label?: string; group?: string; homepage?: string }> {
  if (!data || typeof data !== "object") return [];
  const rec = data as Record<string, unknown>;
  const list = Array.isArray(rec.data)
    ? rec.data
    : Array.isArray(rec.meps)
      ? rec.meps
      : Array.isArray(rec["@graph"])
        ? rec["@graph"]
        : [rec];
  return list.slice(0, 5).map((item) => {
    const row = item as Record<string, unknown>;
    const label =
      pickLabel(row.label) ||
      pickLabel(row.name) ||
      (typeof row.familyName === "string" ? String(row.familyName) : undefined);
    const id =
      typeof row.id === "string"
        ? row.id
        : typeof row.identifier === "string"
          ? row.identifier
          : typeof row["@id"] === "string"
            ? String(row["@id"]).split("/").pop()
            : undefined;
    const group =
      pickLabel(row.politicalGroup) ||
      pickLabel(row.group) ||
      (typeof row.euPoliticalGroup === "string" ? row.euPoliticalGroup : undefined);
    const homepage = typeof row.homepage === "string" ? row.homepage : undefined;
    return { id, label, group, homepage };
  }).filter((row) => row.label);
}

function pickLabel(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "label" in value) {
    return pickLabel((value as { label?: unknown }).label);
  }
  if (Array.isArray(value) && value[0]) return pickLabel(value[0]);
  return undefined;
}
