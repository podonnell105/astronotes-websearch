import { getJson } from "./fetchJson";
import type { Document } from "./search";

const PER_SOURCE = 2;

type Trial = {
  protocolSection?: {
    identificationModule?: {
      nctId?: string;
      briefTitle?: string;
      officialTitle?: string;
    };
    statusModule?: {
      overallStatus?: string;
      startDateStruct?: { date?: string };
    };
    sponsorCollaboratorsModule?: {
      leadSponsor?: { name?: string };
    };
  };
};

export async function lookupClinicalTrials(names: string[]): Promise<Document[]> {
  const found: Document[] = [];
  for (const name of names.slice(0, 2)) {
    if (found.length >= PER_SOURCE) break;
    const params = new URLSearchParams({
      "query.term": name,
      pageSize: String(PER_SOURCE),
      countTotal: "false",
    });
    const data = await getJson<{ studies?: Trial[] }>(
      `https://clinicaltrials.gov/api/v2/studies?${params.toString()}`,
    );
    for (const study of data?.studies ?? []) {
      if (found.length >= PER_SOURCE) break;
      const ident = study.protocolSection?.identificationModule;
      const nct = String(ident?.nctId ?? "").trim();
      if (!nct) continue;
      const status = study.protocolSection?.statusModule?.overallStatus || "";
      const start = study.protocolSection?.statusModule?.startDateStruct?.date || "";
      const sponsor =
        study.protocolSection?.sponsorCollaboratorsModule?.leadSponsor?.name || name;
      const title = ident?.briefTitle || ident?.officialTitle || nct;
      const url = `https://clinicaltrials.gov/study/${encodeURIComponent(nct)}`;
      const snippet = [
        `ClinicalTrials.gov ${nct}: ${title}.`,
        `Sponsor ${sponsor}.`,
        status ? `Status ${status}.` : "",
        start ? `Start ${start}.` : "",
        "A registered trial is operational evidence; a press 'will start a trial' without this record remains announced.",
      ]
        .filter(Boolean)
        .join(" ");
      found.push({
        title: `${nct} — ${title}`,
        url,
        snippet,
        source: "clinicaltrials.gov",
        publishedAt: start.slice(0, 10) || undefined,
        text: snippet,
      });
    }
  }
  return found.slice(0, PER_SOURCE);
}
