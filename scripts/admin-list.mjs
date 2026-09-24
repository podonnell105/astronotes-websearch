import { Client } from "pg";
const c = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const res = await c.query(
  "SELECT id, email, credits, created_at FROM users ORDER BY created_at",
);
console.log(JSON.stringify(res.rows, null, 2));
await c.end();
