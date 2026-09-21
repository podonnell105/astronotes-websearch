import { cookies } from "next/headers";
import type { AuthUser, SessionSummary, SessionView } from "./types";

const COOKIE = "an_session";

export function useRemoteStore(): boolean {
  return Boolean(process.env.VERCEL && !process.env.DATABASE_URL?.trim());
}

export function remoteApiBase(): string {
  return (
    process.env.API_INTERNAL_URL?.trim() ||
    process.env.NEXT_PUBLIC_API_URL?.trim() ||
    "https://astronotes-production-1e50.up.railway.app"
  ).replace(/\/$/, "");
}

async function remoteFetch(path: string): Promise<Response> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  return fetch(`${remoteApiBase()}${path}`, {
    headers: token ? { cookie: `${COOKIE}=${token}` } : {},
    cache: "no-store",
  });
}

export async function remoteCurrentUser(): Promise<AuthUser | null> {
  const response = await remoteFetch("/api/auth/me");
  if (!response.ok) return null;
  const payload = (await response.json()) as { user?: AuthUser | null };
  return payload.user ?? null;
}

export async function remoteSessionList(): Promise<SessionSummary[]> {
  const response = await remoteFetch("/api/research");
  if (!response.ok) return [];
  const payload = (await response.json()) as { graphs?: SessionSummary[] };
  return payload.graphs ?? [];
}

export async function remoteSessionView(id: string): Promise<SessionView | null> {
  const response = await remoteFetch(`/api/research/${id}`);
  if (!response.ok) return null;
  const payload = (await response.json()) as { session?: SessionView };
  return payload.session ?? null;
}

export async function remoteShare(token: string): Promise<SessionView | null> {
  const response = await remoteFetch(`/api/share/${token}`);
  if (!response.ok) return null;
  const payload = (await response.json()) as { session?: SessionView };
  return payload.session ?? null;
}
