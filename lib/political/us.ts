import {
  IDENTIFIER_SCHEMES,
  makeEntity,
  recordedRelationship,
  sourceFromProvenance,
} from "../ontology";
import { politicalGetJson } from "./http";
import { sameName } from "./names";
import type { PoliticalAdapterInput, PoliticalFragment } from "./types";
import { emptyFragment } from "./types";

function congressKey(): string | undefined {
  return (
    process.env.CONGRESS_GOV_API_KEY?.trim() ||
    process.env.DATA_GOV_API_KEY?.trim()
  );
}

export async function lookupCongress(input: PoliticalAdapterInput): Promise<PoliticalFragment> {
  const key = congressKey();
  if (!key) {
    return { ...emptyFragment(), skipped: ["Congress.gov skipped (no CONGRESS_GOV_API_KEY)"] };
  }
  const name = input.subject.person?.name || input.subject.names[0] || input.query;
  const bioguide =
    input.subject.person?.identifiers?.find((item) => item.scheme === IDENTIFIER_SCHEMES.bioguide)?.value ||
    (await searchBioguide(name, key));
  if (!bioguide) return emptyFragment();

  const member = await politicalGetJson<{
    member?: {
      name?: string;
      directOrderName?: string;
      state?: string;
      district?: number;
      partyName?: string;
      terms?: Array<{ chamber?: string }>;
    };
  }>(`https://api.congress.gov/v3/member/${bioguide}?api_key=${key}`);
  const display = member?.member?.directOrderName || member?.member?.name || name;
  if (!sameName(display, name)) return emptyFragment();
  const chamber = member?.member?.terms?.[0]?.chamber || "Congress";
  const person = makeEntity({
    name: display,
    type: "person",
    kind: "person",
    jurisdiction: "US",
    identifiers: [{ scheme: IDENTIFIER_SCHEMES.bioguide, value: bioguide }],
    id: display,
  });
  const office = makeEntity({
    name: `${chamber}${member?.member?.state ? ` (${member.member.state})` : ""}`,
    type: "office",
    kind: "office",
    jurisdiction: "US",
    id: `office-us-${bioguide}`,
  });
  const party = member?.member?.partyName
    ? makeEntity({
        name: member.member.partyName,
        type: "organization",
        kind: "organization",
        jurisdiction: "US",
        id: member.member.partyName,
      })
    : undefined;
  const url = `https://www.congress.gov/member/${encodeURIComponent(display.toLowerCase().replace(/\s+/g, "-"))}/${bioguide}`;
  const entities = [person, office, ...(party ? [party] : [])];
  const relationships = [
    recordedRelationship({
      source: person.id,
      target: office.id,
      type: "holds_office",
      claim: `${display} holds office in the US ${chamber}.`,
      sourceUrl: url,
      evidenceSnippet: `${display} is listed on Congress.gov (bioguide ${bioguide}).`,
      provenance: { sourceId: "congress_gov", externalId: bioguide, fieldPath: "member.terms.chamber" },
    }),
  ];
  if (party) {
    relationships.push(
      recordedRelationship({
        source: person.id,
        target: party.id,
        type: "member_of",
        claim: `${display} is a member of the ${member?.member?.partyName}.`,
        sourceUrl: url,
        evidenceSnippet: `Party on Congress.gov: ${member?.member?.partyName}.`,
        provenance: { sourceId: "congress_gov", externalId: bioguide, fieldPath: "member.partyName" },
      }),
    );
  }

  const sponsored = await lookupSponsored(bioguide, person.id, display, key);
  return {
    entities: [...entities, ...sponsored.entities],
    relationships: [...relationships, ...sponsored.relationships],
    sources: [
      sourceFromProvenance(
        `${display} — Congress.gov`,
        url,
        `${display}, ${chamber}, bioguide ${bioguide}.`,
        "congress.gov",
      ),
      ...sponsored.sources,
    ],
    skipped: sponsored.skipped,
  };
}

async function searchBioguide(name: string, key: string): Promise<string | undefined> {
  const data = await politicalGetJson<{
    members?: Array<{ bioguideId?: string; name?: string }>;
  }>(`https://api.congress.gov/v3/member?query=${encodeURIComponent(name)}&limit=5&api_key=${key}`);
  const hit = data?.members?.find((member) => member.name && sameName(member.name, name));
  return hit?.bioguideId;
}

async function lookupSponsored(
  bioguide: string,
  personId: string,
  display: string,
  key: string,
): Promise<PoliticalFragment> {
  const data = await politicalGetJson<{
    sponsoredLegislation?: Array<{
      number?: string;
      title?: string;
      type?: string;
      congress?: number;
      url?: string;
    }>;
  }>(`https://api.congress.gov/v3/member/${bioguide}/sponsored-legislation?limit=8&api_key=${key}`);
  const items = data?.sponsoredLegislation ?? [];
  if (items.length === 0) return emptyFragment();
  const entities = [];
  const relationships = [];
  const sources = [];
  for (const item of items.slice(0, 8)) {
    const title = item.title || `${item.type ?? "Bill"} ${item.number ?? ""}`.trim();
    const url = item.url || `https://www.congress.gov/bill/${item.congress}th-congress`;
    const bill = makeEntity({
      name: title,
      type: "legislation",
      kind: "legislation",
      jurisdiction: "US",
      id: `bill-us-${item.congress}-${item.type}-${item.number}`,
    });
    entities.push(bill);
    const snippet = `${display} sponsored ${title}.`;
    relationships.push(
      recordedRelationship({
        source: personId,
        target: bill.id,
        type: "sponsored",
        claim: snippet,
        sourceUrl: url,
        evidenceSnippet: snippet,
        provenance: {
          sourceId: "congress_gov",
          externalId: bioguide,
          fieldPath: "sponsoredLegislation.title",
        },
      }),
    );
    sources.push(sourceFromProvenance(title, url, snippet, "congress.gov"));
  }
  return { entities, relationships, sources, skipped: [] };
}
