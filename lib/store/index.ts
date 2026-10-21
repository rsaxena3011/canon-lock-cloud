import { InMemoryStore } from "./memory";
import { seedDemo } from "./seed";
import type { Store } from "./types";

export type {
  CheckRecord,
  NewCheck,
  Project,
  PublicUser,
  Session,
  Store,
  User,
} from "./types";

// One store per server process, created lazily and seeded with the
// demo account and demo project. Kept on globalThis so Next.js module
// reloading in development does not silently reset the data.
//
// Adapter selection: with no DATABASE_URL the in-memory store is used
// (data lasts for the life of the process). Postgres selection is
// wired in the adapter commit that follows.
const globalScope = globalThis as unknown as {
  __canonLockStorePromise?: Promise<Store>;
};

async function initStore(): Promise<Store> {
  const store: Store = new InMemoryStore();
  await seedDemo(store);
  return store;
}

export function getStore(): Promise<Store> {
  return (globalScope.__canonLockStorePromise ??= initStore());
}
