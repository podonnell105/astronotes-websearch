import { getJevApiKey } from "./config";
import type { Entity, Validation, ValidationDecision } from "./types";

export type JevChoiceQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
};

export type JevAnswer = {
  choice: string;
  confidence?: number;
  probabilities?: Record<string, number>;
};

export type JevResult = {
  model: "jev" | "mock";
  jevModelVersion?: string;
  answers: Record<string, JevAnswer>;
  error?: string;
};

const CLAIM_CRITERIA = {
  SUPPORTED:
    "The evidence snippet directly supports the claim as stated, including its operational status (deployed vs announced). For identity and role claims (founded, cofounded, CEO, chairman, partner, investor, educated_at), an encyclopedia, Wikipedia, or independent biography stating the role is enough. A first-party About or team page may support that identity sentence if it is a direct factual statement, not a product pitch. A press release or future intent is not enough to support a deployed contract or operations claim.",
  CONTRADICTED:
    "The evidence denies the claimed role, relationship, or status (for example: the named party is not the prime, not selected, or not operating).",
  UNCERTAIN:
    "The source is off-topic, too thin, page chrome, satire treated as fact, a laundry-list of names with no role, or an announcement used to back a deployed contract claim. Use this when the snippet does not clearly confirm or deny the claim as stated.",
};

const MATCH_CRITERIA = {
  YES: "They refer to the same relevant entity for this research graph.",
  NO: "They are distinct entities and should not be merged.",
  UNCERTAIN: "There is not enough information to decide.",
};

/**
 * Adapter entry point used by the pipeline.
 *
 * If JEV_API_KEY is missing, returns mock answers labeled model:"mock".
 * If the key is present, calls evaluateWithJev. On API failure the caller
 * should fall back to mock and surface the error — this function does not
 * pretend a live Jev call succeeded.
 */
export async function evaluateQuestions(
  state: unknown,
  questions: Record<string, JevChoiceQuestion>,
): Promise<JevResult> {
  if (!getJevApiKey()) {
    return mockEvaluate(state, questions);
  }
  return evaluateWithJev(state, questions);
}

/**
 * WIRE TO REAL JEV HERE.
 *
 * Official TypeSafe System One: POST https://api.typesafe.ai/v1/systemone
 * SDK: @typesafe-ai/sdk TypeSafeClient.systemOne
 * Auth: Bearer JEV_API_KEY
 * Model: jev-1.13.0
 */
export async function evaluateWithJev(
  state: unknown,
  questions: Record<string, JevChoiceQuestion>,
): Promise<JevResult> {
  const apiKey = getJevApiKey();
  if (!apiKey) {
    throw new Error("JEV_API_KEY is not configured");
  }
  return evaluateTypeSafe(apiKey, state, questions);
}

async function evaluateTypeSafe(
  apiKey: string,
  state: unknown,
  questions: Record<string, JevChoiceQuestion>,
): Promise<JevResult> {
  try {
    const { TypeSafeClient, choice } = await import("@typesafe-ai/sdk");
    const client = new TypeSafeClient({
      apiKey,
      defaultModel: "jev-1.13.0",
    });
    const sdkQuestions: Record<string, ReturnType<typeof choice>> = {};
    for (const [id, question] of Object.entries(questions)) {
      sdkQuestions[id] = choice(question.instructions, question.criteria);
    }
    const response = await client.systemOne({
      model: "jev-1.13.0",
      state: JSON.parse(JSON.stringify(state ?? {})),
      questions: sdkQuestions,
    });
    return fromSdkResponse(response);
  } catch {
    const response = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "jev-1.13.0",
        state: JSON.parse(JSON.stringify(state ?? {})),
        questions,
      }),
    });
    const payload = (await response.json()) as {
      model?: string;
      answers?: Record<string, {
        choice?: string;
        confidence?: number;
        probabilities?: Record<string, number>;
      }>;
      error?: { message?: string };
      message?: string;
    };
    if (!response.ok) {
      throw new Error(
        payload.error?.message || payload.message || `Jev HTTP ${response.status}`,
      );
    }
    const answers: Record<string, JevAnswer> = {};
    for (const [id, answer] of Object.entries(payload.answers ?? {})) {
      answers[id] = {
        choice: normalizeDecision(answer.choice),
        confidence:
          typeof answer.confidence === "number" ? answer.confidence : undefined,
        probabilities: answer.probabilities,
      };
    }
    return { model: "jev", jevModelVersion: payload.model, answers };
  }
}

function normalizeDecision(value: string | undefined): string {
  const raw = (value ?? "UNCERTAIN").toUpperCase();
  if (raw === "ACCEPT" || raw === "SUPPORTED") return "SUPPORTED";
  if (raw === "REJECT" || raw === "CONTRADICTED") return "CONTRADICTED";
  if (raw === "VERIFY_MORE" || raw === "UNCERTAIN") return "UNCERTAIN";
  if (raw === "YES" || raw === "NO") return raw;
  return raw;
}

function fromSdkResponse(response: {
  model: string;
  answers: Record<string, {
    choice?: string;
    confidence?: number;
    probabilities?: Record<string, number>;
  }>;
}): JevResult {
  const answers: Record<string, JevAnswer> = {};
  for (const [id, answer] of Object.entries(response.answers)) {
    answers[id] = {
      choice: String(answer.choice ?? "UNCERTAIN"),
      confidence:
        typeof answer.confidence === "number" ? answer.confidence : undefined,
      probabilities: answer.probabilities
        ? Object.fromEntries(
            Object.entries(answer.probabilities).map(([k, v]) => [k, Number(v)]),
          )
        : undefined,
    };
  }
  return {
    model: "jev",
    jevModelVersion: response.model,
    answers,
  };
}

export async function classifyClaims(
  items: {
    id: string;
    claim: string;
    evidence: string;
    sourceUrl?: string;
    status?: string;
  }[],
): Promise<{ result: JevResult; usedMockFallback: boolean; error?: string }> {
  const questions: Record<string, JevChoiceQuestion> = {};
  const claims: Record<string, unknown> = {};
  for (const item of items) {
    claims[item.id] = {
      claim: item.claim,
      evidence: item.evidence,
      source_url: item.sourceUrl ?? null,
      status: item.status ?? "unclear",
    };
    questions[item.id] = {
      type: "choice",
      instructions: `Does the evidence in claims.${item.id}.evidence directly support the claim in claims.${item.id}.claim, including the claimed status in claims.${item.id}.status? Mark SUPPORTED only if the snippet backs the claim as stated. Identity facts (founded, CEO, partner, educated_at) from Wikipedia, Britannica, or an independent bio are SUPPORTED. Mark CONTRADICTED if the snippet denies the role. Mark UNCERTAIN if the source is off-topic chrome, satire, a name list with no role, or an announcement used to support a deployed contract claim.`,
      criteria: CLAIM_CRITERIA,
    };
  }

  if (!getJevApiKey()) {
    return { result: mockEvaluate({ claims }, questions), usedMockFallback: false };
  }

  try {
    const result = await evaluateWithJev({ claims }, questions);
    return { result, usedMockFallback: false };
  } catch (error) {
    return {
      result: mockEvaluate({ claims }, questions),
      usedMockFallback: true,
      error: error instanceof Error ? error.message : "Jev validation failed",
    };
  }
}

export async function classifyEntityMatches(
  items: {
    id: string;
    left: Entity;
    right: Entity;
    contextLeft?: string;
    contextRight?: string;
  }[],
): Promise<{ result: JevResult; usedMockFallback: boolean; error?: string }> {
  const questions: Record<string, JevChoiceQuestion> = {};
  const pairs: Record<string, unknown> = {};
  for (const item of items) {
    pairs[item.id] = {
      name_a: item.left.name,
      name_b: item.right.name,
      type_a: item.left.type,
      type_b: item.right.type,
      context_a: item.contextLeft ?? null,
      context_b: item.contextRight ?? null,
    };
    questions[item.id] = {
      type: "choice",
      instructions: `Are pairs.${item.id}.name_a and pairs.${item.id}.name_b the same relevant entity for this knowledge graph?`,
      criteria: MATCH_CRITERIA,
    };
  }

  if (!getJevApiKey()) {
    return { result: mockEvaluate({ pairs }, questions), usedMockFallback: false };
  }

  try {
    const result = await evaluateWithJev({ pairs }, questions);
    return { result, usedMockFallback: false };
  } catch (error) {
    return {
      result: mockEvaluate({ pairs }, questions),
      usedMockFallback: true,
      error: error instanceof Error ? error.message : "Jev entity match failed",
    };
  }
}

export async function classifyEntityMatch(
  left: Entity,
  right: Entity,
): Promise<Validation> {
  const classified = await classifyEntityMatches([
    { id: "same_entity", left, right },
  ]);
  return toValidation(classified.result, "same_entity");
}

export function toValidation(result: JevResult, questionId: string): Validation {
  const answer = result.answers[questionId];
  return {
    decision: (answer?.choice as ValidationDecision) || "UNCERTAIN",
    confidence: answer?.confidence,
    model: result.model,
    probabilities: answer?.probabilities,
    jevModelVersion: result.jevModelVersion,
  };
}

function mockEvaluate(
  state: unknown,
  questions: Record<string, JevChoiceQuestion>,
): JevResult {
  const answers: Record<string, JevAnswer> = {};
  const rec = (state ?? {}) as Record<string, unknown>;

  for (const [id, question] of Object.entries(questions)) {
    const options = Object.keys(question.criteria);
    if (options.includes("YES") && options.includes("NO")) {
      const pairs = (rec.pairs ?? {}) as Record<string, unknown>;
      const pair = (pairs[id] ?? rec) as Record<string, unknown>;
      const a = String(pair.name_a ?? rec.name_a ?? "");
      const b = String(pair.name_b ?? rec.name_b ?? "");
      const same = namesLikelyMatch(a, b);
      answers[id] = same
        ? dist("YES", { YES: 0.91, NO: 0.04, UNCERTAIN: 0.05 })
        : dist("NO", { YES: 0.08, NO: 0.84, UNCERTAIN: 0.08 });
      continue;
    }

    const claims = (rec.claims ?? rec) as Record<string, unknown>;
    const item = (claims[id] ?? {}) as Record<string, unknown>;
    const claim = String(item.claim ?? "");
    const evidence = String(item.evidence ?? "");
    const status = String(item.status ?? "unclear");
    answers[id] = mockClaimDecision(claim, evidence, status);
  }

  return { model: "mock", answers };
}

function mockClaimDecision(claim: string, evidence: string, status = "unclear"): JevAnswer {
  const c = claim.toLowerCase();
  const e = evidence.toLowerCase();
  const claimTokens = tokens(c);
  const overlap = claimTokens.filter((t) => e.includes(t)).length;
  const ratio = claimTokens.length ? overlap / claimTokens.length : 0;
  const overstated =
    /prime partner|entire artemis|prime developer|supplies the lunar surface/.test(c);
  const denied =
    /not the prime|not confirmed|is not/.test(e) && overstated;
  const announcementOnly =
    /selected|will |intended|announce|to develop and deploy|award/.test(e);
  const operational =
    /operating|in service|launched|on-orbit|on-surface|already delivering/.test(e);

  if (denied) {
    return dist("CONTRADICTED", {
      SUPPORTED: 0.08,
      CONTRADICTED: 0.81,
      UNCERTAIN: 0.11,
    });
  }
  if (status === "deployed" && announcementOnly && !operational) {
    return dist("UNCERTAIN", {
      SUPPORTED: 0.18,
      CONTRADICTED: 0.12,
      UNCERTAIN: 0.7,
    });
  }
  if (overstated || ratio < 0.35) {
    return dist("UNCERTAIN", {
      SUPPORTED: 0.22,
      CONTRADICTED: 0.18,
      UNCERTAIN: 0.6,
    });
  }
  if (ratio >= 0.5) {
    return dist("SUPPORTED", {
      SUPPORTED: Math.min(0.97, 0.72 + ratio * 0.2),
      CONTRADICTED: 0.03,
      UNCERTAIN: 0.1,
    });
  }
  return dist("UNCERTAIN", {
    SUPPORTED: 0.3,
    CONTRADICTED: 0.12,
    UNCERTAIN: 0.58,
  });
}

function dist(choice: string, probabilities: Record<string, number>): JevAnswer {
  return {
    choice,
    confidence: probabilities[choice],
    probabilities,
  };
}

function namesLikelyMatch(a: string, b: string): boolean {
  const na = a.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const nb = b.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

function tokens(value: string): string[] {
  return value
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 3 && !STOP.has(t));
}

const STOP = new Set([
  "that",
  "this",
  "with",
  "from",
  "they",
  "their",
  "will",
  "have",
  "been",
  "into",
  "over",
  "under",
]);
