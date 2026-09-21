import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { Client } = require("pg");

const url = process.env.DATABASE_URL?.trim();
if (!url) throw new Error("DATABASE_URL is required");
const source = process.env.IMPORT_PATH?.trim();
if (!source) throw new Error("IMPORT_PATH is required");

const client = new Client({
  connectionString: url,
  ssl: url.includes("localhost") || url.includes("127.0.0.1")
    ? false
    : { rejectUnauthorized: false },
});

function asJson(value) {
  if (value == null) return "{}";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

async function main() {
  const store = JSON.parse(readFileSync(source, "utf8"));
  await client.connect();
  await client.query("BEGIN");
  await client.query("DELETE FROM credit_ledger");
  await client.query("DELETE FROM shares");
  await client.query("DELETE FROM research_sessions");
  await client.query("DELETE FROM auth_sessions");
  await client.query("DELETE FROM users");

  for (const user of store.users ?? []) {
    await client.query(
      `INSERT INTO users (id, email, password_hash, credits, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, user.email, user.password_hash, user.credits, user.created_at],
    );
  }
  for (const session of store.auth_sessions ?? []) {
    await client.query(
      `INSERT INTO auth_sessions (id, user_id, expires_at) VALUES ($1, $2, $3)`,
      [session.id, session.user_id, session.expires_at],
    );
  }
  for (const row of store.research_sessions ?? []) {
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
        asJson(row.payload),
      ],
    );
  }
  for (const share of store.shares ?? []) {
    await client.query(
      `INSERT INTO shares (token, session_id, user_id, created_at, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [share.token, share.session_id, share.user_id, share.created_at, asJson(share.payload)],
    );
  }
  for (const row of store.credit_ledger ?? []) {
    await client.query(
      `INSERT INTO credit_ledger (id, user_id, delta, reason, session_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [row.id, row.user_id, row.delta, row.reason, row.session_id, row.created_at],
    );
  }
  await client.query("COMMIT");
  await client.end();
  console.log(
    `imported users=${(store.users ?? []).length} sessions=${(store.research_sessions ?? []).length}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
