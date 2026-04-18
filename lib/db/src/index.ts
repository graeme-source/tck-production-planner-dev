import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Pin every Postgres session to UTC so `now()` / `defaultNow()` and naive
// timestamp reads/writes all agree on the same absolute instant. Combined
// with `ENV TZ=UTC` on the Node process, this means new timestamps are
// written as true UTC and the frontend can localise to the iPad's
// Europe/London clock — which auto-handles BST <-> GMT twice a year.
pool.on("connect", (client) => {
  client.query("SET TIME ZONE 'UTC'").catch(() => {
    // Non-fatal: if the SET fails the session just uses the server default.
  });
});

export const db = drizzle(pool, { schema });

export * from "./schema";
