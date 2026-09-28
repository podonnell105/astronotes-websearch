import {
  IDENTIFIER_SCHEMES,
  makeEntity,
  recordedRelationship,
  sourceFromProvenance,
} from "../ontology";
import { sectorFromSic } from "./sectors";
import { politicalGetJson } from "./http";
import { companiesHouseApiKey, companiesHouseSkipReason } from "../config";
import type { PoliticalFragment } from "./types";
import { emptyFragment, mergeFragments } from "./types";

const CH_SEARCH = "https://api.company-information.service.gov.uk/search/companies";
const CH_COMPANY = "https://api.company-information.service.gov.uk/company";
const GLEIF_URL = "https://api.gleif.org/api/v1/lei-records";

export async function lookupCompanyAssertions(names: string[]): Promise<PoliticalFragment> {
  const parts = await Promise.all([
    lookupCompaniesHouseAssertions(names),
    lookupGleifAssertions(names),
  ]);
  return mergeFragments(parts);
}

export async function lookupCompaniesHouseAssertions(names: string[]): Promise<PoliticalFragment> {
  const apiKey = companiesHouseApiKey();
  if (!apiKey) {
    return { ...emptyFragment(), skipped: [companiesHouseSkipReason()] };
  }
  const auth = Buffer.from(`${apiKey}:`).toString("base64");
  const parts: PoliticalFragment[] = [];
  for (const name of names.slice(0, 4)) {
    const data = await politicalGetJson<{
      items?: Array<{
        company_number?: string;
        title?: string;
        company_status?: string;
        company_type?: string;
        date_of_creation?: string;
      }>;
    }>(`${CH_SEARCH}?q=${encodeURIComponent(name)}&items_per_page=1`, {
      Authorization: `Basic ${auth}`,
    });
    const item = data?.items?.[0];
    const number = String(item?.company_number ?? "").trim();
    if (!number) continue;
    parts.push(await companyRecord(number, item?.title || name, auth, item?.date_of_creation));
  }
  return mergeFragments(parts);
}

async function companyRecord(
  number: string,
  fallbackName: string,
  auth: string,
  incorporated?: string,
): Promise<PoliticalFragment> {
  const profile = await politicalGetJson<{
    company_name?: string;
    company_number?: string;
    company_status?: string;
    sic_codes?: string[];
    type?: string;
    date_of_creation?: string;
  }>(`${CH_COMPANY}/${number}`, { Authorization: `Basic ${auth}` });
  const name = profile?.company_name || fallbackName;
  const url = `https://find-and-update.company-information.service.gov.uk/company/${number}`;
  const company = makeEntity({
    name,
    type: "company",
    kind: "company",
    jurisdiction: "GB",
    identifiers: [{ scheme: IDENTIFIER_SCHEMES.companiesHouse, value: number }],
    id: `company-${number}`,
  });
  const snippet = [
    `Companies House ${number} — ${name}.`,
    profile?.company_status ? `Status ${profile.company_status}.` : "",
    (profile?.sic_codes ?? []).length ? `SIC ${(profile?.sic_codes ?? []).join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const entities = [company];
  const relationships = [];
  for (const code of profile?.sic_codes ?? []) {
    const sector = sectorFromSic(code);
    if (!sector) continue;
    const sectorEntity = makeEntity({
      name: `${sector.label} (SIC ${code})`,
      type: "sector",
      kind: "sector",
      id: sector.id,
    });
    entities.push(sectorEntity);
    relationships.push(
      recordedRelationship({
        source: company.id,
        target: sectorEntity.id,
        type: "classified_as",
        claim: `${name} is classified under SIC ${code} (${sector.label}).`,
        sourceUrl: url,
        evidenceSnippet: snippet,
        extraId: code,
        provenance: {
          sourceId: "companies_house",
          externalId: number,
          fieldPath: `sic_codes.${code}`,
        },
      }),
    );
  }

  const officers = await politicalGetJson<{
    items?: Array<{ name?: string; officer_role?: string; appointed_on?: string; resigned_on?: string }>;
  }>(`${CH_COMPANY}/${number}/officers?items_per_page=12`, { Authorization: `Basic ${auth}` });
  for (const officer of officers?.items ?? []) {
    if (officer.resigned_on) continue;
    const officerName = String(officer.name ?? "").trim();
    if (!officerName) continue;
    const person = makeEntity({
      name: officerName,
      type: "person",
      kind: "person",
      jurisdiction: "GB",
      id: officerName,
    });
    entities.push(person);
    relationships.push(
      recordedRelationship({
        source: person.id,
        target: company.id,
        type: "officer_of",
        claim: `${officerName} is a recorded ${officer.officer_role || "officer"} of ${name}.`,
        sourceUrl: `${url}/officers`,
        evidenceSnippet: `${officerName} appointed as ${officer.officer_role || "officer"}${officer.appointed_on ? ` on ${officer.appointed_on}` : ""}.`,
        extraId: officer.officer_role,
        time: officer.appointed_on ? { start: officer.appointed_on } : undefined,
        provenance: {
          sourceId: "companies_house",
          externalId: number,
          fieldPath: "officers",
        },
      }),
    );
  }

  const pscs = await politicalGetJson<{
    items?: Array<{ name?: string; kind?: string; natures_of_control?: string[] }>;
  }>(`${CH_COMPANY}/${number}/persons-with-significant-control?items_per_page=8`, {
    Authorization: `Basic ${auth}`,
  });
  for (const psc of pscs?.items ?? []) {
    const pscName = String(psc.name ?? "").trim();
    if (!pscName) continue;
    const holder = makeEntity({
      name: pscName,
      type: psc.kind?.includes("corporate") ? "company" : "person",
      kind: psc.kind?.includes("corporate") ? "company" : "person",
      jurisdiction: "GB",
      id: pscName,
    });
    entities.push(holder);
    relationships.push(
      recordedRelationship({
        source: holder.id,
        target: company.id,
        type: "psc_of",
        claim: `${pscName} is a person with significant control of ${name}.`,
        sourceUrl: `${url}/persons-with-significant-control`,
        evidenceSnippet: `${pscName} PSC${psc.natures_of_control?.length ? `: ${psc.natures_of_control.join(", ")}` : ""}.`,
        provenance: {
          sourceId: "companies_house",
          externalId: number,
          fieldPath: "persons-with-significant-control",
        },
      }),
    );
  }

  return {
    entities,
    relationships,
    sources: [sourceFromProvenance(`${name} (${number})`, url, snippet, "companieshouse.gov.uk", incorporated)],
    skipped: [],
  };
}

export async function lookupGleifAssertions(names: string[]): Promise<PoliticalFragment> {
  const entities = [];
  const relationships = [];
  const sources = [];
  for (const name of names.slice(0, 3)) {
    const data = await politicalGetJson<{
      data?: Array<{
        id?: string;
        attributes?: {
          entity?: {
            legalName?: { name?: string };
            legalAddress?: { country?: string };
          };
        };
        relationships?: { "direct-parent"?: { data?: { id?: string } | null } };
      }>;
    }>(`${GLEIF_URL}?filter[entity.legalName]=${encodeURIComponent(name)}&page[size]=1`, {
      Accept: "application/vnd.api+json",
    });
    const record = data?.data?.[0];
    const lei = String(record?.id ?? "").trim();
    if (!lei) continue;
    const legalName = record?.attributes?.entity?.legalName?.name || name;
    const country = record?.attributes?.entity?.legalAddress?.country || "";
    const url = `https://search.gleif.org/#/record/${lei}`;
    const company = makeEntity({
      name: legalName,
      type: "company",
      kind: "company",
      jurisdiction: country || undefined,
      identifiers: [{ scheme: IDENTIFIER_SCHEMES.lei, value: lei }],
      id: `lei-${lei}`,
    });
    entities.push(company);
    const snippet = `GLEIF LEI ${lei} for ${legalName}${country ? ` (${country})` : ""}.`;
    sources.push(sourceFromProvenance(`LEI ${lei} — ${legalName}`, url, snippet, "gleif.org"));
    const parentLei = record?.relationships?.["direct-parent"]?.data?.id;
    if (parentLei) {
      const parent = makeEntity({
        name: `LEI ${parentLei}`,
        type: "company",
        kind: "company",
        identifiers: [{ scheme: IDENTIFIER_SCHEMES.lei, value: parentLei }],
        id: `lei-${parentLei}`,
      });
      entities.push(parent);
      relationships.push(
        recordedRelationship({
          source: parent.id,
          target: company.id,
          type: "parent_of",
          claim: `GLEIF records LEI ${parentLei} as the direct parent of ${legalName}.`,
          sourceUrl: url,
          evidenceSnippet: snippet,
          provenance: { sourceId: "gleif", externalId: lei, fieldPath: "relationships.direct-parent" },
        }),
      );
    }
  }
  return { entities, relationships, sources, skipped: [] };
}
