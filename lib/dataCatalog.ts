export const DATA_SOURCE_IDS = [
  "edgar",
  "usaspending",
  "gleif",
  "companies_house",
  "github",
  "nih_reporter",
  "clinicaltrials",
  "openalex",
  "opensanctions",
  "wayback",
  "patents",
  "sam",
] as const;

export type DataSourceId = (typeof DATA_SOURCE_IDS)[number];
export type AnalystRole = "pe" | "vc" | "biotech" | "govtech" | "custom";

export const ANALYST_ROLES: Array<Exclude<AnalystRole, "custom">> = [
  "pe",
  "vc",
  "biotech",
  "govtech",
];

export const ROLE_LABELS: Record<AnalystRole, string> = {
  pe: "PE / corp-dev",
  vc: "VC",
  biotech: "Biotech",
  govtech: "Govtech",
  custom: "Custom",
};

export type DataSourceEnv =
  | "COMPANIES_HOUSE_API_KEY"
  | "PATENTSVIEW_API_KEY"
  | "SAM_API_KEY"
  | "OPENSANCTIONS_API_KEY";

export type DataSourceDef = {
  id: DataSourceId;
  label: string;
  host: string;
  needsEnv?: DataSourceEnv;
};

export const DATA_CATALOG: DataSourceDef[] = [
  { id: "edgar", label: "SEC EDGAR", host: "sec.gov" },
  { id: "usaspending", label: "USASpending", host: "usaspending.gov" },
  { id: "gleif", label: "GLEIF LEI", host: "gleif.org" },
  {
    id: "companies_house",
    label: "Companies House",
    host: "companieshouse.gov.uk",
    needsEnv: "COMPANIES_HOUSE_API_KEY",
  },
  { id: "github", label: "GitHub", host: "github.com" },
  { id: "nih_reporter", label: "NIH RePORTER", host: "reporter.nih.gov" },
  { id: "clinicaltrials", label: "ClinicalTrials.gov", host: "clinicaltrials.gov" },
  { id: "openalex", label: "OpenAlex", host: "openalex.org" },
  { id: "opensanctions", label: "OpenSanctions", host: "opensanctions.org", needsEnv: "OPENSANCTIONS_API_KEY" },
  { id: "wayback", label: "Wayback Machine", host: "web.archive.org" },
  {
    id: "patents",
    label: "USPTO PatentsView",
    host: "patentsview.org",
    needsEnv: "PATENTSVIEW_API_KEY",
  },
  { id: "sam", label: "SAM.gov", host: "sam.gov", needsEnv: "SAM_API_KEY" },
];

export const ROLE_PRESETS: Record<Exclude<AnalystRole, "custom">, DataSourceId[]> = {
  pe: ["edgar", "usaspending", "gleif", "opensanctions", "companies_house"],
  vc: ["edgar", "patents", "github", "gleif", "wayback", "opensanctions"],
  biotech: [
    "clinicaltrials",
    "nih_reporter",
    "openalex",
    "patents",
    "edgar",
    "opensanctions",
  ],
  govtech: ["usaspending", "sam", "edgar", "gleif", "opensanctions"],
};

export const DEFAULT_AVAILABLE_SOURCES: DataSourceId[] = DATA_CATALOG.filter(
  (item) => !item.needsEnv,
).map((item) => item.id);

const ID_SET = new Set<string>(DATA_SOURCE_IDS);

export function isDataSourceId(value: string): value is DataSourceId {
  return ID_SET.has(value);
}

export function normalizeAnalystRole(value: unknown): AnalystRole {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (raw === "pe" || raw === "vc" || raw === "biotech" || raw === "govtech") {
    return raw;
  }
  if (raw === "custom") return "custom";
  return "custom";
}

export function normalizeDataSources(value: unknown): DataSourceId[] {
  const raw = Array.isArray(value)
    ? value.map((item) => String(item))
    : String(value ?? "")
        .split(/[\s,]+/)
        .filter(Boolean);
  const seen = new Set<DataSourceId>();
  const out: DataSourceId[] = [];
  for (const item of raw) {
    const id = item.trim().toLowerCase();
    if (!isDataSourceId(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function presetForRole(role: AnalystRole): DataSourceId[] {
  if (role === "custom") return [];
  return [...ROLE_PRESETS[role]];
}

export function roleMatchingSources(sources: DataSourceId[]): AnalystRole {
  const needle = [...sources].sort().join(",");
  for (const role of ANALYST_ROLES) {
    const preset = [...ROLE_PRESETS[role]].sort().join(",");
    if (preset === needle) return role;
  }
  return "custom";
}

export function applyRolePreset(role: Exclude<AnalystRole, "custom">): {
  role: AnalystRole;
  dataSources: DataSourceId[];
} {
  return { role, dataSources: presetForRole(role) };
}

export function toggleDataSource(
  sources: DataSourceId[],
  id: DataSourceId,
): { role: AnalystRole; dataSources: DataSourceId[] } {
  const set = new Set(sources);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  const dataSources = DATA_SOURCE_IDS.filter((item) => set.has(item));
  return { role: roleMatchingSources(dataSources), dataSources };
}

export function catalogHost(id: DataSourceId): string {
  return DATA_CATALOG.find((item) => item.id === id)?.host ?? "";
}

export function isCatalogHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return DATA_CATALOG.some(
      (item) => host === item.host || host.endsWith(`.${item.host}`),
    );
  } catch {
    return false;
  }
}
