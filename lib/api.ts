export function apiUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/$/, "") ?? "";
  return `${base}${path}`;
}

export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(path), {
    ...init,
    credentials: "include",
  });
}
