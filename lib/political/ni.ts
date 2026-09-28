import {
  IDENTIFIER_SCHEMES,
  makeEntity,
  recordedRelationship,
  sourceFromProvenance,
} from "../ontology";
import type { InterestCategory } from "../types";
import { politicalGetJson } from "./http";
import { sameName } from "./names";
import type { PoliticalAdapterInput, PoliticalFragment } from "./types";
import { emptyFragment, mergeFragments } from "./types";

type MemberRow = {
  PersonId?: string;
  MemberName?: string;
  MemberLastName?: string;
  MemberFirstName?: string;
  MemberFullDisplayName?: string;
  MemberTitle?: string;
  PartyName?: string;
  ConstituencyName?: string;
};

type InterestRow = {
  PersonId?: string;
  MemberName?: string;
  RegisterCategoryId?: string;
  RegisterCategory?: string;
  RegisterEntry?: string;
  RegisterEntryStartDate?: string;
};

type RoleRow = {
  PersonId?: string;
  MemberFullDisplayName?: string;
  RoleType?: string;
  Role?: string;
  Organisation?: string;
  AffiliationTitle?: string;
  AffiliationStart?: string;
  AffiliationEnd?: string;
};

const INTEREST_MAP: Array<{ needle: string; category: InterestCategory }> = [
  { needle: "employment", category: "employment" },
  { needle: "donat", category: "gift" },
  { needle: "gift", category: "gift" },
  { needle: "hospitality", category: "gift" },
  { needle: "visit", category: "visit" },
  { needle: "sharehold", category: "shareholding" },
  { needle: "directorship", category: "directorship" },
  { needle: "land", category: "other" },
];

export async function lookupNiAssembly(input: PoliticalAdapterInput): Promise<PoliticalFragment> {
  const name = input.subject.person?.name || input.subject.names[0] || input.query;
  const knownId = input.subject.person?.identifiers?.find(
    (item) => item.scheme === IDENTIFIER_SCHEMES.niAssemblyMember,
  )?.value;
  const member = knownId
    ? await memberById(knownId, name)
    : await searchMember(name);
  if (!member?.PersonId) return emptyFragment();

  const display = member.MemberFullDisplayName || name;
  const personId = String(member.PersonId);
  const person = makeEntity({
    name: display.replace(/^(Ms|Mr|Mrs|Dr|Miss)\s+/i, "").trim() || display,
    type: "person",
    kind: "person",
    jurisdiction: "GB",
    identifiers: [{ scheme: IDENTIFIER_SCHEMES.niAssemblyMember, value: personId }],
    id: display,
  });
  const officeName = member.MemberTitle || `MLA for ${member.ConstituencyName || "Northern Ireland"}`;
  const office = makeEntity({
    name: officeName,
    type: "office",
    kind: "office",
    jurisdiction: "GB",
    id: `office-ni-${personId}`,
  });
  const party = member.PartyName
    ? makeEntity({
        name: member.PartyName,
        type: "organization",
        kind: "organization",
        jurisdiction: "GB",
        id: member.PartyName,
      })
    : undefined;
  const assembly = makeEntity({
    name: "Northern Ireland Assembly",
    type: "organization",
    kind: "organization",
    jurisdiction: "GB",
    id: "northern-ireland-assembly",
  });
  const profileUrl = `https://aims.niassembly.gov.uk/mlas/details.aspx?per=${personId}`;
  const entities = [person, office, assembly, ...(party ? [party] : [])];
  const relationships = [
    recordedRelationship({
      source: person.id,
      target: office.id,
      type: "holds_office",
      claim: `${person.name} holds office as ${officeName}.`,
      sourceUrl: profileUrl,
      evidenceSnippet: `${display} is listed as ${officeName} on the Northern Ireland Assembly members service.`,
      provenance: {
        sourceId: "ni_assembly_members",
        externalId: personId,
        fieldPath: "AllMembersList.Member.MemberTitle",
      },
    }),
    recordedRelationship({
      source: person.id,
      target: assembly.id,
      type: "member_of",
      claim: `${person.name} is a Member of the Northern Ireland Assembly.`,
      sourceUrl: profileUrl,
      evidenceSnippet: `${display} is listed on the NI Assembly members service.`,
      provenance: {
        sourceId: "ni_assembly_members",
        externalId: personId,
        fieldPath: "AllMembersList.Member.PersonId",
      },
    }),
  ];
  if (party) {
    relationships.push(
      recordedRelationship({
        source: person.id,
        target: party.id,
        type: "member_of",
        claim: `${person.name} is a member of ${member.PartyName}.`,
        sourceUrl: profileUrl,
        evidenceSnippet: `Party on the NI Assembly members service: ${member.PartyName}.`,
        provenance: {
          sourceId: "ni_assembly_members",
          externalId: personId,
          fieldPath: "AllMembersList.Member.PartyName",
        },
      }),
    );
  }

  const sources = [
    sourceFromProvenance(
      `${person.name} — NI Assembly`,
      profileUrl,
      `${display}, ${officeName}${member.PartyName ? `, ${member.PartyName}` : ""}.`,
      "niassembly.gov.uk",
    ),
  ];

  const [interests, roles] = await Promise.all([
    lookupInterests(personId, person.id, person.name, member.PartyName),
    lookupRoles(personId, person.id, person.name),
  ]);

  return mergeFragments([
    { entities, relationships, sources, skipped: [] },
    interests,
    roles,
  ]);
}

async function searchMember(name: string): Promise<MemberRow | undefined> {
  const last = surname(name);
  if (last.length >= 3) {
    const data = await politicalGetJson<unknown>(
      `https://data.niassembly.gov.uk/members.asmx/GetAllCurrentMembersBySurnameSearch_JSON?searchText=${encodeURIComponent(last)}`,
    );
    const hit = asList(readMembers(data)).find((row) => memberMatches(row, name));
    if (hit) return hit;
  }
  const all = await politicalGetJson<unknown>(
    "https://data.niassembly.gov.uk/members.asmx/GetAllCurrentMembers_JSON",
  );
  return asList(readMembers(all)).find((row) => memberMatches(row, name));
}

async function memberById(personId: string, name: string): Promise<MemberRow | undefined> {
  const all = await politicalGetJson<unknown>(
    "https://data.niassembly.gov.uk/members.asmx/GetAllCurrentMembers_JSON",
  );
  return asList(readMembers(all)).find(
    (row) => String(row.PersonId) === personId || memberMatches(row, name),
  );
}

async function lookupInterests(
  personId: string,
  personEntityId: string,
  display: string,
  partyName?: string,
): Promise<PoliticalFragment> {
  const data = await politicalGetJson<unknown>(
    "https://data.niassembly.gov.uk/register.asmx/GetAllRegisteredInterests_JSON",
  );
  const rows = asList(readInterests(data)).filter((row) => String(row.PersonId) === personId);
  if (rows.length === 0) return emptyFragment();

  const entities = [];
  const relationships = [];
  const sources = [];
  const url = `https://aims.niassembly.gov.uk/mlas/details.aspx?per=${personId}`;
  for (const row of rows.slice(0, 16)) {
    const text = String(row.RegisterEntry ?? "").trim();
    if (!text || /^none$/i.test(text)) continue;
    const category = interestCategory(row.RegisterCategory || "");
    const donorName = donorFromEntry(text, row.RegisterCategory || "");
    const orgName = donorName || organisationFromInterest(text);
    const org = makeEntity({
      name: orgName,
      type: "organization",
      kind: "organization",
      jurisdiction: "GB",
      id: orgName,
    });
    entities.push(org);
    const snippet = `${row.RegisterCategory || "Registered interest"}: ${text}`;
    const date = row.RegisterEntryStartDate ? String(row.RegisterEntryStartDate).slice(0, 10) : undefined;
    const isDonation = /donat/i.test(row.RegisterCategory || "") && donorName;
    relationships.push(
      recordedRelationship({
        source: isDonation ? org.id : personEntityId,
        target: isDonation ? personEntityId : org.id,
        type: isDonation ? "donated_to" : "declared_interest",
        claim: isDonation
          ? `${orgName} donated to ${display}${partyName ? ` (${partyName})` : ""}.`
          : `${display} declared a ${category} interest involving ${orgName}.`,
        sourceUrl: url,
        evidenceSnippet: snippet,
        extraId: text.slice(0, 48),
        category,
        unresolved: !isDonation,
        time: date ? { start: date } : undefined,
        provenance: {
          sourceId: "ni_assembly_interests",
          externalId: personId,
          fieldPath: `RegisteredInterest.${row.RegisterCategoryId || category}`,
        },
      }),
    );
    sources.push(
      sourceFromProvenance(`NI Register of Interests — ${display}`, url, snippet, "niassembly.gov.uk", date),
    );
  }
  return { entities, relationships, sources, skipped: [] };
}

async function lookupRoles(
  personId: string,
  personEntityId: string,
  display: string,
): Promise<PoliticalFragment> {
  const data = await politicalGetJson<unknown>(
    `https://data.niassembly.gov.uk/members.asmx/GetMemberRolesByPersonId_JSON?personId=${encodeURIComponent(personId)}`,
  );
  const rows = asList(readRoles(data)).filter(
    (row) => /minister|office/i.test(`${row.RoleType ?? ""} ${row.Role ?? ""}`),
  );
  if (rows.length === 0) return emptyFragment();
  const entities = [];
  const relationships = [];
  const sources = [];
  const url = `https://aims.niassembly.gov.uk/mlas/details.aspx?per=${personId}`;
  for (const row of rows.slice(0, 6)) {
    const title = row.AffiliationTitle || row.Role || "Assembly office";
    const orgName = row.Organisation || "Northern Ireland Assembly";
    const office = makeEntity({
      name: title,
      type: "office",
      kind: "office",
      jurisdiction: "GB",
      id: `office-ni-role-${personId}-${title}`,
    });
    entities.push(office);
    if (orgName && orgName !== title) {
      entities.push(
        makeEntity({
          name: orgName,
          type: "organization",
          kind: "organization",
          jurisdiction: "GB",
          id: orgName,
        }),
      );
    }
    const start = row.AffiliationStart ? String(row.AffiliationStart).slice(0, 10) : undefined;
    const snippet = `${display} listed as ${title} at ${orgName}.`;
    relationships.push(
      recordedRelationship({
        source: personEntityId,
        target: office.id,
        type: "holds_office",
        claim: `${display} holds office as ${title}.`,
        sourceUrl: url,
        evidenceSnippet: snippet,
        extraId: title,
        time: start ? { start, end: row.AffiliationEnd ? String(row.AffiliationEnd).slice(0, 10) : undefined } : undefined,
        provenance: {
          sourceId: "ni_assembly_roles",
          externalId: personId,
          fieldPath: "AllMembersRoles.Role.AffiliationTitle",
        },
      }),
    );
    sources.push(sourceFromProvenance(title, url, snippet, "niassembly.gov.uk", start));
  }
  return { entities, relationships, sources, skipped: [] };
}

function memberMatches(row: MemberRow, name: string): boolean {
  return [row.MemberFullDisplayName, row.MemberName, `${row.MemberFirstName ?? ""} ${row.MemberLastName ?? ""}`]
    .filter(Boolean)
    .some((value) => sameName(String(value), name));
}

function surname(name: string): string {
  const parts = name.replace(/['’]/g, "").trim().split(/\s+/);
  return parts[parts.length - 1] || name;
}

function interestCategory(label: string): InterestCategory {
  const lower = label.toLowerCase();
  return INTEREST_MAP.find((item) => lower.includes(item.needle))?.category ?? "other";
}

function donorFromEntry(text: string, category: string): string | undefined {
  if (!/donat/i.test(category) && !/provided a donation/i.test(text)) return undefined;
  const named = text.match(/^([^:]{2,80}):\s+provided a donation/i);
  return named?.[1]?.trim();
}

function organisationFromInterest(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const metBy = cleaned.match(
    /\b(?:met by|paid for by|paid by|costs? met by|provided by|guest of)\s+(?:the\s+)?([^.]{2,80})/i,
  );
  if (metBy?.[1]) return metBy[1].trim();
  const before = cleaned.split(/[;.(]/)[0]?.trim() ?? cleaned;
  const named = before.match(/\b(?:of|at|from|with|for)\s+([A-Z][\w&.,' -]{2,80})/);
  if (named?.[1]) return named[1].trim();
  if (/^I visited\b/i.test(before) || /^\d/.test(before)) return "Registered visit";
  if (before.length <= 80) return before;
  return before.slice(0, 80).trim();
}

function readMembers(data: unknown): MemberRow | MemberRow[] | undefined {
  const root = unwrap(data) as { AllMembersList?: { Member?: MemberRow | MemberRow[] } } | null;
  return root?.AllMembersList?.Member;
}

function readInterests(data: unknown): InterestRow | InterestRow[] | undefined {
  const root = unwrap(data) as {
    AllRegisteredInterests?: { RegisteredInterest?: InterestRow | InterestRow[] };
  } | null;
  return root?.AllRegisteredInterests?.RegisteredInterest;
}

function readRoles(data: unknown): RoleRow | RoleRow[] | undefined {
  const root = unwrap(data) as { AllMembersRoles?: { Role?: RoleRow | RoleRow[] } } | null;
  return root?.AllMembersRoles?.Role;
}

function asList<T>(value: T | T[] | undefined | null): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function unwrap(data: unknown): unknown {
  if (typeof data === "string") {
    try {
      return unwrap(JSON.parse(data));
    } catch {
      return null;
    }
  }
  if (data && typeof data === "object" && "d" in data) {
    return unwrap((data as { d: unknown }).d);
  }
  return data;
}
