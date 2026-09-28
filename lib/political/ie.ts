import {
  IDENTIFIER_SCHEMES,
  makeEntity,
  recordedRelationship,
  sourceFromProvenance,
} from "../ontology";
import { politicalGetJson } from "./http";
import type { PoliticalAdapterInput, PoliticalFragment } from "./types";
import { emptyFragment } from "./types";

type OireachtasMember = {
  member?: {
    uri?: string;
    fullName?: string;
    memberships?: Array<{
      membership?: {
        office?: { officeName?: { showAs?: string } };
        parties?: Array<{ party?: { showAs?: string } }>;
        represents?: Array<{ represent?: { showAs?: string } }>;
      };
    }>;
  };
};

export async function lookupOireachtas(input: PoliticalAdapterInput): Promise<PoliticalFragment> {
  const name = input.subject.person?.name || input.subject.names[0] || input.query;
  const memberId =
    input.subject.person?.identifiers?.find((item) => item.scheme === IDENTIFIER_SCHEMES.oireachtasMember)
      ?.value;
  const data = await politicalGetJson<{ results?: OireachtasMember[] }>(
    memberId
      ? `https://api.oireachtas.ie/v1/members?member_id=${encodeURIComponent(memberId)}&limit=1`
      : `https://api.oireachtas.ie/v1/members?limit=8&q=${encodeURIComponent(name)}`,
  );
  const hit =
    data?.results?.find((row) =>
      (row.member?.fullName || "").toLowerCase().includes(name.toLowerCase().split(" ").slice(-1)[0] || name),
    ) ?? data?.results?.[0];
  if (!hit?.member?.fullName) return emptyFragment();

  const display = hit.member.fullName;
  const uri = hit.member.uri || "";
  const person = makeEntity({
    name: display,
    type: "person",
    kind: "person",
    jurisdiction: "IE",
    identifiers: uri
      ? [{ scheme: IDENTIFIER_SCHEMES.oireachtasMember, value: uri }]
      : undefined,
    id: display,
  });
  const membership = hit.member.memberships?.[0]?.membership;
  const officeName = membership?.office?.officeName?.showAs || "Oireachtas member";
  const office = makeEntity({
    name: officeName,
    type: "office",
    kind: "office",
    jurisdiction: "IE",
    id: `office-ie-${display}`,
  });
  const partyName = membership?.parties?.[0]?.party?.showAs;
  const party = partyName
    ? makeEntity({
        name: partyName,
        type: "organization",
        kind: "organization",
        jurisdiction: "IE",
        id: partyName,
      })
    : undefined;
  const url = uri || "https://www.oireachtas.ie/en/members/";
  const entities = [person, office, ...(party ? [party] : [])];
  const relationships = [
    recordedRelationship({
      source: person.id,
      target: office.id,
      type: "holds_office",
      claim: `${display} holds office as ${officeName}.`,
      sourceUrl: url,
      evidenceSnippet: `${display} is listed in the Houses of the Oireachtas members API.`,
      provenance: { sourceId: "oireachtas_members", externalId: uri, fieldPath: "member.memberships" },
    }),
  ];
  if (party) {
    relationships.push(
      recordedRelationship({
        source: person.id,
        target: party.id,
        type: "member_of",
        claim: `${display} is a member of ${partyName}.`,
        sourceUrl: url,
        evidenceSnippet: `Party recorded on the Oireachtas member record: ${partyName}.`,
        provenance: { sourceId: "oireachtas_members", externalId: uri, fieldPath: "memberships.parties" },
      }),
    );
  }

  const [debates, questions, bills] = await Promise.all([
    lookupDebates(display, person.id),
    lookupQuestions(display, person.id),
    lookupBills(display, person.id),
  ]);

  return {
    entities: [...entities, ...debates.entities, ...questions.entities, ...bills.entities],
    relationships: [
      ...relationships,
      ...debates.relationships,
      ...questions.relationships,
      ...bills.relationships,
    ],
    sources: [
      sourceFromProvenance(`${display} — Oireachtas`, url, `${display}, ${officeName}.`, "oireachtas.ie"),
      ...debates.sources,
      ...questions.sources,
      ...bills.sources,
    ],
    skipped: [],
  };
}

async function lookupDebates(name: string, personId: string): Promise<PoliticalFragment> {
  const data = await politicalGetJson<{
    results?: Array<{ debateRecord?: { debate?: { showAs?: string; date?: string; uri?: string } } }>;
  }>(`https://api.oireachtas.ie/v1/debates?date_start=2020-01-01&limit=6&q=${encodeURIComponent(name)}`);
  const rows = data?.results ?? [];
  if (rows.length === 0) return emptyFragment();
  const entities = [];
  const relationships = [];
  const sources = [];
  for (const row of rows.slice(0, 6)) {
    const debate = row.debateRecord?.debate;
    const title = debate?.showAs || "Oireachtas debate";
    const url = debate?.uri || "https://www.oireachtas.ie/en/debates/";
    const legislation = makeEntity({
      name: title,
      type: "legislation",
      kind: "legislation",
      jurisdiction: "IE",
      id: `debate-ie-${title}`,
    });
    entities.push(legislation);
    const snippet = `${name} appears in the Official Report on “${title}”${debate?.date ? ` (${debate.date})` : ""}.`;
    relationships.push(
      recordedRelationship({
        source: personId,
        target: legislation.id,
        type: "spoke_on",
        claim: `${name} spoke in the Oireachtas on ${title}.`,
        sourceUrl: url,
        evidenceSnippet: snippet,
        extraId: title,
        time: debate?.date ? { start: debate.date.slice(0, 10) } : undefined,
        provenance: { sourceId: "oireachtas_debates", fieldPath: "debateRecord.debate.showAs" },
      }),
    );
    sources.push(sourceFromProvenance(title, url, snippet, "oireachtas.ie", debate?.date));
  }
  return { entities, relationships, sources, skipped: [] };
}

async function lookupQuestions(name: string, personId: string): Promise<PoliticalFragment> {
  const data = await politicalGetJson<{
    results?: Array<{ question?: { showAs?: string; date?: string; uri?: string } }>;
  }>(`https://api.oireachtas.ie/v1/questions?limit=6&q=${encodeURIComponent(name)}`);
  const rows = data?.results ?? [];
  if (rows.length === 0) return emptyFragment();
  const entities = [];
  const relationships = [];
  const sources = [];
  for (const row of rows.slice(0, 6)) {
    const question = row.question;
    const title = question?.showAs || "Parliamentary question";
    const url = question?.uri || "https://www.oireachtas.ie/en/debates/questions/";
    const legislation = makeEntity({
      name: title,
      type: "legislation",
      kind: "legislation",
      jurisdiction: "IE",
      id: `pq-ie-${title}`,
    });
    entities.push(legislation);
    const snippet = `${name} asked: ${title}`;
    relationships.push(
      recordedRelationship({
        source: personId,
        target: legislation.id,
        type: "questioned",
        claim: `${name} tabled a parliamentary question on ${title}.`,
        sourceUrl: url,
        evidenceSnippet: snippet,
        extraId: title.slice(0, 40),
        time: question?.date ? { start: question.date.slice(0, 10) } : undefined,
        provenance: { sourceId: "oireachtas_questions", fieldPath: "question.showAs" },
      }),
    );
    sources.push(sourceFromProvenance(title, url, snippet, "oireachtas.ie", question?.date));
  }
  return { entities, relationships, sources, skipped: [] };
}

async function lookupBills(name: string, personId: string): Promise<PoliticalFragment> {
  const data = await politicalGetJson<{
    results?: Array<{ bill?: { billNo?: string; shortTitleEn?: string; uri?: string } }>;
  }>(`https://api.oireachtas.ie/v1/legislation?limit=6&q=${encodeURIComponent(name)}`);
  const rows = data?.results ?? [];
  if (rows.length === 0) return emptyFragment();
  const entities = [];
  const relationships = [];
  const sources = [];
  for (const row of rows.slice(0, 6)) {
    const bill = row.bill;
    const title = bill?.shortTitleEn || `Bill ${bill?.billNo ?? ""}`.trim();
    const url = bill?.uri || "https://www.oireachtas.ie/en/bills/";
    const legislation = makeEntity({
      name: title,
      type: "legislation",
      kind: "legislation",
      jurisdiction: "IE",
      id: `bill-ie-${bill?.billNo || title}`,
    });
    entities.push(legislation);
    const snippet = `${title} is associated with ${name} in Oireachtas legislation data.`;
    relationships.push(
      recordedRelationship({
        source: personId,
        target: legislation.id,
        type: "sponsored",
        claim: snippet,
        sourceUrl: url,
        evidenceSnippet: snippet,
        provenance: { sourceId: "oireachtas_legislation", fieldPath: "bill.shortTitleEn" },
      }),
    );
    sources.push(sourceFromProvenance(title, url, snippet, "oireachtas.ie"));
  }
  return { entities, relationships, sources, skipped: [] };
}
