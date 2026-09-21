/**
 * Local persistence.
 *
 * Two stores, with different jobs:
 *
 *   **`outbox`** — facts that have been observed but not yet accepted by the
 *   server. This is the durability layer for the offline story: an event that is
 *   here has been written to disk and will survive a crash, a refresh, or a closed
 *   laptop lid. It is only removed once the server has acknowledged it.
 *
 *   **`cache`** — the last known server state, so the cockpit can render
 *   something truthful (labelled as "last synced") instead of an empty screen when
 *   the network is gone.
 *
 * IndexedDB rather than localStorage because event logs are append-heavy and
 * localStorage is synchronous — a large log would block the main thread on every
 * write, which is exactly the kind of jank that makes a timer feel unreliable.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export interface OutboxEvent {
  type: string;
  at: number;
  kind?: string | null;
}

export interface OutboxEntry {
  clientId: string;
  /** Null until the server has assigned an id. */
  serverId: string | null;
  subjectId: string | null;
  taskId: string | null;
  kind: string;
  plannedDuration: number;
  timeZone: string;
  device: string;
  startTime: number;
  events: OutboxEvent[];
  /** Set when the user ended the session but the server has not been told yet. */
  close: { status: string; reflection: string | null; endedAt: number } | null;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  lastError: string | null;
}

interface FocusForgeDB extends DBSchema {
  outbox: {
    key: string;
    value: OutboxEntry;
    indexes: { updatedAt: number };
  };
  cache: {
    key: string;
    value: { key: string; value: unknown; storedAt: number };
  };
}

const DB_NAME = 'focusforge';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<FocusForgeDB> | null> | null = null;

/**
 * IndexedDB is unavailable in some privacy modes and in SSR. Rather than throwing
 * at import time, the whole layer degrades to a memory map — the app still works
 * for the current tab, it simply cannot survive a reload.
 */
let fallbackOutbox = new Map<string, OutboxEntry>();
let fallbackCache = new Map<string, { key: string; value: unknown; storedAt: number }>();
let usingFallback = false;

export function isPersistenceAvailable(): boolean {
  return !usingFallback;
}

async function getDb(): Promise<IDBPDatabase<FocusForgeDB> | null> {
  if (usingFallback) return null;
  if (!dbPromise) {
    dbPromise = openDB<FocusForgeDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('outbox')) {
          const store = db.createObjectStore('outbox', { keyPath: 'clientId' });
          store.createIndex('updatedAt', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('cache')) {
          db.createObjectStore('cache', { keyPath: 'key' });
        }
      },
      blocked() {
        // Another tab holds an older version open. Not fatal: reads and writes
        // continue against the version we have.
      },
    }).catch(() => {
      usingFallback = true;
      return null;
    });
  }
  return dbPromise;
}

// ---------------------------------------------------------------------- outbox

export async function putOutboxEntry(entry: OutboxEntry): Promise<void> {
  const db = await getDb();
  if (!db) {
    fallbackOutbox.set(entry.clientId, entry);
    return;
  }
  await db.put('outbox', entry);
}

export async function getOutboxEntry(clientId: string): Promise<OutboxEntry | undefined> {
  const db = await getDb();
  if (!db) return fallbackOutbox.get(clientId);
  return db.get('outbox', clientId);
}

export async function listOutbox(): Promise<OutboxEntry[]> {
  const db = await getDb();
  if (!db) return [...fallbackOutbox.values()].sort((a, b) => a.startTime - b.startTime);
  return db.getAllFromIndex('outbox', 'updatedAt');
}

export async function deleteOutboxEntry(clientId: string): Promise<void> {
  const db = await getDb();
  if (!db) {
    fallbackOutbox.delete(clientId);
    return;
  }
  await db.delete('outbox', clientId);
}

export async function countOutbox(): Promise<number> {
  const db = await getDb();
  if (!db) return fallbackOutbox.size;
  return db.count('outbox');
}

export async function clearOutbox(): Promise<void> {
  const db = await getDb();
  if (!db) {
    fallbackOutbox = new Map();
    return;
  }
  await db.clear('outbox');
}

// ----------------------------------------------------------------------- cache

/** Namespaced by user id so two accounts on one device cannot read each other. */
export async function cacheSet(userId: string, key: string, value: unknown): Promise<void> {
  const db = await getDb();
  const record = { key: `${userId}:${key}`, value, storedAt: Date.now() };
  if (!db) {
    fallbackCache.set(record.key, record);
    return;
  }
  await db.put('cache', record);
}

export async function cacheGet<T>(userId: string, key: string): Promise<{ value: T; storedAt: number } | null> {
  const db = await getDb();
  if (!db) {
    const record = fallbackCache.get(`${userId}:${key}`);
    return record ? { value: record.value as T, storedAt: record.storedAt } : null;
  }
  const record = await db.get('cache', `${userId}:${key}`);
  return record ? { value: record.value as T, storedAt: record.storedAt } : null;
}

export async function cacheDelete(userId: string, key: string): Promise<void> {
  const db = await getDb();
  if (!db) {
    fallbackCache.delete(`${userId}:${key}`);
    return;
  }
  await db.delete('cache', `${userId}:${key}`);
}

/** Wipe everything belonging to one user. Used on sign-out and account deletion. */
export async function clearUserData(userId: string): Promise<void> {
  const db = await getDb();
  if (!db) {
    fallbackCache.clear();
    fallbackOutbox = new Map();
    return;
  }
  const cached = await db.getAll('cache');
  await Promise.all(
    cached.filter((record) => record.key.startsWith(`${userId}:`)).map((record) => db.delete('cache', record.key)),
  );
  await db.clear('outbox');
}

/** Everything, for a full reset. */
export async function clearAll(): Promise<void> {
  await clearOutbox();
  const db = await getDb();
  if (!db) {
    fallbackCache = new Map();
    return;
  }
  await db.clear('cache');
}
