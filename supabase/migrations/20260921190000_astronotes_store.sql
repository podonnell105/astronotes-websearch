-- Application store. Provider-agnostic Postgres.
-- Current host: Supabase. To move to Railway Postgres:
--   1. Create Railway Postgres and copy DATABASE_URL
--   2. Run this file against the new database
--   3. pg_dump --data-only the old DB and restore, or keep using the same schema
--   4. Point Railway + Vercel DATABASE_URL at the new instance

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
