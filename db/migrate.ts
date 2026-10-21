import { Pool } from "pg";
import { SCHEMA_SQL } from "../lib/store/postgres.ts";

/**
 * Applies the schema to the database named by DATABASE_URL.
 * Idempotent (every statement is IF NOT EXISTS), so re-running is
 * safe. The server also applies the same schema on boot; this runner
 * exists so the schema can be provisioned ahead of a deploy.
 *
 * Usage: DATABASE_URL=postgres://... npm run db:migrate
 */

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set; nothing to migrate.");
  process.exit(1);
}

const pool = new Pool({ connectionString });
try {
  await pool.query(SCHEMA_SQL);
  console.log("Schema applied (idempotent).");
} finally {
  await pool.end();
}
