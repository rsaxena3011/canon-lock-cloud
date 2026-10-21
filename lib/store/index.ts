import { InMemoryStore } from "./memory";
import { seedDemo } from "./seed";
import type { Store } from "./types";

export type {
  ApiKey,
  AuditEntry,
  BillingSession,
  BillingStatus,
  CheckRecord,
  NewAuditEntry,
  NewCheck,
  Project,
  PublicApiKey,
  PublicUser,
  Session,
  Store,
  Tier,
  User,
} from "./types";
export { TIER_PROJECT_LIMITS } from "./types";
export { toPublicApiKey } from "./types";

// One store per server process, created lazily and seeded with the
// demo account and demo project. Kept on globalThis so Next.js module
// reloading in development does not silently reset the data.
//
// Adapter selection:
// - DATABASE_URL set: the Postgres adapter (durable; schema applied
//   idempotently on boot, demo content seeded into the database).
// - DATABASE_URL unset: the in-memory adapter (data lasts for the
//   life of the process; zero setup for local development).
const globalScope = globalThis as unknown as {
  __canonLockStorePromise?: Promise<Store>;
};

async function initStore(): Promise<Store> {
  let store: Store;
  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    const { PostgresStore } = await import("./postgres");
    const pg = new PostgresStore(connectionString);
    await pg.ensureSchema();
    store = pg;
  } else {
    store = new InMemoryStore();
  }
  await seedDemo(store);
  return store;
}

export function getStore(): Promise<Store> {
  return (globalScope.__canonLockStorePromise ??= initStore());
}
