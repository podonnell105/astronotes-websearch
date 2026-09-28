const SIC_SECTORS: Array<{ prefix: string; label: string; keywords: string[] }> = [
  { prefix: "06", label: "Oil and gas extraction", keywords: ["oil", "gas", "petroleum", "hydrocarbon", "energy"] },
  { prefix: "19", label: "Coke and refined petroleum", keywords: ["petroleum", "refinery", "fuel", "oil"] },
  { prefix: "21", label: "Pharmaceuticals", keywords: ["pharma", "drug", "medicine", "health", "nhs"] },
  { prefix: "24", label: "Basic metals", keywords: ["steel", "metal", "mining"] },
  { prefix: "26", label: "Computer and electronics", keywords: ["semiconductor", "electronics", "chip", "technology"] },
  { prefix: "35", label: "Electricity and gas supply", keywords: ["electricity", "energy", "grid", "nuclear", "renewable", "power"] },
  { prefix: "41", label: "Construction", keywords: ["housing", "planning", "infrastructure", "construction", "building"] },
  { prefix: "49", label: "Land transport", keywords: ["rail", "transport", "roads", "highways"] },
  { prefix: "51", label: "Air transport", keywords: ["aviation", "airport", "airline"] },
  { prefix: "61", label: "Telecommunications", keywords: ["telecom", "broadband", "communications", "spectrum"] },
  { prefix: "62", label: "Computer programming", keywords: ["software", "digital", "technology", "data", "ai"] },
  { prefix: "64", label: "Financial services", keywords: ["bank", "finance", "treasury", "tax", "investment"] },
  { prefix: "65", label: "Insurance", keywords: ["insurance", "pension"] },
  { prefix: "66", label: "Auxiliary finance", keywords: ["finance", "lobby", "advisory"] },
  { prefix: "68", label: "Real estate", keywords: ["housing", "property", "planning", "lease"] },
  { prefix: "72", label: "Scientific research", keywords: ["research", "science", "innovation"] },
  { prefix: "84", label: "Public administration", keywords: ["defence", "defense", "security", "government"] },
  { prefix: "86", label: "Human health", keywords: ["health", "nhs", "hospital", "care"] },
  { prefix: "93", label: "Sports and recreation", keywords: ["sport", "gambling", "betting"] },
];

export function sectorFromSic(code: string): { id: string; label: string; keywords: string[] } | undefined {
  const digits = code.replace(/\D/g, "").slice(0, 2);
  if (!digits) return undefined;
  const match = SIC_SECTORS.find((item) => item.prefix === digits);
  if (match) return { id: `sic-${match.prefix}`, label: match.label, keywords: match.keywords };
  return { id: `sic-${digits}`, label: `SIC ${code}`, keywords: [] };
}

export function sectorKeywords(label: string): string[] {
  const lower = label.toLowerCase();
  const extra = SIC_SECTORS.filter((item) =>
    item.keywords.some((word) => lower.includes(word)) || lower.includes(item.label.toLowerCase()),
  ).flatMap((item) => item.keywords);
  return [...new Set([lower, ...extra, ...tokenize(label)])];
}

export function subjectsOverlap(sectorKeywordsList: string[], legislationText: string): string[] {
  const hay = legislationText.toLowerCase();
  return [...new Set(sectorKeywordsList)]
    .filter((word) => word.length >= 4 && hay.includes(word.toLowerCase()));
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4);
}
