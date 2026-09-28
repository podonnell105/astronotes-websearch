import { inferredRelationship, OVERLAP_DISCLAIMER } from "../ontology";
import { sectorKeywords, subjectsOverlap } from "../political/sectors";
import type { Entity, Relationship } from "../types";

const LEGISLATIVE = new Set(["sponsored", "voted_on", "spoke_on", "questioned"]);
const COMPANY_LINKS = new Set(["officer_of", "psc_of", "parent_of"]);

export function inferOverlaps(entities: Entity[], relationships: Relationship[]): Relationship[] {
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const recorded = relationships.filter((rel) => (rel.basis ?? "extracted") === "recorded");
  const out: Relationship[] = [];
  out.push(...sectorOverlaps(byId, recorded));
  out.push(...donationOverlaps(byId, recorded));
  out.push(...contractOverlaps(byId, recorded));
  const seen = new Set<string>();
  return out.filter((rel) => {
    if (seen.has(rel.id)) return false;
    seen.add(rel.id);
    return true;
  });
}

function sectorOverlaps(
  byId: Map<string, Entity>,
  recorded: Relationship[],
): Relationship[] {
  const interests = recorded.filter((rel) => rel.type === "declared_interest");
  const classified = recorded.filter((rel) => rel.type === "classified_as");
  const legislative = recorded.filter((rel) => LEGISLATIVE.has(rel.type));
  const out: Relationship[] = [];

  for (const interest of interests) {
    const person = byId.get(interest.source);
    const org = byId.get(interest.target);
    if (!person || !org) continue;
    const company = resolveCompany(org, byId, recorded);
    const sectors = classified.filter((rel) => rel.source === company.id || rel.source === org.id);
    if (sectors.length === 0) continue;
    const keywords = sectors.flatMap((rel) => {
      const sector = byId.get(rel.target);
      return sector ? sectorKeywords(sector.name) : [];
    });
    for (const action of legislative.filter((rel) => rel.source === person.id)) {
      const legislation = byId.get(action.target);
      if (!legislation) continue;
      const hits = subjectsOverlap(keywords, `${legislation.name} ${action.claim}`);
      if (hits.length === 0) continue;
      const premises = [interest.id, ...sectors.map((rel) => rel.id), action.id];
      out.push(
        inferredRelationship({
          source: person.id,
          target: legislation.id,
          extraId: company.id,
          claim: `${person.name} declared an interest in ${org.name}; ${company.name} is classified under a sector that also appears in ${legislation.name}. Possible overlap, not a finding.`,
          reasoning: {
            ruleId: "sector_overlap",
            premiseIds: premises,
            steps: [
              { order: 1, relationshipId: interest.id, text: `Register entry names ${org.name}.` },
              {
                order: 2,
                relationshipId: sectors[0].id,
                text: `${company.name} is classified under ${sectors.map((rel) => byId.get(rel.target)?.name).filter(Boolean).join(", ")}.${interest.unresolved ? " The company match is name-based and weaker than a company-number match." : ""}`,
              },
              {
                order: 3,
                relationshipId: action.id,
                text: `${person.name} ${action.type.replace(/_/g, " ")} ${legislation.name}.`,
              },
              {
                order: 4,
                relationshipId: action.id,
                text: `Shared subject terms: ${hits.join(", ")}. ${OVERLAP_DISCLAIMER}`,
              },
            ],
            disclaimer: OVERLAP_DISCLAIMER,
          },
        }),
      );
    }
  }
  return out;
}

function donationOverlaps(
  byId: Map<string, Entity>,
  recorded: Relationship[],
): Relationship[] {
  const donations = recorded.filter((rel) => rel.type === "donated_to" || rel.type === "lobbied_on");
  const legislative = recorded.filter((rel) => LEGISLATIVE.has(rel.type));
  const classified = recorded.filter((rel) => rel.type === "classified_as");
  const out: Relationship[] = [];
  for (const money of donations) {
    const org = byId.get(money.source);
    const person = byId.get(money.target);
    if (!org || !person || person.kind !== "person") continue;
    const sectors = classified.filter((rel) => rel.source === org.id);
    const keywords = sectors.flatMap((rel) => {
      const sector = byId.get(rel.target);
      return sector ? sectorKeywords(sector.name) : sectorKeywords(org.name);
    });
    const terms = keywords.length ? keywords : sectorKeywords(org.name);
    for (const action of legislative.filter((rel) => rel.source === person.id)) {
      const legislation = byId.get(action.target);
      if (!legislation) continue;
      const hits = subjectsOverlap(terms, `${legislation.name} ${action.claim} ${org.name}`);
      if (hits.length === 0) continue;
      out.push(
        inferredRelationship({
          source: person.id,
          target: legislation.id,
          extraId: `${money.type}-${org.id}`,
          claim: `${org.name} ${money.type === "donated_to" ? "donated to" : "lobbied"} ${person.name}, and ${person.name} participated in ${legislation.name}. Possible overlap, not a finding.`,
          reasoning: {
            ruleId: money.type === "donated_to" ? "donation_overlap" : "lobbying_overlap",
            premiseIds: [money.id, action.id, ...sectors.map((rel) => rel.id)],
            steps: [
              { order: 1, relationshipId: money.id, text: money.claim },
              { order: 2, relationshipId: action.id, text: action.claim },
              { order: 3, relationshipId: action.id, text: `Shared terms: ${hits.join(", ")}. ${OVERLAP_DISCLAIMER}` },
            ],
            disclaimer: OVERLAP_DISCLAIMER,
          },
        }),
      );
    }
  }
  return out;
}

function contractOverlaps(
  byId: Map<string, Entity>,
  recorded: Relationship[],
): Relationship[] {
  const roles = recorded.filter((rel) => COMPANY_LINKS.has(rel.type));
  const contracts = recorded.filter((rel) => rel.type === "awarded_contract");
  const legislative = recorded.filter((rel) => LEGISLATIVE.has(rel.type));
  const classified = recorded.filter((rel) => rel.type === "classified_as");
  const out: Relationship[] = [];
  for (const role of roles) {
    const person = byId.get(role.source);
    const company = byId.get(role.target);
    if (!person || !company) continue;
    const awards = contracts.filter((rel) => rel.source === company.id);
    if (awards.length === 0) continue;
    const sectors = classified.filter((rel) => rel.source === company.id);
    const keywords = sectors.flatMap((rel) => {
      const sector = byId.get(rel.target);
      return sector ? sectorKeywords(sector.name) : [];
    });
    for (const action of legislative.filter((rel) => rel.source === person.id)) {
      const legislation = byId.get(action.target);
      if (!legislation) continue;
      const hay = `${legislation.name} ${action.claim} ${awards.map((rel) => rel.claim).join(" ")}`;
      const hits = subjectsOverlap(keywords.length ? keywords : sectorKeywords(company.name), hay);
      if (hits.length === 0) continue;
      out.push(
        inferredRelationship({
          source: person.id,
          target: legislation.id,
          extraId: `contract-${company.id}`,
          claim: `${person.name} is recorded as an officer or PSC of ${company.name}, which holds a public contract, and ${person.name} participated in ${legislation.name}. Possible overlap, not a finding.`,
          reasoning: {
            ruleId: "contract_overlap",
            premiseIds: [role.id, ...awards.map((rel) => rel.id), action.id],
            steps: [
              { order: 1, relationshipId: role.id, text: role.claim },
              { order: 2, relationshipId: awards[0].id, text: awards[0].claim },
              { order: 3, relationshipId: action.id, text: action.claim },
              { order: 4, relationshipId: action.id, text: `Shared terms: ${hits.join(", ")}. ${OVERLAP_DISCLAIMER}` },
            ],
            disclaimer: OVERLAP_DISCLAIMER,
          },
        }),
      );
    }
  }
  return out;
}

function resolveCompany(
  org: Entity,
  byId: Map<string, Entity>,
  recorded: Relationship[],
): Entity {
  if (org.kind === "company") return org;
  const name = org.name.toLowerCase();
  for (const entity of byId.values()) {
    if (entity.kind !== "company") continue;
    const other = entity.name.toLowerCase();
    if (other === name || other.includes(name) || name.includes(other)) return entity;
  }
  const linked = recorded.find(
    (rel) => rel.type === "same_as" && (rel.source === org.id || rel.target === org.id),
  );
  if (linked) {
    const other = byId.get(linked.source === org.id ? linked.target : linked.source);
    if (other) return other;
  }
  return org;
}
