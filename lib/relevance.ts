import type { DroppedSource, SearchResult } from "./types";

const WINDOW = 8;

export function filterRelevantResults(
  results: SearchResult[],
  subjects: string[],
): { results: SearchResult[]; dropped: DroppedSource[] } {
  const strong = subjects.filter((name) => !isWeakSubject(name));
  if (strong.length === 0) return { results, dropped: [] };

  const kept: SearchResult[] = [];
  const dropped: DroppedSource[] = [];
  for (const result of results) {
    if (resultMentionsSubject(result, subjects)) {
      kept.push(result);
    } else {
      dropped.push({
        url: result.url,
        title: result.title,
        reason: "irrelevant",
      });
    }
  }

  if (kept.length === 0) return { results, dropped: [] };
  return { results: kept, dropped };
}

export function resultMentionsSubject(
  result: SearchResult,
  subjects: string[],
): boolean {
  const fields = [result.title, result.snippet, result.url].filter(Boolean);
  const strong = subjects.filter((name) => !isWeakSubject(name));
  const weak = subjects.filter((name) => isWeakSubject(name));
  if (strong.some((subject) => fields.some((field) => fieldMentionsSubject(field, subject)))) {
    return true;
  }
  if (weak.length === 0) return false;
  const combined = fields.join(" ");
  return (
    weak.some((subject) => fieldMentionsSubject(combined, subject)) &&
    strong.some((subject) => looseSubjectHit(combined, subject))
  );
}

export function isWeakSubject(name: string): boolean {
  const tokens = name.trim().split(/\s+/);
  return tokens.length === 1 && tokens[0].length < 5;
}

function fieldMentionsSubject(text: string, subject: string): boolean {
  const hay = text.toLowerCase();
  const phrase = subject.trim().toLowerCase();
  if (!phrase || !hay) return false;
  if (hay.includes(phrase)) return true;
  if (urlMentionsSubject(text, phrase)) return true;

  const tokens = phrase.split(/[^a-z0-9]+/).filter((token) => token.length >= 3);
  if (tokens.length < 2) {
    return tokens.length === 1 && new RegExp(`\\b${escapeRegExp(tokens[0])}\\b`, "i").test(text);
  }
  return tokensInOrder(hay, tokens, WINDOW);
}

function looseSubjectHit(text: string, subject: string): boolean {
  const hay = text.toLowerCase();
  const tokens = subject
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4);
  return tokens.some((token) => hay.includes(token));
}

function urlMentionsSubject(text: string, subject: string): boolean {
  const compact = subject.replace(/[^a-z0-9]/g, "");
  if (compact.length < 6) return false;
  const urls = text.match(/https?:\/\/[^\s]+/gi) ?? [];
  return urls.some((url) => {
    try {
      const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase().replace(/[-.]/g, "");
      return host.includes(compact);
    } catch {
      return url.toLowerCase().replace(/[-./]/g, "").includes(compact);
    }
  });
}

function tokensInOrder(text: string, tokens: string[], window: number): boolean {
  const words = text.split(/[^a-z0-9]+/).filter(Boolean);
  let from = 0;
  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
    const token = tokens[tokenIndex];
    const start = tokenIndex === 0 ? 0 : from;
    const end =
      tokenIndex === 0 ? words.length : Math.min(words.length, from + window);
    let found = -1;
    for (let index = start; index < end; index++) {
      if (words[index] === token) {
        found = index;
        break;
      }
    }
    if (found === -1) return false;
    from = found + 1;
  }
  return true;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
