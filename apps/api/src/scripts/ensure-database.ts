import "dotenv/config";
import { Client } from "pg";
import { DATABASE_URL } from "../constants/env";

/*
  Creates the database named in DATABASE_URL if it doesn't exist yet. `prisma migrate deploy` applies
  migrations but never creates a database, so a fresh server (an E2E or load-test database, a new CI
  runner) runs this first. Idempotent. Connects to the server's maintenance database to do it.
 */
const main = async () => {
  const url = new URL(DATABASE_URL);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!/^[A-Za-z0-9_-]+$/.test(database)) throw new Error(`Refusing unusual database name: ${database}`);

  url.pathname = "/postgres";
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
    if (exists.rowCount === 0) {
      await client.query(`CREATE DATABASE "${database}"`);
      console.log(`Created database ${database}`);
    }
  } finally {
    await client.end();
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
