import {
  makeEntity,
  recordedRelationship,
  sourceFromProvenance,
} from "../ontology";
import { politicalGetJson, politicalPostJson } from "./http";
import { sectorFromSic } from "./sectors";
import type { PoliticalAdapterInput, PoliticalFragment } from "./types";
import { emptyFragment, mergeFragments } from "./types";

export async function lookupProcurement(input: PoliticalAdapterInput): Promise<PoliticalFragment> {
  const names = input.subject.names.slice(0, 4);
  if (names.length === 0) return emptyFragment();
  const parts = await Promise.all([
    lookupContractsFinder(names),
    lookupTed(names),
    lookupUsaSpendingAssertions(names),
  ]);
  return mergeFragments(parts);
}

async function lookupContractsFinder(names: string[]): Promise<PoliticalFragment> {
  const parts: PoliticalFragment[] = [];
  for (const name of names.slice(0, 2)) {
    const data = await politicalPostJson<{
      noticeList?: Array<{
        item?: {
          id?: string;
          title?: string;
          description?: string;
          publishedDate?: string;
          awards?: Array<{ supplierName?: string; value?: number }>;
        };
      }>;
    }>("https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search", {
      searchCriteria: { keyword: name },
      size: 5,
    });
    const entities = [];
    const relationships = [];
    const sources = [];
    for (const row of data?.noticeList ?? []) {
      const item = row.item;
      if (!item?.title) continue;
      const supplierName = item.awards?.[0]?.supplierName || name;
      const company = makeEntity({
        name: supplierName,
        type: "company",
        kind: "company",
        jurisdiction: "GB",
        id: supplierName,
      });
      const contract = makeEntity({
        name: item.title,
        type: "legislation",
        kind: "legislation",
        jurisdiction: "GB",
        id: `contract-uk-${item.id || item.title}`,
      });
      entities.push(company, contract);
      const url = `https://www.contractsfinder.service.gov.uk/Notice/${item.id ?? ""}`;
      const snippet = `${supplierName} is recorded against “${item.title}” on Contracts Finder.`;
      relationships.push(
        recordedRelationship({
          source: company.id,
          target: contract.id,
          type: "awarded_contract",
          claim: snippet,
          sourceUrl: url,
          evidenceSnippet: snippet,
          extraId: item.id,
          time: item.publishedDate ? { start: item.publishedDate.slice(0, 10) } : undefined,
          provenance: { sourceId: "contracts_finder", externalId: item.id, fieldPath: "noticeList.item.title" },
        }),
      );
      sources.push(sourceFromProvenance(item.title, url, snippet, "contractsfinder.service.gov.uk", item.publishedDate));
    }
    if (entities.length) parts.push({ entities, relationships, sources, skipped: [] });
  }
  return parts.length ? mergeFragments(parts) : emptyFragment();
}

async function lookupTed(names: string[]): Promise<PoliticalFragment> {
  const parts: PoliticalFragment[] = [];
  for (const name of names.slice(0, 2)) {
    const data = await politicalPostJson<{
      notices?: Array<{
        nd?: string;
        title?: string;
        buyer?: string;
        publicationDate?: string;
      }>;
      results?: Array<{ ND?: string; TI?: string }>;
    }>("https://api.ted.europa.eu/v3/notices/search", {
      query: name,
      limit: 5,
      fields: ["ND", "TI", "PD"],
    });
    const rows = data?.notices ?? data?.results ?? [];
    const entities = [];
    const relationships = [];
    const sources = [];
    for (const row of rows.slice(0, 5)) {
      const rec = row as Record<string, string | undefined>;
      const title = rec.title || rec.TI || "TED notice";
      const nd = rec.nd || rec.ND;
      const company = makeEntity({
        name,
        type: "company",
        kind: "company",
        jurisdiction: "EU",
        id: name,
      });
      const notice = makeEntity({
        name: title,
        type: "legislation",
        kind: "legislation",
        jurisdiction: "EU",
        id: `ted-${nd || title}`,
      });
      entities.push(company, notice);
      const url = nd
        ? `https://ted.europa.eu/en/notice/-/detail/${nd}`
        : "https://ted.europa.eu/";
      const snippet = `${name} is associated with TED notice “${title}”.`;
      relationships.push(
        recordedRelationship({
          source: company.id,
          target: notice.id,
          type: "awarded_contract",
          claim: snippet,
          sourceUrl: url,
          evidenceSnippet: snippet,
          extraId: nd,
          provenance: { sourceId: "ted", externalId: nd, fieldPath: "notices.title" },
        }),
      );
      sources.push(sourceFromProvenance(title, url, snippet, "ted.europa.eu", rec.publicationDate || rec.PD));
    }
    if (entities.length) parts.push({ entities, relationships, sources, skipped: [] });
  }
  return parts.length ? mergeFragments(parts) : emptyFragment();
}

async function lookupUsaSpendingAssertions(names: string[]): Promise<PoliticalFragment> {
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date();
  start.setFullYear(start.getFullYear() - 6);
  const parts: PoliticalFragment[] = [];
  for (const name of names.slice(0, 2)) {
    const data = await politicalPostJson<{
      results?: Array<Record<string, unknown>>;
    }>("https://api.usaspending.gov/api/v2/search/spending_by_award/", {
      filters: {
        recipient_search_text: [name],
        award_type_codes: ["A", "B", "C", "D"],
        time_period: [{ start_date: start.toISOString().slice(0, 10), end_date: end }],
      },
      fields: ["Award ID", "Recipient Name", "Award Amount", "Awarding Agency", "Description", "NAICS", "Start Date"],
      limit: 5,
      page: 1,
      sort: "Award Amount",
      order: "desc",
    });
    const entities = [];
    const relationships = [];
    const sources = [];
    for (const row of data?.results ?? []) {
      const awardId = String(row["Award ID"] ?? "").trim();
      const recipient = String(row["Recipient Name"] ?? name).trim();
      if (!awardId) continue;
      const company = makeEntity({
        name: recipient,
        type: "company",
        kind: "company",
        jurisdiction: "US",
        id: recipient,
      });
      const description = String(row.Description ?? row["Award ID"] ?? "US federal award");
      const contract = makeEntity({
        name: description.slice(0, 120),
        type: "legislation",
        kind: "legislation",
        jurisdiction: "US",
        id: `award-us-${awardId}`,
      });
      entities.push(company, contract);
      const naics = String(row.NAICS ?? "");
      if (naics) {
        const sector = sectorFromSic(naics);
        if (sector) {
          const sectorEntity = makeEntity({
            name: sector.label,
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
              claim: `${recipient} award NAICS ${naics} (${sector.label}).`,
              sourceUrl: `https://www.usaspending.gov/award/${awardId}`,
              evidenceSnippet: `USASpending NAICS ${naics} for award ${awardId}.`,
              extraId: naics,
              estimated: true,
              provenance: { sourceId: "usaspending", externalId: awardId, fieldPath: "NAICS" },
            }),
          );
        }
      }
      const url = `https://www.usaspending.gov/award/${awardId}`;
      const snippet = `${recipient} received US award ${awardId} (${row["Award Amount"] ?? "amount unstated"}).`;
      relationships.push(
        recordedRelationship({
          source: company.id,
          target: contract.id,
          type: "awarded_contract",
          claim: snippet,
          sourceUrl: url,
          evidenceSnippet: snippet,
          extraId: awardId,
          time: typeof row["Start Date"] === "string" ? { start: String(row["Start Date"]).slice(0, 10) } : undefined,
          provenance: { sourceId: "usaspending", externalId: awardId, fieldPath: "Award ID" },
        }),
      );
      sources.push(sourceFromProvenance(`Award ${awardId}`, url, snippet, "usaspending.gov"));
    }
    if (entities.length) parts.push({ entities, relationships, sources, skipped: [] });
  }
  return parts.length ? mergeFragments(parts) : emptyFragment();
}
