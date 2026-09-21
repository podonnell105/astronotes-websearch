import { DEMO_QUERY } from "./demo";
import type { QueryTemplate } from "./types";

export const QUERY_TEMPLATES: QueryTemplate[] = [
  {
    id: "landscape",
    label: "Landscape",
    query:
      "Who is building lunar communication infrastructure, and which links to NASA are contracted versus announced?",
  },
  {
    id: "counterparty",
    label: "Counterparty",
    query:
      "How are Nokia, NASA, and SpaceX connected on Artemis communications, and which relationships have public evidence?",
  },
  {
    id: "audit",
    label: "Claim audit",
    query:
      "Which Nokia–NASA lunar communications claims are evidenced versus announcement-only, and where do sources disagree?",
  },
];

export const DEFAULT_QUERY = QUERY_TEMPLATES[0]?.query ?? DEMO_QUERY;
