import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { scrypt, randomBytes } = require("node:crypto");
const { promisify } = require("node:util");
const { Client } = require("pg");

const scryptAsync = promisify(scrypt);
const email = process.env.TEST_USER_EMAIL || "test@astronotes.app";
const password = process.env.TEST_USER_PASSWORD || "TestUser7!";
const credits = Number(process.env.TEST_USER_CREDITS || 7);

async function hashPassword(value) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(value, salt, 32);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL is required");
  const client = new Client({
    connectionString: url,
    ssl: url.includes("localhost") ? false : { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query(`
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
`);
  const passwordHash = await hashPassword(password);
  const existing = await client.query("SELECT id FROM users WHERE email = $1", [email]);
  const now = Date.now();
  if (existing.rowCount) {
    await client.query("UPDATE users SET credits = $2, password_hash = $3 WHERE email = $1", [
      email,
      credits,
      passwordHash,
    ]);
  } else {
    const id = crypto.randomUUID();
    await client.query(
      `INSERT INTO users (id, email, password_hash, credits, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, email, passwordHash, credits, now],
    );
    await client.query(
      `INSERT INTO credit_ledger (id, user_id, delta, reason, session_id, created_at)
       VALUES ($1, $2, $3, $4, NULL, $5)`,
      [crypto.randomUUID(), id, credits, "test_grant", now],
    );
  }
  await client.end();
  console.log(`seeded ${email} with ${credits} credits`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
