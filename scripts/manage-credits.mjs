import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { scrypt, randomBytes } = require("node:crypto");
const { promisify } = require("node:util");
const { Client } = require("pg");

const scryptAsync = promisify(scrypt);

const DATABASE_URL = process.env.DATABASE_URL?.trim();
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

async function hashPassword(value) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(value, salt, 32);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

function client() {
  return new Client({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 15000,
    ssl: DATABASE_URL.includes("localhost")
      ? false
      : { rejectUnauthorized: false },
  });
}

async function listUsers(c) {
  const res = await c.query(
    "SELECT id, email, credits, created_at FROM users ORDER BY created_at",
  );
  return res.rows;
}

async function addUserCredits(c, email, amount, reason) {
  const res = await c.query("SELECT id, credits FROM users WHERE email = $1", [email]);
  if (!res.rowCount) return null;
  const row = res.rows[0];
  const now = Date.now();
  await c.query("UPDATE users SET credits = credits + $2 WHERE id = $1", [row.id, amount]);
  await c.query(
    `INSERT INTO credit_ledger (id, user_id, delta, reason, session_id, created_at)
     VALUES ($1, $2, $3, $4, NULL, $5)`,
    [crypto.randomUUID(), row.id, amount, reason, now],
  );
  const after = await c.query("SELECT credits FROM users WHERE id = $1", [row.id]);
  return { id: row.id, before: Number(row.credits), after: Number(after.rows[0].credits) };
}

async function createUser(c, email, password, credits, reason) {
  const existing = await c.query("SELECT id FROM users WHERE email = $1", [email]);
  if (existing.rowCount) return { exists: true, id: existing.rows[0].id };
  const id = crypto.randomUUID();
  const now = Date.now();
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
  return { exists: false, id };
}

async function main() {
  const action = process.argv[2];
  const c = client();
  await c.connect();
  try {
    if (action === "list") {
      console.log(JSON.stringify(await listUsers(c), null, 2));
      return;
    }
    if (action === "add") {
      const email = process.argv[3];
      const amount = Number(process.argv[4]);
      const reason = process.argv[5] || "manual_grant";
      const res = await addUserCredits(c, email, amount, reason);
      if (!res) {
        console.log(`NOT_FOUND ${email}`);
        process.exitCode = 2;
        return;
      }
      console.log(`ADDED ${amount} to ${email}: ${res.before} -> ${res.after} (id ${res.id})`);
      return;
    }
    if (action === "create") {
      const email = process.argv[3];
      const password = process.argv[4];
      const credits = Number(process.argv[5]);
      const reason = process.argv[6] || "manual_grant";
      if (!password || password.length < 8) {
        console.error("Password must be at least 8 characters");
        process.exitCode = 2;
        return;
      }
      const res = await createUser(c, email, password, credits, reason);
      if (res.exists) {
        console.log(`EXISTS ${email} (id ${res.id})`);
        process.exitCode = 2;
        return;
      }
      console.log(`CREATED ${email} with ${credits} credits (id ${res.id})`);
      return;
    }
    console.error("Usage: manage-credits.mjs <list|create|add> ...");
    process.exitCode = 2;
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
