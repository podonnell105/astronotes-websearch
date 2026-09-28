import { IDENTIFIER_SCHEMES, makeEntity } from "../ontology";
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
  const row = data?.results?.bindings?.[0];
  if (!row?.item?.value) return emptyFragment();

  const qid = row.item.value.replace("http://www.wikidata.org/entity/", "");
  const label = row.itemLabel?.value || name;
  const identifiers: EntityIdentifier[] = [{ scheme: IDENTIFIER_SCHEMES.wikidata, value: qid }];
  let jurisdiction: string | undefined;
  if (row.parliament?.value) {
    identifiers.push({ scheme: IDENTIFIER_SCHEMES.parliamentMember, value: row.parliament.value });
    jurisdiction = "GB";
  }
  if (row.bioguide?.value) {
    identifiers.push({ scheme: IDENTIFIER_SCHEMES.bioguide, value: row.bioguide.value });
    jurisdiction = jurisdiction ?? "US";
  }
  if (row.mep?.value) {
    identifiers.push({ scheme: IDENTIFIER_SCHEMES.europarlMep, value: row.mep.value });
    jurisdiction = jurisdiction ?? "EU";
  }
  if (row.oireachtas?.value) {
    identifiers.push({ scheme: IDENTIFIER_SCHEMES.oireachtasMember, value: row.oireachtas.value });
    jurisdiction = jurisdiction ?? "IE";
  }
  if (row.lei?.value) {
    identifiers.push({ scheme: IDENTIFIER_SCHEMES.lei, value: row.lei.value });
  }

  const entity = makeEntity({
    name: label,
    type: "person",
    kind: "person",
    identifiers,
    jurisdiction,
    id: label,
  });
  const urlRecord = `https://www.wikidata.org/wiki/${qid}`;
  return {
    entities: [entity],
    relationships: [],
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

function sparql(name: string): string {
  const escaped = name.replace(/"/g, '\\"');
  return `
SELECT ?item ?itemLabel ?parliament ?bioguide ?mep ?oireachtas ?lei WHERE {
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
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 5`.trim();
}
