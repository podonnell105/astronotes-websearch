import type { Document } from "./search";

const SEARCH_URL = "https://api.usaspending.gov/api/v2/search/spending_by_award/";
const TIMEOUT_MS = 15000;
const MAX_AWARDS = 5;
const AWARD_FIELDS = [
  "Award ID",
  "Recipient Name",
  "Award Amount",
  "Total Outlays",
  "Awarding Agency",
  "Awarding Sub Agency",
  "Start Date",
  "End Date",
  "Award Type",
  "Description",
  "Last Modified Date",
  "NAICS",
  "generated_internal_id",
];

type AwardRow = Record<string, unknown>;

export async function lookupUsaSpendingAwards(
  names: string[],
  excludeUrls: string[] = [],
): Promise<Document[]> {
  const skip = new Set(excludeUrls);
  const found: Document[] = [];
  const seen = new Set<string>();

  for (const name of names.slice(0, 3)) {
    if (found.length >= MAX_AWARDS) break;
    const awards = await awardsForRecipient(name);
    for (const award of awards) {
      if (found.length >= MAX_AWARDS) break;
      if (skip.has(award.url) || seen.has(award.url)) continue;
      seen.add(award.url);
      found.push(award);
    }
  }

  return found;
}

async function awardsForRecipient(name: string): Promise<Document[]> {
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date();
  start.setFullYear(start.getFullYear() - 8);
  const body = {
    filters: {
      recipient_search_text: [name],
      award_type_codes: ["A", "B", "C", "D"],
      time_period: [
        {
          start_date: start.toISOString().slice(0, 10),
          end_date: end,
        },
      ],
    },
    fields: AWARD_FIELDS,
    limit: 15,
    page: 1,
    sort: "Award Amount",
    order: "desc",
  };

  const data = await postJson<{ results?: AwardRow[] }>(SEARCH_URL, body);
  const rows = (data?.results ?? []).filter(isRecentEnough);
  const picked = (rows.length ? rows : data?.results ?? []).slice(0, MAX_AWARDS);
  return picked.flatMap((row) => {
    const doc = awardDocument(row, name);
    return doc ? [doc] : [];
  });
}

function awardDocument(row: AwardRow, queryName: string): Document | null {
  const awardId =
    field(row, "Award ID", "award_id", "piid") || field(row, "generated_internal_id");
  const internalId = field(row, "generated_internal_id", "Award ID");
  if (!awardId && !internalId) return null;

  const recipient = field(row, "Recipient Name", "recipient_name") || queryName;
  const agency = field(row, "Awarding Agency", "awarding_agency_name");
  const subAgency = field(row, "Awarding Sub Agency", "awarding_sub_agency_name");
  const amount = formatAmount(row["Award Amount"] ?? row["award_amount"]);
  const outlays = formatAmount(row["Total Outlays"] ?? row["total_outlays"]);
  const startDate = field(row, "Start Date", "start_date", "period_of_performance_start_date");
  const endDate = field(row, "End Date", "end_date", "period_of_performance_current_end_date");
  const awardType = field(row, "Award Type", "award_type");
  const naics = naicsText(row["NAICS"] ?? row["naics_code"] ?? row["naics_description"]);
  const description = field(row, "Description", "description");
  const modified = field(row, "Last Modified Date", "last_modified_date");
  const url = `https://www.usaspending.gov/award/${encodeURIComponent(internalId || awardId)}`;
  const publishedAt = (modified || startDate).slice(0, 10) || undefined;

  const snippet = [
    `USASpending federal award ${awardId || internalId} to ${recipient}.`,
    amount ? `Amount ${amount}.` : "",
    agency ? `Awarding agency ${agency}${subAgency ? ` / ${subAgency}` : ""}.` : "",
    startDate ? `Period ${startDate}${endDate ? ` to ${endDate}` : ""}.` : "",
    "This is an awarded contract record, not an announcement.",
  ]
    .filter(Boolean)
    .join(" ");

  const text = [
    snippet,
    awardType ? `Award type: ${awardType}.` : "",
    naics ? `NAICS: ${naics}.` : "",
    outlays ? `Total outlays: ${outlays}.` : "",
    description ? `Description: ${description.slice(0, 600)}.` : "",
    `Award ID: ${awardId || internalId}.`,
    `Evidence URL: ${url}.`,
    "Treat an award with amount and dates as deployed-contract evidence. A press release that only says selected or will build remains announced unless this record supports delivery.",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    title: `${amount ? `${amount} ` : ""}award — ${recipient}${agency ? ` / ${agency}` : ""}`,
    url,
    snippet,
    source: "usaspending.gov",
    publishedAt,
    text,
  };
}

function isRecentEnough(row: AwardRow): boolean {
  const cutoff = yearsAgo(8);
  const end = field(row, "End Date", "end_date").slice(0, 10);
  const start = field(row, "Start Date", "start_date").slice(0, 10);
  return Boolean((end && end >= cutoff) || (start && start >= cutoff));
}

function yearsAgo(years: number): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  return date.toISOString().slice(0, 10);
}

function naicsText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object") {
    const record = value as { code?: unknown; description?: unknown };
    return [record.code, record.description]
      .map((part) => String(part ?? "").trim())
      .filter(Boolean)
      .join(" — ");
  }
  const text = String(value).trim();
  return text === "null" ? "" : text;
}

function field(row: AwardRow, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value == null) continue;
    const text = String(value).trim();
    if (text && text !== "null") return text;
  }
  return "";
}

function formatAmount(value: unknown): string {
  const number = typeof value === "number" ? value : Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(number) || number === 0) return "";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(number);
}

async function postJson<T>(url: string, body: unknown): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
