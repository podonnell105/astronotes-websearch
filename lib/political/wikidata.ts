import { IDENTIFIER_SCHEMES, makeEntity, recordedRelationship } from "../ontology";
import type { EntityIdentifier } from "../types";
import { politicalGetJson } from "./http";
import type { PoliticalFragment } from "./types";
import { emptyFragment } from "./types";

type WikidataBinding = Record<string, { value?: string } | undefined>;

export async function lookupWikidataPerson(name: string): Promise<PoliticalFragment> {
  const query = sparql(name);
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`;
  const data = await politicalGetJson<{
    results?: { bindings?: WikidataBinding[] };
  }>(url, { Accept: "application/sparql-results+json" });
  const rows = data?.results?.bindings ?? [];
  const row = rows.find((item) => item.item?.value) ?? rows[0];
  if (!row?.item?.value) return emptyFragment();

  const qid = row.item.value.replace("http://www.wikidata.org/entity/", "");
  const label = row.itemLabel?.value || name;
  const identifiers: EntityIdentifier[] = [{ scheme: IDENTIFIER_SCHEMES.wikidata, value: qid }];
  const countries = unique(
    rows.flatMap((item) => (item.countryLabel?.value ? [item.countryLabel.value] : [])),
  );
  const parties = unique(
    rows.flatMap((item) => (item.partyLabel?.value ? [item.partyLabel.value] : [])),
  );
  const positions = unique(
    rows.flatMap((item) => (item.positionLabel?.value ? [item.positionLabel.value] : [])),
  );
  if (row.parliament?.value) {
    identifiers.push({ scheme: IDENTIFIER_SCHEMES.parliamentMember, value: row.parliament.value });
  }
  if (row.bioguide?.value) {
    identifiers.push({ scheme: IDENTIFIER_SCHEMES.bioguide, value: row.bioguide.value });
  }
  if (row.mep?.value) {
    identifiers.push({ scheme: IDENTIFIER_SCHEMES.europarlMep, value: row.mep.value });
  }
  if (row.oireachtas?.value) {
    identifiers.push({ scheme: IDENTIFIER_SCHEMES.oireachtasMember, value: row.oireachtas.value });
  }
  if (row.lei?.value) {
    identifiers.push({ scheme: IDENTIFIER_SCHEMES.lei, value: row.lei.value });
  }

  const jurisdiction = jurisdictionFrom(countries, parties, positions, identifiers);
  const entity = makeEntity({
    name: label,
    type: "person",
    kind: "person",
    identifiers,
    jurisdiction,
    id: label,
  });
  const extras = parties.map((party) =>
    makeEntity({
      name: party,
      type: "organization",
      kind: "organization",
      jurisdiction: jurisdiction === "US" ? "US" : "GB",
      id: party,
    }),
  );
  const urlRecord = `https://www.wikidata.org/wiki/${qid}`;
  return {
    entities: [entity, ...extras],
    relationships: extras.map((party) =>
      recordedRelationship({
        source: entity.id,
        target: party.id,
        type: "member_of",
        claim: `${label} is a member of ${party.name}.`,
        sourceUrl: urlRecord,
        evidenceSnippet: `Wikidata lists ${party.name} as a political party for ${label}.`,
        provenance: { sourceId: "wikidata", externalId: qid, fieldPath: "wdt:P102" },
      }),
    ),
    sources: [
      {
        title: `${label} — Wikidata`,
        url: urlRecord,
        snippet: `Wikidata ${qid} used as a crosswalk between official member identifiers. Not a source of political facts.`,
        source: "wikidata.org",
      },
    ],
    skipped: [],
  };
}

function jurisdictionFrom(
  countries: string[],
  parties: string[],
  positions: string[],
  identifiers: EntityIdentifier[],
): string | undefined {
  const hay = [...countries, ...parties, ...positions].join(" ").toLowerCase();
  if (identifiers.some((item) => item.scheme === IDENTIFIER_SCHEMES.bioguide)) return "US";
  if (/\bunited states\b/.test(hay) && !/\bunited kingdom\b|\bireland\b|\bnorthern ireland\b/.test(hay)) {
    return "US";
  }
  if (identifiers.some((item) => item.scheme === IDENTIFIER_SCHEMES.europarlMep) && !/\bunited kingdom\b|\bireland\b/.test(hay)) {
    return "EU";
  }
  if (
    /\bnorthern ireland\b/.test(hay) ||
    /\bsinn f/.test(hay) ||
    identifiers.some((item) => item.scheme === IDENTIFIER_SCHEMES.niAssemblyMember)
  ) {
    return "GB";
  }
  if (identifiers.some((item) => item.scheme === IDENTIFIER_SCHEMES.parliamentMember) || /\bunited kingdom\b/.test(hay)) {
    return "GB";
  }
  if (identifiers.some((item) => item.scheme === IDENTIFIER_SCHEMES.oireachtasMember) || /\bireland\b/.test(hay)) {
    return "IE";
  }
  return undefined;
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.trim();
    if (!key || seen.has(key.toLowerCase())) continue;
    seen.add(key.toLowerCase());
    out.push(key);
  }
  return out;
}

function sparql(name: string): string {
  const escaped = name.replace(/"/g, '\\"');
  return `
SELECT ?item ?itemLabel ?parliament ?bioguide ?mep ?oireachtas ?lei ?countryLabel ?partyLabel ?positionLabel WHERE {
  SERVICE wikibase:mwapi {
    bd:serviceParam wikibase:api "EntitySearch" .
    bd:serviceParam wikibase:endpoint "www.wikidata.org" .
    bd:serviceParam mwapi:search "${escaped}" .
    bd:serviceParam mwapi:language "en" .
    ?item wikibase:apiOutputItem mwapi:item .
  }
  OPTIONAL { ?item wdt:P6213 ?parliament }
  OPTIONAL { ?item wdt:P1157 ?bioguide }
  OPTIONAL { ?item wdt:P1186 ?mep }
  OPTIONAL { ?item wdt:P4690 ?oireachtas }
  OPTIONAL { ?item wdt:P1278 ?lei }
  OPTIONAL { ?item wdt:P27 ?country }
  OPTIONAL { ?item wdt:P102 ?party }
  OPTIONAL { ?item wdt:P39 ?position }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 8`.trim();
}
