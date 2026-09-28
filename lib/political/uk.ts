import {
  IDENTIFIER_SCHEMES,
  makeEntity,
  recordedRelationship,
  sourceFromProvenance,
} from "../ontology";
import type { InterestCategory } from "../types";
import { politicalGetJson } from "./http";
import type { PoliticalAdapterInput, PoliticalFragment } from "./types";
import { emptyFragment } from "./types";

type MemberHit = {
  value?: {
    id?: number;
    nameDisplayAs?: string;
    nameListAs?: string;
    latestParty?: { name?: string };
    latestHouseMembership?: { membershipFrom?: string; house?: number };
  };
};

const INTEREST_MAP: Array<{ needle: string; category: InterestCategory }> = [
  { needle: "employment", category: "employment" },
  { needle: "remunerat", category: "employment" },
  { needle: "directorship", category: "directorship" },
  { needle: "director", category: "directorship" },
  { needle: "sharehold", category: "shareholding" },
  { needle: "share", category: "shareholding" },
  { needle: "gift", category: "gift" },
  { needle: "hospitality", category: "gift" },
  { needle: "visit", category: "visit" },
  { needle: "travel", category: "visit" },
];

export async function lookupUkParliament(input: PoliticalAdapterInput): Promise<PoliticalFragment> {
  const name = input.subject.person?.name || input.subject.names[0] || input.query;
  const memberId =
    input.subject.person?.identifiers?.find((item) => item.scheme === IDENTIFIER_SCHEMES.parliamentMember)
      ?.value || (await searchMemberId(name));
  if (!memberId) return emptyFragment();

  const member = await politicalGetJson<{
    value?: {
      id?: number;
      nameDisplayAs?: string;
      latestParty?: { name?: string };
      latestHouseMembership?: { membershipFrom?: string; house?: number };
    };
  }>(`https://members-api.parliament.uk/api/Members/${memberId}`);
  const display = member?.value?.nameDisplayAs || name;
  const person = makeEntity({
    name: display,
    type: "person",
    kind: "person",
    jurisdiction: "GB",
    identifiers: [{ scheme: IDENTIFIER_SCHEMES.parliamentMember, value: String(memberId) }],
    id: display,
  });
  const house = member?.value?.latestHouseMembership?.house === 2 ? "House of Lords" : "House of Commons";
  const constituency = member?.value?.latestHouseMembership?.membershipFrom || house;
  const office = makeEntity({
    name: `MP for ${constituency}`,
    type: "office",
    kind: "office",
    jurisdiction: "GB",
    id: `office-gb-${memberId}`,
  });
  const partyName = member?.value?.latestParty?.name;
  const party = partyName
    ? makeEntity({
        name: partyName,
        type: "organization",
        kind: "organization",
        jurisdiction: "GB",
        id: partyName,
      })
    : undefined;
  const profileUrl = `https://members.parliament.uk/member/${memberId}`;
  const entities = [person, office, ...(party ? [party] : [])];
  const relationships = [
    recordedRelationship({
      source: person.id,
      target: office.id,
      type: "holds_office",
      claim: `${display} holds office as a member of the ${house} (${constituency}).`,
      sourceUrl: profileUrl,
      evidenceSnippet: `${display} is listed on the UK Parliament Members API as a current member for ${constituency}.`,
      provenance: {
        sourceId: "uk_parliament_members",
        externalId: String(memberId),
        fieldPath: "latestHouseMembership",
      },
    }),
  ];
  if (party) {
    relationships.push(
      recordedRelationship({
        source: person.id,
        target: party.id,
        type: "member_of",
        claim: `${display} is a member of ${partyName}.`,
        sourceUrl: profileUrl,
        evidenceSnippet: `Latest party on the Members API: ${partyName}.`,
        provenance: {
          sourceId: "uk_parliament_members",
          externalId: String(memberId),
          fieldPath: "latestParty.name",
        },
      }),
    );
  }

  const sources = [
    sourceFromProvenance(
      `${display} — UK Parliament`,
      profileUrl,
      `${display}, ${house}, ${constituency}${partyName ? `, ${partyName}` : ""}.`,
      "parliament.uk",
    ),
  ];

  const [interests, hansard, bills, votes] = await Promise.all([
    lookupInterests(String(memberId), person.id, display),
    lookupHansard(String(memberId), person.id, display),
    lookupSponsoredBills(String(memberId), person.id, display),
    lookupVotes(String(memberId), person.id, display),
  ]);

  return {
    entities: [...entities, ...interests.entities, ...hansard.entities, ...bills.entities, ...votes.entities],
    relationships: [
      ...relationships,
      ...interests.relationships,
      ...hansard.relationships,
      ...bills.relationships,
      ...votes.relationships,
    ],
    sources: [...sources, ...interests.sources, ...hansard.sources, ...bills.sources, ...votes.sources],
    skipped: [...interests.skipped, ...hansard.skipped, ...bills.skipped, ...votes.skipped],
  };
}

async function searchMemberId(name: string): Promise<string | undefined> {
  const data = await politicalGetJson<{ items?: MemberHit[] }>(
    `https://members-api.parliament.uk/api/Members/Search?Name=${encodeURIComponent(name)}&skip=0&take=5`,
  );
  const id = data?.items?.[0]?.value?.id;
  return id ? String(id) : undefined;
}

async function lookupInterests(
  memberId: string,
  personId: string,
  display: string,
): Promise<PoliticalFragment> {
  const data =
    (await politicalGetJson<{
      value?: Array<{
        category?: string;
        interests?: Array<{ interest?: string; createdWhen?: string }>;
      }>;
    }>(`https://members-api.parliament.uk/api/Members/${memberId}/RegisteredInterests`)) ??
    (await politicalGetJson<{
      value?: Array<{
        category?: string;
        interests?: Array<{ interest?: string; createdWhen?: string }>;
      }>;
    }>(`https://interests-api.parliament.uk/api/v1/Members/${memberId}/Interests`));

  const groups = data?.value ?? [];
  if (groups.length === 0) return emptyFragment();
  const entities = [];
  const relationships = [];
  const sources = [];
  const url = `https://members.parliament.uk/member/${memberId}/registeredinterests`;
  for (const group of groups.slice(0, 8)) {
    const category = interestCategory(group.category || "");
    for (const row of (group.interests ?? []).slice(0, 6)) {
      const text = String(row.interest ?? "").trim();
      if (!text) continue;
      const orgName = organisationFromInterest(text);
      const org = makeEntity({
        name: orgName,
        type: "organization",
        kind: "organization",
        jurisdiction: "GB",
        id: orgName,
      });
      entities.push(org);
      const snippet = `${group.category || "Registered interest"}: ${text}`;
      relationships.push(
        recordedRelationship({
          source: personId,
          target: org.id,
          type: "declared_interest",
          claim: `${display} declared a ${category} interest involving ${orgName}.`,
          sourceUrl: url,
          evidenceSnippet: snippet,
          extraId: text.slice(0, 48),
          category,
          unresolved: true,
          time: row.createdWhen ? { start: row.createdWhen.slice(0, 10) } : undefined,
          provenance: {
            sourceId: "uk_parliament_interests",
            externalId: memberId,
            fieldPath: `RegisteredInterests.${category}`,
          },
        }),
      );
      sources.push(sourceFromProvenance(`Register of Interests — ${display}`, url, snippet, "parliament.uk"));
    }
  }
  return { entities, relationships, sources, skipped: [] };
}

async function lookupHansard(
  memberId: string,
  personId: string,
  display: string,
): Promise<PoliticalFragment> {
  const data = await politicalGetJson<{
    Results?: Array<{
      Title?: string;
      SittingDate?: string;
      DebateType?: string;
      ExternalId?: string;
      BillTitle?: string;
    }>;
  }>(
    `https://hansard-api.parliament.uk/search.json?searchTerm=${encodeURIComponent(display)}&house=Commons&take=6`,
  );
  const rows = data?.Results ?? [];
  if (rows.length === 0) return emptyFragment();
  const entities = [];
  const relationships = [];
  const sources = [];
  for (const row of rows.slice(0, 6)) {
    const title = row.BillTitle || row.Title || "Parliamentary debate";
    const legislation = makeEntity({
      name: title,
      type: "legislation",
      kind: "legislation",
      jurisdiction: "GB",
      id: `hansard-${title}`,
    });
    entities.push(legislation);
    const url = `https://hansard.parliament.uk/search?searchTerm=${encodeURIComponent(display)}`;
    const snippet = `${display} contributed on “${title}”${row.SittingDate ? ` (${row.SittingDate})` : ""}.`;
    relationships.push(
      recordedRelationship({
        source: personId,
        target: legislation.id,
        type: "spoke_on",
        claim: `${display} spoke in Parliament on ${title}.`,
        sourceUrl: url,
        evidenceSnippet: snippet,
        extraId: row.ExternalId || title,
        time: row.SittingDate ? { start: row.SittingDate.slice(0, 10) } : undefined,
        provenance: {
          sourceId: "uk_hansard",
          externalId: memberId,
          fieldPath: "search.Results.Title",
        },
      }),
    );
    sources.push(sourceFromProvenance(title, url, snippet, "parliament.uk", row.SittingDate));
  }
  return { entities, relationships, sources, skipped: [] };
}

async function lookupSponsoredBills(
  memberId: string,
  personId: string,
  display: string,
): Promise<PoliticalFragment> {
  const data = await politicalGetJson<{
    items?: Array<{
      billId?: number;
      shortTitle?: string;
      currentHouse?: string;
      originatingHouse?: string;
    }>;
  }>(`https://bills-api.parliament.uk/api/v1/Bills?SponsorMnisId=${encodeURIComponent(memberId)}&Take=8`);
  const items = data?.items ?? [];
  if (items.length === 0) return emptyFragment();
  const entities = [];
  const relationships = [];
  const sources = [];
  for (const item of items.slice(0, 8)) {
    const title = item.shortTitle || `Bill ${item.billId}`;
    const url = `https://bills.parliament.uk/bills/${item.billId}`;
    const bill = makeEntity({
      name: title,
      type: "legislation",
      kind: "legislation",
      jurisdiction: "GB",
      id: `bill-uk-${item.billId || title}`,
    });
    entities.push(bill);
    const snippet = `${display} is listed as a sponsor of ${title}.`;
    relationships.push(
      recordedRelationship({
        source: personId,
        target: bill.id,
        type: "sponsored",
        claim: snippet,
        sourceUrl: url,
        evidenceSnippet: snippet,
        provenance: {
          sourceId: "uk_parliament_bills",
          externalId: String(item.billId ?? memberId),
          fieldPath: "Bills.SponsorMnisId",
        },
      }),
    );
    sources.push(sourceFromProvenance(title, url, snippet, "parliament.uk"));
  }
  return { entities, relationships, sources, skipped: [] };
}

async function lookupVotes(
  memberId: string,
  personId: string,
  display: string,
): Promise<PoliticalFragment> {
  const data = await politicalGetJson<{
    items?: Array<{
      DivisionId?: number;
      Title?: string;
      Date?: string;
      MemberVotedAye?: boolean;
    }>;
  }>(
    `https://commonsvotes-api.parliament.uk/data/divisions.json/membervoting?queryParameters.memberId=${encodeURIComponent(memberId)}`,
  );
  const items = data?.items ?? [];
  if (items.length === 0) return emptyFragment();
  const entities = [];
  const relationships = [];
  const sources = [];
  for (const item of items.slice(0, 6)) {
    const title = item.Title || `Division ${item.DivisionId}`;
    const url = `https://votes.parliament.uk/Votes/Commons/Division/${item.DivisionId}`;
    const bill = makeEntity({
      name: title,
      type: "legislation",
      kind: "legislation",
      jurisdiction: "GB",
      id: `division-uk-${item.DivisionId || title}`,
    });
    entities.push(bill);
    const side = item.MemberVotedAye ? "aye" : "no";
    const snippet = `${display} voted ${side} on “${title}”${item.Date ? ` (${item.Date})` : ""}.`;
    relationships.push(
      recordedRelationship({
        source: personId,
        target: bill.id,
        type: "voted_on",
        claim: snippet,
        sourceUrl: url,
        evidenceSnippet: snippet,
        extraId: side,
        time: item.Date ? { start: item.Date.slice(0, 10) } : undefined,
        provenance: {
          sourceId: "uk_commons_votes",
          externalId: String(item.DivisionId ?? memberId),
          fieldPath: "membervoting",
        },
      }),
    );
    sources.push(sourceFromProvenance(title, url, snippet, "parliament.uk", item.Date));
  }
  return { entities, relationships, sources, skipped: [] };
}

function interestCategory(label: string): InterestCategory {
  const lower = label.toLowerCase();
  return INTEREST_MAP.find((item) => lower.includes(item.needle))?.category ?? "other";
}

function organisationFromInterest(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const before = cleaned.split(/[;.(]/)[0]?.trim() ?? cleaned;
  const named = before.match(
    /\b(?:of|at|from|with|for)\s+([A-Z][\w&.,' -]{2,80})/,
  );
  if (named?.[1]) return named[1].trim();
  if (before.length <= 80) return before;
  return before.slice(0, 80).trim();
}
