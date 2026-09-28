export const FACET_IDS = [
  "identity",
  "background",
  "roles",
  "employment",
  "companies",
  "ownership",
  "directorships",
  "funding",
  "products",
  "technology",
  "customers",
  "competitors",
  "partnerships",
  "hiring",
  "contracts",
  "political_activity",
  "donations",
  "lobbying",
  "regulatory",
  "legal",
  "patents",
  "research",
  "publications",
  "media",
  "events",
  "relationships",
  "timeline",
  "recent_activity",
] as const;

export type FacetId = (typeof FACET_IDS)[number];

export const LEGACY_FACET_MAP: Record<string, FacetId> = {
  jobs: "hiring",
  hires: "employment",
  product: "products",
  funding: "funding",
  timeline: "timeline",
  donors: "donations",
};

export type FacetDef = {
  id: FacetId;
  entityTypes: string[];
  gap: (subject: string) => string;
  queryHints: string[];
  keywords: string[];
  relationshipTypes: string[];
  test: RegExp;
};

export const FACETS: FacetDef[] = [
  {
    id: "identity",
    entityTypes: [],
    gap: (subject) => `who or what ${subject} is`,
    queryHints: ["official", "about", "profile"],
    keywords: ["official", "profile", "about", "biography", "company number"],
    relationshipTypes: ["same_as", "classified_as"],
    test: /\b(who is|what is|identity|legal name|lei|company number)\b/i,
  },
  {
    id: "background",
    entityTypes: ["person", "organization", "company"],
    gap: (subject) => `background and history of ${subject}`,
    queryHints: ["biography", "background", "history"],
    keywords: ["biography", "background", "history", "born", "education"],
    relationshipTypes: ["educated_at", "born_in", "lived_in"],
    test: /\b(background|biography|education|born|career history)\b/i,
  },
  {
    id: "roles",
    entityTypes: ["person"],
    gap: (subject) => `roles and offices held by ${subject}`,
    queryHints: ["role", "director", "CEO", "minister", "office"],
    keywords: ["director", "ceo", "minister", "office", "role", "appointment"],
    relationshipTypes: ["holds_office", "officer_of", "member_of", "chairs"],
    test: /\b(role|roles|office|minister|director|ceo|appointment)\b/i,
  },
  {
    id: "employment",
    entityTypes: ["person"],
    gap: (subject) => `employment and leadership changes involving ${subject}`,
    queryHints: ["joined", "hired", "works at"],
    keywords: ["hired", "joined", "appointment", "leadership", "works"],
    relationshipTypes: ["works_at", "joined", "officer_of"],
    test: /\b(recent hires?|hired|joined|appointment|new (cmo|cto|ceo|head|vp)|works at|employer)\b/i,
  },
  {
    id: "companies",
    entityTypes: ["person", "organization"],
    gap: (subject) => `companies and organisations connected to ${subject}`,
    queryHints: ["company", "founder", "director"],
    keywords: ["company", "founder", "director", "organisation", "startup"],
    relationshipTypes: ["officer_of", "psc_of", "founded", "cofounded", "member_of"],
    test: /\b(companies|company|founder|founded|organisation|organization)\b/i,
  },
  {
    id: "ownership",
    entityTypes: ["company", "organization", "person", "product"],
    gap: (subject) => `ownership of ${subject}`,
    queryHints: ["owner", "ownership", "parent company", "PSC"],
    keywords: ["owner", "ownership", "parent", "psc", "shareholder"],
    relationshipTypes: ["psc_of", "parent_of", "owned_by", "owns"],
    test: /\b(owner|ownership|parent company|shareholder|psc)\b/i,
  },
  {
    id: "directorships",
    entityTypes: ["person", "company"],
    gap: (subject) => `directorships involving ${subject}`,
    queryHints: ["director", "board", "officer"],
    keywords: ["director", "board", "officer", "directorship"],
    relationshipTypes: ["officer_of", "director_of"],
    test: /\b(director|directorship|board member|officer of)\b/i,
  },
  {
    id: "funding",
    entityTypes: ["company", "organization", "person", "product"],
    gap: (subject) => `funding and investors for ${subject}`,
    queryHints: ["funding", "investors", "raised"],
    keywords: ["funding", "investors", "valuation", "raised", "series"],
    relationshipTypes: ["funds", "funded_by", "invested_in", "investor_in"],
    test: /\b(raised|funding|investors?|series [a-d]|valuation)\b/i,
  },
  {
    id: "products",
    entityTypes: ["company", "organization", "person", "product"],
    gap: (subject) => `what ${subject} is building`,
    queryHints: ["product", "roadmap", "launch"],
    keywords: ["product", "roadmap", "launch", "shipping"],
    relationshipTypes: ["creates", "created", "sells", "owns_product"],
    test: /\b(building next|roadmap|what are they building|product|shipping|launching)\b/i,
  },
  {
    id: "technology",
    entityTypes: ["company", "organization", "product", "person"],
    gap: (subject) => `technology used or built by ${subject}`,
    queryHints: ["technology", "stack", "platform"],
    keywords: ["technology", "stack", "platform", "software", "model"],
    relationshipTypes: ["uses", "builds", "developed"],
    test: /\b(technolog|software|stack|platform|model|github)\b/i,
  },
  {
    id: "customers",
    entityTypes: ["company", "organization", "product"],
    gap: (subject) => `who buys from ${subject}`,
    queryHints: ["customers", "clients", "case study"],
    keywords: ["customers", "clients", "case study", "buyer"],
    relationshipTypes: ["customer_of", "buys_from", "supplies"],
    test: /\b(customers?|clients?|who buys|case stud)\b/i,
  },
  {
    id: "competitors",
    entityTypes: ["company", "organization", "product"],
    gap: (subject) => `competitors of ${subject}`,
    queryHints: ["competitors", "alternative", "vs"],
    keywords: ["competitor", "alternative", "rival"],
    relationshipTypes: ["competes_with", "alternative_to"],
    test: /\b(competitors?|rival|alternative to|vs\.?)\b/i,
  },
  {
    id: "partnerships",
    entityTypes: ["company", "organization", "person"],
    gap: (subject) => `partnerships involving ${subject}`,
    queryHints: ["partner", "partnership", "alliance"],
    keywords: ["partner", "partnership", "alliance", "collaboration"],
    relationshipTypes: ["partners_with", "alliance_with"],
    test: /\b(partners?|partnerships?|alliance|collaboration)\b/i,
  },
  {
    id: "hiring",
    entityTypes: ["company", "organization"],
    gap: (subject) => `open roles and job postings at ${subject}`,
    queryHints: ["jobs", "hiring", "careers"],
    keywords: ["jobs", "hiring", "careers", "openings", "recruit"],
    relationshipTypes: ["hiring_for"],
    test: /\b(job postings?|jobs|hiring|careers?|openings?|recruit)\b/i,
  },
  {
    id: "contracts",
    entityTypes: ["company", "organization", "person"],
    gap: (subject) => `contracts and procurement involving ${subject}`,
    queryHints: ["contract", "procurement", "award"],
    keywords: ["contract", "procurement", "award", "tender"],
    relationshipTypes: ["awarded_contract"],
    test: /\b(contract|procurement|tender|award)\b/i,
  },
  {
    id: "political_activity",
    entityTypes: ["person", "organization", "company"],
    gap: (subject) => `political activity of ${subject}`,
    queryHints: ["parliament", "congress", "votes", "speech"],
    keywords: ["parliament", "congress", "vote", "hansard", "minister"],
    relationshipTypes: ["holds_office", "voted_on", "spoke_on", "sponsored", "questioned"],
    test: /\b(mp\b|mla\b|mep\b|parliament|congress|politician|minister|hansard|stormont|oireachtas)\b/i,
  },
  {
    id: "donations",
    entityTypes: ["person", "organization", "company"],
    gap: (subject) => `donors, donations, gifts, and fundraising for ${subject}`,
    queryHints: ["donations", "donors", "Electoral Commission", "register of interests"],
    keywords: [
      "donor",
      "donors",
      "donation",
      "donations",
      "donated",
      "fundraising",
      "register of interests",
      "electoral commission",
    ],
    relationshipTypes: ["donated_to", "funds", "funded_by"],
    test: /\b(donors?|donations?|donated|fundraising|who funds|campaign finance|register of interests)\b/i,
  },
  {
    id: "lobbying",
    entityTypes: ["person", "organization", "company"],
    gap: (subject) => `lobbying activity involving ${subject}`,
    queryHints: ["lobbying", "lobbyist", "transparency register"],
    keywords: ["lobby", "lobbying", "lobbyist"],
    relationshipTypes: ["lobbied_on"],
    test: /\b(lobby|lobbying|lobbyist)\b/i,
  },
  {
    id: "regulatory",
    entityTypes: ["company", "organization", "person", "product"],
    gap: (subject) => `regulatory status of ${subject}`,
    queryHints: ["regulator", "licence", "compliance"],
    keywords: ["regulator", "licence", "license", "compliance", "fda"],
    relationshipTypes: ["regulated_by"],
    test: /\b(regulat|licence|license|compliance|fda)\b/i,
  },
  {
    id: "legal",
    entityTypes: ["person", "company", "organization"],
    gap: (subject) => `legal matters involving ${subject}`,
    queryHints: ["lawsuit", "court", "sanctions"],
    keywords: ["lawsuit", "court", "litigation", "sanctions"],
    relationshipTypes: ["sued", "sanctioned"],
    test: /\b(lawsuit|litigation|court|sanctions?|indict)\b/i,
  },
  {
    id: "patents",
    entityTypes: ["person", "company", "organization", "product", "technology"],
    gap: (subject) => `patents associated with ${subject}`,
    queryHints: ["patent", "USPTO", "inventor"],
    keywords: ["patent", "inventor", "uspto"],
    relationshipTypes: ["invented", "patented"],
    test: /\b(patents?|uspto|inventor)\b/i,
  },
  {
    id: "research",
    entityTypes: ["person", "organization", "company", "technology"],
    gap: (subject) => `research activity of ${subject}`,
    queryHints: ["research", "lab", "study"],
    keywords: ["research", "lab", "study", "trial"],
    relationshipTypes: ["researches", "authored"],
    test: /\b(research(er)?|laboratory|clinical trial|nih)\b/i,
  },
  {
    id: "publications",
    entityTypes: ["person", "organization"],
    gap: (subject) => `publications by ${subject}`,
    queryHints: ["papers", "publications", "doi"],
    keywords: ["paper", "publication", "doi", "journal"],
    relationshipTypes: ["authored", "published"],
    test: /\b(papers?|publications?|journal|doi)\b/i,
  },
  {
    id: "media",
    entityTypes: [],
    gap: (subject) => `media coverage of ${subject}`,
    queryHints: ["news", "interview", "press"],
    keywords: ["news", "interview", "press", "media"],
    relationshipTypes: ["mentioned_in"],
    test: /\b(news|interview|press|media coverage)\b/i,
  },
  {
    id: "events",
    entityTypes: [],
    gap: (subject) => `events involving ${subject}`,
    queryHints: ["conference", "event", "summit"],
    keywords: ["conference", "event", "summit", "hearing"],
    relationshipTypes: ["spoke_at", "attended"],
    test: /\b(conference|summit|event|hearing)\b/i,
  },
  {
    id: "relationships",
    entityTypes: [],
    gap: (subject) => `relationships around ${subject}`,
    queryHints: ["connected", "relationship", "network"],
    keywords: ["connected", "relationship", "network", "link"],
    relationshipTypes: ["possible_overlap", "same_as", "member_of"],
    test: /\b(connected to|relationship|how is .+ connected|network)\b/i,
  },
  {
    id: "timeline",
    entityTypes: [],
    gap: (subject) => `when ${subject} lived, founded companies, or was acquired`,
    queryHints: ["timeline", "founded", "history", "dates"],
    keywords: ["biography", "timeline", "founded", "born", "career", "history"],
    relationshipTypes: ["founded", "acquired", "born_in", "joined"],
    test: /\b(timeline|history|career|lived|founded|acquired|biography|background|born)\b/i,
  },
  {
    id: "recent_activity",
    entityTypes: [],
    gap: (subject) => `recent activity of ${subject}`,
    queryHints: ["recent", "latest", "announced"],
    keywords: ["recent", "latest", "announced", "today"],
    relationshipTypes: ["announced", "launched"],
    test: /\b(recent|latest|what changed|announced|this week|today)\b/i,
  },
];

const FACET_SET = new Set<string>(FACET_IDS);

export function isFacetId(value: string): value is FacetId {
  return FACET_SET.has(value);
}

export function normalizeFacetId(value: unknown): FacetId | undefined {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (isFacetId(raw)) return raw;
  return LEGACY_FACET_MAP[raw];
}

export function facetById(id: FacetId): FacetDef {
  return FACETS.find((facet) => facet.id === id) ?? FACETS[0];
}

export function detectFacets(question: string): FacetId[] {
  return uniqueFacets(FACETS.filter((facet) => facet.test.test(question)).map((facet) => facet.id));
}

export function facetKeywords(facets: FacetId[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const facet of FACETS) {
    if (!facets.includes(facet.id)) continue;
    for (const keyword of facet.keywords) {
      const key = keyword.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(keyword);
    }
  }
  return out;
}

export function facetAppliesTo(facet: FacetDef, entityType?: string): boolean {
  if (!facet.entityTypes.length) return true;
  if (!entityType) return true;
  const type = entityType.toLowerCase();
  if (facet.entityTypes.includes(type)) return true;
  if (type === "organisation" && facet.entityTypes.includes("organization")) return true;
  if (type === "organization" && facet.entityTypes.includes("organisation")) return true;
  return false;
}

export function relationshipMatchesFacet(
  rel: { type: string; claim: string; category?: string },
  facet: FacetId,
): boolean {
  const def = facetById(facet);
  if (def.relationshipTypes.includes(rel.type)) return true;
  const hay = `${rel.type} ${rel.claim} ${rel.category ?? ""}`.toLowerCase();
  if (facet === "donations") {
    return /\b(donat|donor|fundraising|gift|hospitality|register of interests)\b/i.test(hay);
  }
  if (facet === "funding") {
    return /\b(investor|funding|raised)\b/i.test(hay);
  }
  return def.keywords.some((keyword) => hay.includes(keyword.toLowerCase()));
}

export function uniqueFacets(values: Array<FacetId | string | undefined>): FacetId[] {
  const seen = new Set<FacetId>();
  const out: FacetId[] = [];
  for (const value of values) {
    const id = normalizeFacetId(value);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
