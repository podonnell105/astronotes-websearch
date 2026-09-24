import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { scrypt, randomBytes } = require("node:crypto");
const { promisify } = require("node:util");
const { Client } = require("pg");
const scryptAsync = promisify(scrypt);

function genPassword(len = 16) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

async function hashPassword(value) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(value, salt, 32);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

const c = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

async function ensureUser(email, credits, reason) {
  const existing = await c.query("SELECT id, credits FROM users WHERE email = $1", [email]);
  if (existing.rowCount) {
    return { action: "exists", email, id: existing.rows[0].id, credits: Number(existing.rows[0].credits), password: null };
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  const password = genPassword();
  const passwordHash = await hashPassword(password);
  await c.query(
    `INSERT INTO users (id, email, password_hash, credits, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, email, passwordHash, credits, now],
  );
  await c.query(
    `INSERT INTO credit_ledger (id, user_id, delta, reason, session_id, created_at)
     VALUES ($1, $2, $3, $4, NULL, $5)`,
    [crypto.randomUUID(), id, credits, reason, now],
  );
  return { action: "created", email, id, credits, password };
}

async function addCredits(email, amount, reason) {
  const res = await c.query("SELECT id, credits FROM users WHERE email = $1", [email]);
  if (!res.rowCount) return { action: "not_found", email };
  const row = res.rows[0];
  const before = Number(row.credits);
  const now = Date.now();
  await c.query("UPDATE users SET credits = credits + $2 WHERE id = $1", [row.id, amount]);
  await c.query(
    `INSERT INTO credit_ledger (id, user_id, delta, reason, session_id, created_at)
     VALUES ($1, $2, $3, $4, NULL, $5)`,
    [crypto.randomUUID(), row.id, amount, reason, now],
  );
  const after = await c.query("SELECT credits FROM users WHERE id = $1", [row.id]);
  return { action: "added", email, id: row.id, before, after: Number(after.rows[0].credits) };
}

const results = {};

// 1. Create daire@astronotes.app with 10 credits
results.daire = await ensureUser("daire@astronotes.app", 10, "manual_grant");

// 2. test@astronotes.app: add 10 credits. If it doesn't exist, create with 10 credits.
const testExists = await c.query("SELECT id FROM users WHERE email = $1", ["test@astronotes.app"]);
if (testExists.rowCount) {
  results.test = await addCredits("test@astronotes.app", 10, "manual_grant");
} else {
  results.test = await ensureUser("test@astronotes.app", 10, "manual_grant");
}

// Final state
const finalUsers = await c.query(
  "SELECT email, credits FROM users WHERE email IN ($1, $2) ORDER BY email",
  ["daire@astronotes.app", "test@astronotes.app"],
);
results.final = finalUsers.rows;

await c.end();
console.log(JSON.stringify(results, null, 2));
