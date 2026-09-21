import { getJson } from "./fetchJson";
import type { Document } from "./search";

const PER_SOURCE = 2;

export async function lookupGithub(names: string[]): Promise<Document[]> {
  const found: Document[] = [];
  const token = process.env.GITHUB_TOKEN?.trim();
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Astronotes/0.1",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  for (const name of names.slice(0, 2)) {
    if (found.length >= PER_SOURCE) break;
    const params = new URLSearchParams({
      q: `"${name}" type:org`,
      per_page: "3",
    });
    const data = await getJson<{
      items?: Array<{ login?: string; html_url?: string; description?: string }>;
    }>(`https://api.github.com/search/users?${params.toString()}`, headers);
    const org = data?.items?.[0];
    const login = String(org?.login ?? "").trim();
    if (!login) continue;
    const repos = await getJson<
      Array<{
        full_name?: string;
        html_url?: string;
        description?: string;
        pushed_at?: string;
        stargazers_count?: number;
        language?: string;
      }>
    >(
      `https://api.github.com/orgs/${encodeURIComponent(login)}/repos?sort=pushed&per_page=2`,
      headers,
    );
    const repo = repos?.[0];
    const url = repo?.html_url || org?.html_url || `https://github.com/${login}`;
    const snippet = [
      `GitHub org ${login}.`,
      org?.description || "",
      repo?.full_name
        ? `Latest repo ${repo.full_name}${repo.language ? ` (${repo.language})` : ""}${typeof repo.stargazers_count === "number" ? `, ${repo.stargazers_count} stars` : ""}.`
        : "No public repos returned.",
      repo?.pushed_at ? `Last push ${String(repo.pushed_at).slice(0, 10)}.` : "",
      "Public code is shipped-product evidence, not a press announcement.",
    ]
      .filter(Boolean)
      .join(" ");
    found.push({
      title: repo?.full_name ? `${login} / ${repo.full_name}` : `GitHub — ${login}`,
      url,
      snippet,
      source: "github.com",
      publishedAt: repo?.pushed_at ? String(repo.pushed_at).slice(0, 10) : undefined,
      text: snippet,
    });
  }
  return found.slice(0, PER_SOURCE);
}
