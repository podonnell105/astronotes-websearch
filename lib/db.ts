import fs from "node:fs";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import type { RuntimeMode } from "./types";

const DATA_DIR =
  process.env.DATA_DIR?.trim() ||
  (process.env.VERCEL ? "/tmp/astronotes" : path.join(process.cwd(), "data"));
const DB_PATH = path.join(DATA_DIR, "astronotes.json");

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  credits INTEGER NOT NULL DEFAULT 5,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS research_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  status TEXT NOT NULL,
  mode TEXT NOT NULL,
  jev_status TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  frozen_at BIGINT,
  sources INTEGER NOT NULL DEFAULT 0,
  entities INTEGER NOT NULL DEFAULT 0,
  relationships INTEGER NOT NULL DEFAULT 0,
  validations INTEGER NOT NULL DEFAULT 0,
  payload JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS shares (
  token TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  payload JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS credit_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  session_id TEXT,
  created_at BIGINT NOT NULL
);
`;

export type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  credits: number;
  created_at: number;
};

export type AuthSessionRow = {
  id: string;
  user_id: string;
  expires_at: number;
};

export type ResearchSessionRow = {
  id: string;
  user_id: string;
  query: string;
  status: "running" | "complete" | "error";
  mode: RuntimeMode;
  jev_status: "jev" | "mock";
  created_at: number;
  frozen_at: number | null;
  sources: number;
  entities: number;
  relationships: number;
  validations: number;
  payload: string;
};

export type ShareRow = {
  token: string;
  session_id: string;
  user_id: string;
  created_at: number;
  payload: string;
};

export type LedgerRow = {
  id: string;
  user_id: string;
  delta: number;
  reason: string;
  session_id: string | null;
  created_at: number;
};

export type StoreFile = {
  users: UserRow[];
  auth_sessions: AuthSessionRow[];
  research_sessions: ResearchSessionRow[];
  shares: ShareRow[];
  credit_ledger: LedgerRow[];
};

function emptyStore(): StoreFile {
  return {
    users: [],
    auth_sessions: [],
    research_sessions: [],
    shares: [],
    credit_ledger: [],
  };
}

function databaseUrl(): string | undefined {
  return (
    process.env.DATABASE_URL?.trim() ||
    process.env.SUPABASE_DB_URL?.trim() ||
    undefined
  );
}

let pool: Pool | null = null;
let migrated = false;

function getPool(): Pool | null {
  const url = databaseUrl();
  if (!url) return null;
  if (!pool) {
    const local = url.includes("localhost") || url.includes("127.0.0.1");
    pool = new Pool({
      connectionString: url,
      ssl: local ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}

function asJsonString(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value ?? {});
}

async function loadFromPostgres(client: PoolClient): Promise<StoreFile> {
  const [users, sessions, research, shares, ledger] = await Promise.all([
    client.query<UserRow>("SELECT * FROM users"),
    client.query<AuthSessionRow>("SELECT * FROM auth_sessions"),
    client.query<ResearchSessionRow>("SELECT * FROM research_sessions"),
    client.query<ShareRow>("SELECT * FROM shares"),
    client.query<LedgerRow>("SELECT * FROM credit_ledger"),
  ]);
  return {
    users: users.rows.map((row) => ({
      ...row,
      credits: Number(row.credits),
      created_at: Number(row.created_at),
    })),
    auth_sessions: sessions.rows.map((row) => ({
      ...row,
      expires_at: Number(row.expires_at),
    })),
    research_sessions: research.rows.map((row) => ({
      ...row,
      created_at: Number(row.created_at),
      frozen_at: row.frozen_at == null ? null : Number(row.frozen_at),
      sources: Number(row.sources),
      entities: Number(row.entities),
      relationships: Number(row.relationships),
      validations: Number(row.validations),
      payload: asJsonString(row.payload),
    })),
    shares: shares.rows.map((row) => ({
      ...row,
      created_at: Number(row.created_at),
      payload: asJsonString(row.payload),
    })),
    credit_ledger: ledger.rows.map((row) => ({
      ...row,
      delta: Number(row.delta),
      created_at: Number(row.created_at),
    })),
  };
}

async function saveToPostgres(client: PoolClient, store: StoreFile) {
  await client.query("DELETE FROM credit_ledger");
  await client.query("DELETE FROM shares");
  await client.query("DELETE FROM research_sessions");
  await client.query("DELETE FROM auth_sessions");
  await client.query("DELETE FROM users");

  for (const user of store.users) {
    await client.query(
      `INSERT INTO users (id, email, password_hash, credits, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, user.email, user.password_hash, user.credits, user.created_at],
    );
  }
  for (const session of store.auth_sessions) {
    await client.query(
      `INSERT INTO auth_sessions (id, user_id, expires_at) VALUES ($1, $2, $3)`,
      [session.id, session.user_id, session.expires_at],
    );
  }
  for (const row of store.research_sessions) {
    await client.query(
      `INSERT INTO research_sessions
        (id, user_id, query, status, mode, jev_status, created_at, frozen_at,
         sources, entities, relationships, validations, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
      [
        row.id,
        row.user_id,
        row.query,
        row.status,
        row.mode,
        row.jev_status,
        row.created_at,
        row.frozen_at,
        row.sources,
        row.entities,
        row.relationships,
        row.validations,
        row.payload,
      ],
    );
  }
  for (const share of store.shares) {
    await client.query(
      `INSERT INTO shares (token, session_id, user_id, created_at, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [share.token, share.session_id, share.user_id, share.created_at, share.payload],
    );
  }
  for (const row of store.credit_ledger) {
    await client.query(
      `INSERT INTO credit_ledger (id, user_id, delta, reason, session_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [row.id, row.user_id, row.delta, row.reason, row.session_id, row.created_at],
    );
  }
}

function loadFile(): StoreFile {
  try {
    const raw = fs.readFileSync(DB_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoreFile>;
    return {
      ...emptyStore(),
      ...parsed,
      users: parsed.users ?? [],
      auth_sessions: parsed.auth_sessions ?? [],
      research_sessions: parsed.research_sessions ?? [],
      shares: parsed.shares ?? [],
      credit_ledger: parsed.credit_ledger ?? [],
    };
  } catch {
    return emptyStore();
  }
}

function saveFile(store: StoreFile) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store));
  fs.renameSync(tmp, DB_PATH);
}

export async function ensureSchema(): Promise<void> {
  const db = getPool();
  if (!db || migrated) return;
  await db.query(SCHEMA_SQL);
  migrated = true;
}

export async function mutate<T>(fn: (store: StoreFile) => T | Promise<T>): Promise<T> {
  const db = getPool();
  if (!db) {
    const store = loadFile();
    const result = await fn(store);
    saveFile(store);
    return result;
  }
  await ensureSchema();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(872341)");
    const store = await loadFromPostgres(client);
    const result = await fn(store);
    await saveToPostgres(client, store);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function read<T>(fn: (store: StoreFile) => T | Promise<T>): Promise<T> {
  const db = getPool();
  if (!db) return fn(loadFile());
  await ensureSchema();
  const client = await db.connect();
  try {
    return await fn(await loadFromPostgres(client));
  } finally {
    client.release();
  }
}
