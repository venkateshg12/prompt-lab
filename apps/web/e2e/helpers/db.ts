import { createRequire } from "node:module";
import path from "node:path";

// The few pg calls used here; the real types live in the api workspace.
interface PgClient {
  connect(): Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, any>[] }>;
  end(): Promise<void>;
}
type PgClientCtor = new (options: { connectionString: string }) => PgClient;

const E2E_DATABASE_URL = "postgresql://promptlab:promptlab@127.0.0.1:5432/promptlab_e2e";

/** Read (or fix up) the E2E database directly: for facts the API deliberately doesn't expose yet. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function sql(text: string, params: unknown[] = []): Promise<Record<string, any>[]> {
  const apiRequire = createRequire(path.resolve(__dirname, "../../../api/package.json"));
  const { Client } = apiRequire("pg") as { Client: PgClientCtor };
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(text, params)).rows;
  } finally {
    await client.end();
  }
}
