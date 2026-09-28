import {
  IDENTIFIER_SCHEMES,
  makeEntity,
  recordedRelationship,
  sourceFromProvenance,
} from "../ontology";
import { politicalGetJson } from "./http";
import { sameName } from "./names";
import type { PoliticalAdapterInput, PoliticalFragment } from "./types";
import { emptyFragment, mergeFragments } from "./types";

export async function lookupDonationsAndLobbying(
  input: PoliticalAdapterInput,
): Promise<PoliticalFragment> {
  const enabled = new Set(input.sources);
  const want = (id: (typeof input.sources)[number]) => enabled.size === 0 || enabled.has(id);
  const jurisdiction = (input.subject.person?.jurisdiction ?? "").toUpperCase();
  const skipUs = jurisdiction === "GB" || jurisdiction === "NI" || jurisdiction === "IE" || jurisdiction === "EU";
  const parts: Array<Promise<PoliticalFragment>> = [];
  if (want("electoral_commission")) parts.push(lookupElectoralCommission(input));
  if (want("openfec") && !skipUs) parts.push(lookupFec(input));
  if (want("senate_lda") && !skipUs) parts.push(lookupLda(input));
  if (want("eu_transparency")) parts.push(lookupEuTransparency(input));
  if (want("lobbying_ie")) parts.push(lookupLobbyingIe(input));
  if (parts.length === 0) return emptyFragment();
  return mergeFragments(await Promise.all(parts));
}

async function lookupElectoralCommission(input: PoliticalAdapterInput): Promise<PoliticalFragment> {
  const personName = input.subject.person?.name || input.subject.names[0] || input.query;
  const queries = uniqueNames([
    personName,
    ...input.existing
      .filter((entity) => entity.kind === "organization" || entity.type === "organization")
      .map((entity) => entity.name)
      .filter((name) =>
        /party|sinn|f[eé]in|labour|conservative|dup|alliance|uup|sdlp|green party|reform/i.test(
          name,
        ),
      ),
    ...input.subject.names.filter((name) =>
      /party|sinn|f[eé]in|labour|conservative|dup|alliance/i.test(name),
    ),
  ]).slice(0, 3);

  const fragments: PoliticalFragment[] = [];
  for (const name of queries) {
    fragments.push(await searchElectoralCommission(name, input));
  }
  return mergeFragments(fragments);
}

async function searchElectoralCommission(
  name: string,
  input: PoliticalAdapterInput,
): Promise<PoliticalFragment> {
  const data = await politicalGetJson<{
    Result?: Array<{
      ECRef?: string;
      DonorName?: string;
      RegulatedEntityName?: string;
      Value?: string;
      AcceptedDate?: string;
      DonorStatus?: string;
    }>;
    result?: Array<Record<string, string>>;
  }>(
    `https://search.electoralcommission.org.uk/api/search/Donations?query=${encodeURIComponent(name)}&sort=AcceptedDate&order=desc&et=pp,ppm,tp,perpar,rd`,
  );
  const rows = data?.Result ?? data?.result ?? [];
  if (rows.length === 0) return emptyFragment();
  const entities = [];
  const relationships = [];
  const sources = [];
  const personId = input.subject.person?.id;
  const personName = input.subject.person?.name || input.subject.names[0] || "";
  for (const row of rows.slice(0, 8)) {
    const rec = row as Record<string, string | undefined>;
    const donor = String(rec.DonorName ?? rec.donorName ?? "").trim();
    const entityName = String(rec.RegulatedEntityName ?? rec.regulatedEntityName ?? name).trim();
    if (!donor) continue;
    const donorEntity = makeEntity({
      name: donor,
      type: "organization",
      kind: "organization",
      jurisdiction: "GB",
      id: donor,
    });
    const recipient = makeEntity({
      name: entityName,
      type: "organization",
      kind: "organization",
      jurisdiction: "GB",
      id: entityName,
    });
    entities.push(donorEntity, recipient);
    const url = `https://search.electoralcommission.org.uk/Search/Donations?currentPage=1&query=${encodeURIComponent(name)}`;
    const value = rec.Value ?? rec.value ?? "";
    const date = rec.AcceptedDate ?? rec.acceptedDate;
    const snippet = `${donor} donated ${value || "an amount"} to ${entityName}${date ? ` (accepted ${date})` : ""}.`;
    const last = personName.toLowerCase().split(" ").slice(-1)[0] || "";
    const targetId =
      personId && last && entityName.toLowerCase().includes(last) ? personId : recipient.id;
    relationships.push(
      recordedRelationship({
        source: donorEntity.id,
        target: targetId,
        type: "donated_to",
        claim: snippet,
        sourceUrl: url,
        evidenceSnippet: snippet,
        extraId: rec.ECRef ?? value,
        time: date ? { start: String(date).slice(0, 10) } : undefined,
        provenance: {
          sourceId: "uk_electoral_commission",
          externalId: rec.ECRef,
          fieldPath: "Donations.DonorName",
        },
      }),
    );
    sources.push(sourceFromProvenance(`Donation ${rec.ECRef || donor}`, url, snippet, "electoralcommission.org.uk", date));
  }
  return { entities, relationships, sources, skipped: [] };
}

function uniqueNames(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const name = value.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

async function lookupFec(input: PoliticalAdapterInput): Promise<PoliticalFragment> {
  const key = process.env.FEC_API_KEY?.trim() || "DEMO_KEY";
  const name = input.subject.person?.name || input.subject.names[0] || input.query;
  const candidates = await politicalGetJson<{
    results?: Array<{ candidate_id?: string; name?: string; party_full?: string; office_full?: string }>;
  }>(`https://api.open.fec.gov/v1/candidates/search/?q=${encodeURIComponent(name)}&api_key=${key}&per_page=5`);
  const candidate = candidates?.results?.find((row) => row.name && sameName(row.name, name));
  if (!candidate?.candidate_id) return emptyFragment();
  const person = makeEntity({
    name: candidate.name || name,
    type: "person",
    kind: "person",
    jurisdiction: "US",
    identifiers: [{ scheme: IDENTIFIER_SCHEMES.fecCandidate, value: candidate.candidate_id }],
    id: candidate.name || name,
  });
  const receipts = await politicalGetJson<{
    results?: Array<{
      contributor_name?: string;
      contribution_receipt_amount?: number;
      contribution_receipt_date?: string;
      contributor_employer?: string;
      pdf_url?: string;
    }>;
  }>(
    `https://api.open.fec.gov/v1/schedules/schedule_a/?candidate_id=${candidate.candidate_id}&api_key=${key}&per_page=6&sort=-contribution_receipt_amount&is_individual=false`,
  );
  const entities = [person];
  const relationships = [];
  const sources = [];
  for (const row of receipts?.results ?? []) {
    const donorName = String(row.contributor_name ?? row.contributor_employer ?? "").trim();
    if (!donorName) continue;
    const donor = makeEntity({
      name: donorName,
      type: "organization",
      kind: "organization",
      jurisdiction: "US",
      id: donorName,
    });
    entities.push(donor);
    const url =
      row.pdf_url ||
      `https://www.fec.gov/data/candidate/${candidate.candidate_id}/`;
    const snippet = `${donorName} reported a contribution of ${row.contribution_receipt_amount ?? "an amount"} to ${person.name}${row.contribution_receipt_date ? ` on ${row.contribution_receipt_date}` : ""}.`;
    relationships.push(
      recordedRelationship({
        source: donor.id,
        target: person.id,
        type: "donated_to",
        claim: snippet,
        sourceUrl: url,
        evidenceSnippet: snippet,
        extraId: String(row.contribution_receipt_amount ?? donorName),
        time: row.contribution_receipt_date ? { start: row.contribution_receipt_date } : undefined,
        provenance: {
          sourceId: "openfec",
          externalId: candidate.candidate_id,
          fieldPath: "schedules.schedule_a.contributor_name",
        },
      }),
    );
    sources.push(
      sourceFromProvenance(
        `FEC ${candidate.candidate_id}`,
        url,
        snippet,
        "fec.gov",
        row.contribution_receipt_date,
      ),
    );
  }
  return { entities, relationships, sources, skipped: [] };
}

async function lookupLda(input: PoliticalAdapterInput): Promise<PoliticalFragment> {
  const name = input.subject.person?.name || input.subject.names[0] || input.query;
  const data = await politicalGetJson<{
    results?: Array<{
      url?: string;
      registrant?: { name?: string };
      lobbying_activities?: Array<{ lobbyist?: { last_name?: string; first_name?: string }; general_issue_code?: string }>;
      clients?: Array<{ name?: string }>;
    }>;
  }>(`https://lda.senate.gov/api/v1/filings/?filing_uuid=&search=${encodeURIComponent(name)}`);
  const rows = data?.results ?? [];
  if (rows.length === 0) return emptyFragment();
  const entities = [];
  const relationships = [];
  const sources = [];
  const personId = input.subject.person?.id;
  for (const row of rows.slice(0, 6)) {
    const registrant = row.registrant?.name;
    const client = row.clients?.[0]?.name || registrant;
    if (!client) continue;
    const org = makeEntity({
      name: client,
      type: "organization",
      kind: "organization",
      jurisdiction: "US",
      id: client,
    });
    entities.push(org);
    const issue = row.lobbying_activities?.[0]?.general_issue_code || "US federal lobbying";
    const url = row.url || "https://lda.senate.gov/system/public/";
    const snippet = `${client} is recorded on a Senate LDA filing covering ${issue}.`;
    relationships.push(
      recordedRelationship({
        source: org.id,
        target: personId || org.id,
        type: "lobbied_on",
        claim: snippet,
        sourceUrl: url,
        evidenceSnippet: snippet,
        extraId: issue,
        provenance: { sourceId: "senate_lda", fieldPath: "filings.clients.name" },
      }),
    );
    sources.push(sourceFromProvenance(`LDA ${client}`, url, snippet, "senate.gov"));
  }
  return { entities, relationships, sources, skipped: [] };
}

async function lookupEuTransparency(input: PoliticalAdapterInput): Promise<PoliticalFragment> {
  const name = input.subject.names[0] || input.query;
  const data = await politicalGetJson<{
    results?: Array<{ identificationCode?: string; name?: string; webSiteURL?: string }>;
    organisations?: Array<{ identificationCode?: string; name?: string; webSiteURL?: string }>;
  }>(
    `https://ec.europa.eu/transparencyregister/public/api/v1/organisations?name=${encodeURIComponent(name)}&pageSize=5`,
  );
  const rows = data?.results ?? data?.organisations ?? [];
  if (rows.length === 0) return emptyFragment();
  const entities = [];
  const relationships = [];
  const sources = [];
  const personId = input.subject.person?.id;
  for (const row of rows.slice(0, 5)) {
    const orgName = row.name;
    if (!orgName) continue;
    const org = makeEntity({
      name: orgName,
      type: "organization",
      kind: "organization",
      jurisdiction: "EU",
      id: orgName,
    });
    entities.push(org);
    const url =
      row.webSiteURL ||
      `https://transparency-register.europa.eu/search-register_en?query=${encodeURIComponent(orgName)}`;
    const snippet = `${orgName} is listed on the EU Transparency Register${row.identificationCode ? ` (${row.identificationCode})` : ""}.`;
    relationships.push(
      recordedRelationship({
        source: org.id,
        target: personId || org.id,
        type: "lobbied_on",
        claim: snippet,
        sourceUrl: url,
        evidenceSnippet: snippet,
        extraId: row.identificationCode,
        provenance: {
          sourceId: "eu_transparency_register",
          externalId: row.identificationCode,
          fieldPath: "organisations.name",
        },
      }),
    );
    sources.push(sourceFromProvenance(orgName, url, snippet, "europa.eu"));
  }
  return { entities, relationships, sources, skipped: [] };
}

async function lookupLobbyingIe(input: PoliticalAdapterInput): Promise<PoliticalFragment> {
  const name = input.subject.person?.name || input.subject.names[0] || input.query;
  const data = await politicalGetJson<{
    records?: Array<{ organisation?: string; person?: string; dpo?: string; url?: string }>;
    returns?: Array<{ organisation?: string; person?: string }>;
  }>(`https://www.lobbying.ie/api/search?q=${encodeURIComponent(name)}`);
  const rows: Array<{ organisation?: string; person?: string; dpo?: string; url?: string }> =
    data?.records ?? data?.returns ?? [];
  if (rows.length === 0) return emptyFragment();
  const entities = [];
  const relationships = [];
  const sources = [];
  const personId = input.subject.person?.id;
  for (const row of rows.slice(0, 6)) {
    const orgName = row.organisation || row.dpo;
    if (!orgName) continue;
    const org = makeEntity({
      name: orgName,
      type: "organization",
      kind: "organization",
      jurisdiction: "IE",
      id: orgName,
    });
    entities.push(org);
    const url = row.url || `https://www.lobbying.ie/en/search?q=${encodeURIComponent(name)}`;
    const snippet = `${orgName} appears on a lobbying.ie return involving ${row.person || name}.`;
    relationships.push(
      recordedRelationship({
        source: org.id,
        target: personId || org.id,
        type: "lobbied_on",
        claim: snippet,
        sourceUrl: url,
        evidenceSnippet: snippet,
        extraId: orgName,
        provenance: { sourceId: "lobbying_ie", fieldPath: "returns.organisation" },
      }),
    );
    sources.push(sourceFromProvenance(`lobbying.ie ${orgName}`, url, snippet, "lobbying.ie"));
  }
  return { entities, relationships, sources, skipped: [] };
}
