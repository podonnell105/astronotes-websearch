import {
  ROLE_LABELS,
  presetForRole,
  type AnalystRole,
} from "./dataCatalog";
import { detectFacets } from "./researchPlan";
import { emptySourcePolicy } from "./sources";
import type { SourcePolicy } from "./types";

const POLITICAL =
  /\b(donor|donors|donation|donations|fundraising|lobby|mp\b|mla\b|mep\b|minister|parliament|assembly|congress|senate|campaign finance|electoral commission|sinn f|stormont|oireachtas|fec\b)\b/i;
const BIOTECH =
  /\b(trial|clinical|nih|biotech|drug|phase [123]|fda|therapeut|oncolog|molecule)\b/i;
const VC =
  /\b(patent|github|startup|raised|series [a-d]|seed round|valuation|venture)\b/i;
const GOVTECH =
  /\b(usaspending|sam\.gov|procurement|govtech|federal contract|contract award)\b/i;
const PE =
  /\b(acquir|acquisition|10-k|edgar|buyout|portfolio company|private equity)\b/i;

export function inferAnalystRole(query: string): AnalystRole {
  const facets = detectFacets(query);
  if (facets.includes("donations") || POLITICAL.test(query)) return "political";
  if (BIOTECH.test(query)) return "biotech";
  if (facets.includes("funding") || VC.test(query)) return "vc";
  if (GOVTECH.test(query)) return "govtech";
  if (PE.test(query)) return "pe";
  if (facets.includes("hiring") || facets.includes("employment") || facets.includes("products")) {
    return "pe";
  }
  return "custom";
}

export function inferQueryPolicy(query: string, base?: SourcePolicy): SourcePolicy {
  const role = inferAnalystRole(query);
  const fallback = base ?? emptySourcePolicy();
  return {
    allowDomains: fallback.allowDomains,
    denyDomains: fallback.denyDomains,
    publishedAfter: fallback.publishedAfter,
    publishedBefore: fallback.publishedBefore,
    onlyUrls: fallback.onlyUrls,
    role,
    dataSources: presetForRole(role),
  };
}

export function inferredSourceLabel(policy: SourcePolicy): string {
  if (policy.role === "custom") return "Sources chosen from the query";
  return ROLE_LABELS[policy.role];
}
