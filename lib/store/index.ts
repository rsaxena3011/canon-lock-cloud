import { InMemoryStore } from "./memory";
import type { Store } from "./types";

export type { CheckRecord, NewCheck, Project, Store } from "./types";

// One store per server process. Kept on globalThis so Next.js module
// reloading in development does not silently reset the data.
const globalScope = globalThis as unknown as { __canonLockStore?: Store };

export const store: Store =
  globalScope.__canonLockStore ?? (globalScope.__canonLockStore = new InMemoryStore());
