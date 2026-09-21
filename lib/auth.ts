import { mutate, read } from "./db";
import { remoteCurrentUser, useRemoteStore } from "./remote";
import type { AuthUser } from "./types";
import { scrypt as scryptCallback, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies, headers } from "next/headers";

const scrypt = promisify(scryptCallback);
const COOKIE = "an_session";
const SESSION_DAYS = 30;
const STARTER_CREDITS = 5;

export function starterCredits(): number {
  return STARTER_CREDITS;
}

async function cookieOptions(expires: Date) {
  const host =
    (await headers()).get("x-forwarded-host") ||
    (await headers()).get("host") ||
    "";
  const configured = process.env.COOKIE_DOMAIN?.trim();
  const domain = host.endsWith("astronotes.ai")
    ? ".astronotes.ai"
    : configured && host.endsWith(configured.replace(/^\./, ""))
      ? configured
      : undefined;
  const production = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    path: "/",
    expires,
    secure: production,
    sameSite: (production && domain ? "none" : "lax") as "none" | "lax",
    ...(domain ? { domain } : {}),
  };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = (await scrypt(password, salt, 32)) as Buffer;
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export async function createUser(email: string, password: string): Promise<AuthUser> {
  const id = crypto.randomUUID();
  const now = Date.now();
  const password_hash = await hashPassword(password);
  return mutate((store) => {
    if (store.users.some((user) => user.email === email)) {
      throw new Error("An account with that email already exists.");
    }
    store.users.push({
      id,
      email,
      password_hash,
      credits: STARTER_CREDITS,
      created_at: now,
    });
    store.credit_ledger.push({
      id: crypto.randomUUID(),
      user_id: id,
      delta: STARTER_CREDITS,
      reason: "signup_grant",
      session_id: null,
      created_at: now,
    });
    return { id, email, credits: STARTER_CREDITS };
  });
}

export async function findUserByEmail(email: string) {
  return read((store) => {
    const row = store.users.find((user) => user.email === email);
    if (!row) return undefined;
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.password_hash,
      credits: row.credits,
    };
  });
}

export async function getUserById(id: string): Promise<AuthUser | undefined> {
  return read((store) => {
    const row = store.users.find((user) => user.id === id);
    if (!row) return undefined;
    return { id: row.id, email: row.email, credits: row.credits };
  });
}

export async function createAuthCookie(userId: string): Promise<string> {
  const id = randomBytes(32).toString("hex");
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  await mutate((store) => {
    store.auth_sessions.push({ id, user_id: userId, expires_at: expiresAt });
  });
  const jar = await cookies();
  jar.set(COOKIE, id, await cookieOptions(new Date(expiresAt)));
  return id;
}

export async function clearAuthCookie() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    await mutate((store) => {
      store.auth_sessions = store.auth_sessions.filter((row) => row.id !== token);
    });
  }
  jar.set(COOKIE, "", { ...(await cookieOptions(new Date(0))), expires: new Date(0) });
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  if (useRemoteStore()) return remoteCurrentUser();
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  return mutate((store) => {
    const session = store.auth_sessions.find((row) => row.id === token);
    if (!session || session.expires_at < Date.now()) {
      store.auth_sessions = store.auth_sessions.filter((row) => row.id !== token);
      return null;
    }
    const user = store.users.find((row) => row.id === session.user_id);
    if (!user) return null;
    return { id: user.id, email: user.email, credits: user.credits };
  });
}

export async function requireUser(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new AuthError("Sign in required");
  }
  return user;
}

export class AuthError extends Error {
  status = 401;
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function validateCredentials(email: string, password: string): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email.";
  if (password.length < 8) return "Password must be at least 8 characters.";
  return null;
}
