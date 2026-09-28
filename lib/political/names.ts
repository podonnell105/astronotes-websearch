const TITLES = new Set([
  "mr",
  "mrs",
  "ms",
  "miss",
  "dr",
  "prof",
  "sir",
  "lord",
  "lady",
  "dame",
  "hon",
]);

export function foldName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function nameTokens(value: string): string[] {
  const raw = foldName(value)
    .split(" ")
    .filter((token) => token && !TITLES.has(token));
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const token = raw[i];
    const next = raw[i + 1];
    if (token.length === 1 && next) {
      out.push(token + next);
      i++;
    } else {
      out.push(token);
    }
  }
  return out;
}

export function sameName(a: string, b: string): boolean {
  const left = nameTokens(a);
  const right = nameTokens(b);
  if (left.length === 0 || right.length === 0) return false;
  if (left.join(" ") === right.join(" ")) return true;
  if (left.length < 2 || right.length < 2) return false;
  const [smaller, larger] = left.length <= right.length ? [left, new Set(right)] : [right, new Set(left)];
  return smaller.every((token) => larger.has(token));
}

export function nameInText(name: string, text: string): boolean {
  const foldedName = foldName(name);
  const foldedText = foldName(text);
  if (!foldedName || !foldedText) return false;
  return ` ${foldedText} `.includes(` ${foldedName} `);
}

export function personNameFromQuery(query: string): string | undefined {
  const quoted = query.match(/"([^"]+)"/)?.[1]?.trim();
  if (quoted && quoted.split(/\s+/).length >= 2) return quoted;
  const match = query.match(/\b([A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){1,4})\b/);
  return match?.[1];
}

export function scanPersonNames(query: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const match of query.matchAll(/\b([A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){1,4})\b/g)) {
    const name = match[1]?.trim();
    if (!name) continue;
    const key = foldName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    found.push(name);
  }
  return found;
}
