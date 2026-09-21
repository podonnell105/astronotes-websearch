import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { Client } = require("pg");

const url = process.env.DATABASE_URL?.trim();
if (!url) throw new Error("DATABASE_URL is required");

const out = process.env.EXPORT_PATH?.trim();
const client = new Client({
  connectionString: url,
  ssl: url.includes("localhost") || url.includes("127.0.0.1")
    ? false
    : { rejectUnauthorized: false },
});

const tables = [
  "users",
  "auth_sessions",
  "research_sessions",
  "shares",
  "credit_ledger",
];

async function main() {
  await client.connect();
  const store = {};
  for (const table of tables) {
    const result = await client.query(`SELECT * FROM ${table}`);
    store[table] = result.rows;
  }
  await client.end();
  const json = JSON.stringify(store);
  if (out) {
    writeFileSync(out, json);
    console.log(`exported ${tables.map((t) => `${t}=${store[t].length}`).join(" ")} -> ${out}`);
    return;
  }
  process.stdout.write(json);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
