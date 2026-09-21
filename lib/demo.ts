import type {
  Entity,
  Relationship,
  SearchResult,
  Validation,
} from "./types";

export const DEMO_QUERY =
  "Who is building lunar communication infrastructure?";

export const DEMO_SEARCH_RESULTS: SearchResult[] = [
  {
    title: "NASA, Nokia to deploy 4G/LTE network on the Moon",
    url: "https://www.nasa.gov/news/lunar-4g-nokia",
    snippet:
      "NASA selected Nokia to develop and deploy the first cellular network on the lunar surface to support Artemis astronauts and autonomous systems.",
    source: "NASA",
    publishedAt: "2024-10-08",
  },
  {
    title: "Nokia Bell Labs lunar network for Artemis",
    url: "https://www.nokia.com/about/news/lunar-communications",
    snippet:
      "Nokia Bell Labs is building a space-grade LTE/4G network intended to provide voice, video, and telemetry between lunar landers, rovers, and habitat systems.",
    source: "Nokia",
    publishedAt: "2024-10-09",
  },
  {
    title: "SpaceX Starship selected for Artemis human landing",
    url: "https://www.spacex.com/updates/artemis-hls",
    snippet:
      "SpaceX is developing Starship as NASA's Human Landing System, creating a demand for high-bandwidth links between lunar orbit, the surface, and Earth.",
    source: "SpaceX",
    publishedAt: "2024-05-12",
  },
  {
    title: "Lockheed Martin Orion and lunar comms relay work",
    url: "https://www.lockheedmartin.com/en-us/products/orion.html",
    snippet:
      "Lockheed Martin builds the Orion crew vehicle for Artemis and has studied lunar relay architectures, but it is not the prime vendor for surface cellular infrastructure.",
    source: "Lockheed Martin",
    publishedAt: "2024-03-21",
  },
  {
    title: "Intelsat role in space communications",
    url: "https://www.intelsat.com/news/space-communications",
    snippet:
      "Intelsat operates a large geostationary communications fleet and has partnered with NASA on Earth-orbit services; a dedicated lunar surface network is not confirmed.",
    source: "Intelsat",
    publishedAt: "2023-11-02",
  },
  {
    title: "Reuters: Race to wire the Moon",
    url: "https://www.reuters.com/technology/lunar-communications",
    snippet:
      "NASA's Artemis program has become a catalyst for commercial lunar communications, with Nokia's cellular payload and SpaceX's lander driving near-term infrastructure.",
    source: "Reuters",
    publishedAt: "2025-01-16",
  },
  {
    title: "Artemis program overview",
    url: "https://www.nasa.gov/artemis",
    snippet:
      "Artemis will land astronauts near the lunar south pole and requires surface communications, navigation, and data relay as core infrastructure.",
    source: "NASA",
    publishedAt: "2024-12-01",
  },
];

export const DEMO_ENTITIES: Entity[] = [
  { id: "nasa", name: "NASA", type: "organization" },
  { id: "nokia", name: "Nokia", type: "company" },
  { id: "spacex", name: "SpaceX", type: "company" },
  { id: "artemis", name: "Artemis", type: "mission" },
  {
    id: "lunar-communications",
    name: "Lunar communications",
    type: "technology",
  },
  { id: "intelsat", name: "Intelsat", type: "company" },
  { id: "lockheed-martin", name: "Lockheed Martin", type: "company" },
  { id: "nokia-bell-labs", name: "Nokia Bell Labs", type: "organization" },
];

export const DEMO_RELATIONSHIPS: Relationship[] = [
  {
    id: "nasa__partners_with__nokia",
    source: "nasa",
    target: "nokia",
    type: "partners_with",
    claim: "NASA is working with Nokia on lunar communications.",
    status: "announced",
    sourceUrl: "https://www.nasa.gov/news/lunar-4g-nokia",
    evidenceSnippet:
      "NASA selected Nokia to develop and deploy the first cellular network on the lunar surface to support Artemis astronauts and autonomous systems.",
  },
  {
    id: "nokia__develops__lunar-communications",
    source: "nokia",
    target: "lunar-communications",
    type: "develops",
    claim: "Nokia is developing lunar communications infrastructure.",
    status: "announced",
    sourceUrl: "https://www.nokia.com/about/news/lunar-communications",
    evidenceSnippet:
      "Nokia Bell Labs is building a space-grade LTE/4G network intended to provide voice, video, and telemetry between lunar landers, rovers, and habitat systems.",
  },
  {
    id: "nokia-bell-labs__develops__lunar-communications",
    source: "nokia-bell-labs",
    target: "lunar-communications",
    type: "develops",
    claim: "Nokia Bell Labs is building a space-grade lunar LTE/4G network.",
    status: "announced",
    sourceUrl: "https://www.nokia.com/about/news/lunar-communications",
    evidenceSnippet:
      "Nokia Bell Labs is building a space-grade LTE/4G network intended to provide voice, video, and telemetry between lunar landers, rovers, and habitat systems.",
  },
  {
    id: "nasa__operates__artemis",
    source: "nasa",
    target: "artemis",
    type: "operates",
    claim: "NASA operates the Artemis lunar exploration program.",
    status: "deployed",
    sourceUrl: "https://www.nasa.gov/artemis",
    evidenceSnippet:
      "Artemis will land astronauts near the lunar south pole and requires surface communications, navigation, and data relay as core infrastructure.",
  },
  {
    id: "artemis__uses__lunar-communications",
    source: "artemis",
    target: "lunar-communications",
    type: "uses",
    claim: "Artemis depends on lunar communications infrastructure.",
    status: "announced",
    sourceUrl: "https://www.nasa.gov/artemis",
    evidenceSnippet:
      "Artemis will land astronauts near the lunar south pole and requires surface communications, navigation, and data relay as core infrastructure.",
  },
  {
    id: "nasa__works_with__spacex",
    source: "nasa",
    target: "spacex",
    type: "works_with",
    claim: "NASA is working with SpaceX on Artemis human landing.",
    status: "announced",
    sourceUrl: "https://www.spacex.com/updates/artemis-hls",
    evidenceSnippet:
      "SpaceX is developing Starship as NASA's Human Landing System, creating a demand for high-bandwidth links between lunar orbit, the surface, and Earth.",
  },
  {
    id: "nasa__funds__lunar-communications",
    source: "nasa",
    target: "lunar-communications",
    type: "funds",
    claim: "NASA is funding lunar communications as Artemis infrastructure.",
    status: "announced",
    sourceUrl: "https://www.reuters.com/technology/lunar-communications",
    evidenceSnippet:
      "NASA's Artemis program has become a catalyst for commercial lunar communications, with Nokia's cellular payload and SpaceX's lander driving near-term infrastructure.",
  },
  {
    id: "lockheed-martin__supplies__nasa",
    source: "lockheed-martin",
    target: "nasa",
    type: "supplies",
    claim: "Lockheed Martin supplies NASA with the Orion crew vehicle.",
    status: "deployed",
    sourceUrl: "https://www.lockheedmartin.com/en-us/products/orion.html",
    evidenceSnippet:
      "Lockheed Martin builds the Orion crew vehicle for Artemis and has studied lunar relay architectures, but it is not the prime vendor for surface cellular infrastructure.",
  },
  {
    id: "lockheed-martin__works_with__nasa",
    source: "lockheed-martin",
    target: "nasa",
    type: "works_with",
    claim: "Lockheed Martin works with NASA on Artemis crew systems.",
    status: "deployed",
    sourceUrl: "https://www.lockheedmartin.com/en-us/products/orion.html",
    evidenceSnippet:
      "Lockheed Martin builds the Orion crew vehicle for Artemis and has studied lunar relay architectures, but it is not the prime vendor for surface cellular infrastructure.",
  },
  {
    id: "spacex__launches__artemis",
    source: "spacex",
    target: "artemis",
    type: "launches",
    claim: "SpaceX launches the entire Artemis program.",
    status: "unclear",
    sourceUrl: "https://www.spacex.com/updates/artemis-hls",
    evidenceSnippet:
      "SpaceX is developing Starship as NASA's Human Landing System, creating a demand for high-bandwidth links between lunar orbit, the surface, and Earth.",
  },
  {
    id: "intelsat__partners_with__nasa",
    source: "intelsat",
    target: "nasa",
    type: "partners_with",
    claim: "Intelsat is NASA's prime partner for lunar surface communications.",
    status: "announced",
    sourceUrl: "https://www.intelsat.com/news/space-communications",
    evidenceSnippet:
      "Intelsat operates a large geostationary communications fleet and has partnered with NASA on Earth-orbit services; a dedicated lunar surface network is not confirmed.",
  },
  {
    id: "intelsat__supplies__lunar-communications",
    source: "intelsat",
    target: "lunar-communications",
    type: "supplies",
    claim: "Intelsat supplies the lunar surface cellular network.",
    status: "announced",
    sourceUrl: "https://www.intelsat.com/news/space-communications",
    evidenceSnippet:
      "Intelsat operates a large geostationary communications fleet and has partnered with NASA on Earth-orbit services; a dedicated lunar surface network is not confirmed.",
  },
  {
    id: "lockheed-martin__develops__lunar-communications",
    source: "lockheed-martin",
    target: "lunar-communications",
    type: "develops",
    claim: "Lockheed Martin is the prime developer of lunar cellular infrastructure.",
    status: "announced",
    sourceUrl: "https://www.lockheedmartin.com/en-us/products/orion.html",
    evidenceSnippet:
      "Lockheed Martin builds the Orion crew vehicle for Artemis and has studied lunar relay architectures, but it is not the prime vendor for surface cellular infrastructure.",
  },
  {
    id: "spacex__uses__lunar-communications",
    source: "spacex",
    target: "lunar-communications",
    type: "uses",
    claim: "SpaceX landers will use lunar communications links.",
    status: "announced",
    sourceUrl: "https://www.reuters.com/technology/lunar-communications",
    evidenceSnippet:
      "NASA's Artemis program has become a catalyst for commercial lunar communications, with Nokia's cellular payload and SpaceX's lander driving near-term infrastructure.",
  },
];

export const DEMO_VALIDATIONS: Record<string, Validation> = {
  "nasa__partners_with__nokia": {
    decision: "SUPPORTED",
    confidence: 0.94,
    model: "mock",
    probabilities: { SUPPORTED: 0.94, CONTRADICTED: 0.01, UNCERTAIN: 0.05 },
  },
  "nokia__develops__lunar-communications": {
    decision: "SUPPORTED",
    confidence: 0.96,
    model: "mock",
    probabilities: { SUPPORTED: 0.96, CONTRADICTED: 0.01, UNCERTAIN: 0.03 },
  },
  "nokia-bell-labs__develops__lunar-communications": {
    decision: "SUPPORTED",
    confidence: 0.93,
    model: "mock",
    probabilities: { SUPPORTED: 0.93, CONTRADICTED: 0.01, UNCERTAIN: 0.06 },
  },
  "nasa__operates__artemis": {
    decision: "SUPPORTED",
    confidence: 0.99,
    model: "mock",
    probabilities: { SUPPORTED: 0.99, CONTRADICTED: 0.0, UNCERTAIN: 0.01 },
  },
  "artemis__uses__lunar-communications": {
    decision: "SUPPORTED",
    confidence: 0.9,
    model: "mock",
    probabilities: { SUPPORTED: 0.9, CONTRADICTED: 0.02, UNCERTAIN: 0.08 },
  },
  "nasa__works_with__spacex": {
    decision: "SUPPORTED",
    confidence: 0.92,
    model: "mock",
    probabilities: { SUPPORTED: 0.92, CONTRADICTED: 0.01, UNCERTAIN: 0.07 },
  },
  "nasa__funds__lunar-communications": {
    decision: "SUPPORTED",
    confidence: 0.84,
    model: "mock",
    probabilities: { SUPPORTED: 0.84, CONTRADICTED: 0.04, UNCERTAIN: 0.12 },
  },
  "lockheed-martin__supplies__nasa": {
    decision: "SUPPORTED",
    confidence: 0.88,
    model: "mock",
    probabilities: { SUPPORTED: 0.88, CONTRADICTED: 0.03, UNCERTAIN: 0.09 },
  },
  "lockheed-martin__works_with__nasa": {
    decision: "SUPPORTED",
    confidence: 0.91,
    model: "mock",
    probabilities: { SUPPORTED: 0.91, CONTRADICTED: 0.02, UNCERTAIN: 0.07 },
  },
  "spacex__launches__artemis": {
    decision: "UNCERTAIN",
    confidence: 0.61,
    model: "mock",
    probabilities: { SUPPORTED: 0.22, CONTRADICTED: 0.17, UNCERTAIN: 0.61 },
  },
  "intelsat__partners_with__nasa": {
    decision: "UNCERTAIN",
    confidence: 0.58,
    model: "mock",
    probabilities: { SUPPORTED: 0.21, CONTRADICTED: 0.21, UNCERTAIN: 0.58 },
  },
  "intelsat__supplies__lunar-communications": {
    decision: "UNCERTAIN",
    confidence: 0.7,
    model: "mock",
    probabilities: { SUPPORTED: 0.12, CONTRADICTED: 0.18, UNCERTAIN: 0.7 },
  },
  "lockheed-martin__develops__lunar-communications": {
    decision: "CONTRADICTED",
    confidence: 0.81,
    model: "mock",
    probabilities: { SUPPORTED: 0.08, CONTRADICTED: 0.81, UNCERTAIN: 0.11 },
  },
  "spacex__uses__lunar-communications": {
    decision: "SUPPORTED",
    confidence: 0.73,
    model: "mock",
    probabilities: { SUPPORTED: 0.73, CONTRADICTED: 0.06, UNCERTAIN: 0.21 },
  },
};

export function sourcesForRelationship(rel: Relationship): SearchResult[] {
  const direct = DEMO_SEARCH_RESULTS.filter((r) => r.url === rel.sourceUrl);
  const extras = DEMO_SEARCH_RESULTS.filter(
    (r) =>
      r.url !== rel.sourceUrl &&
      (rel.claim.toLowerCase().includes(r.source?.toLowerCase() ?? "") ||
        r.snippet.toLowerCase().includes(rel.source) ||
        r.snippet.toLowerCase().includes(rel.target.replace(/-/g, " "))),
  ).slice(0, 2);
  const merged = [...direct, ...extras];
  return merged.length > 0 ? merged : DEMO_SEARCH_RESULTS.slice(0, 2);
}
