// ---------------------------------------------------------------------------
// Minimal IndexedDB persistence. Only user-created entities are persisted;
// the ATS34 source data is regenerated deterministically (same seed) so the
// mockup behaves like observations living in the BTM database.
// ---------------------------------------------------------------------------

const DB_NAME = 'btm-topo-mockup';
const STORE = 'state';

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

export async function loadPersisted<T>(key: string): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as T) ?? null);
    req.onerror = () => resolve(null);
  });
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSave: { key: string; value: unknown } | null = null;

export function savePersisted(key: string, value: unknown): void {
  pendingSave = { key, value };
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    const p = pendingSave;
    pendingSave = null;
    if (!p) return;
    const db = await openDb();
    if (!db) return;
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(JSON.parse(JSON.stringify(p.value)), p.key);
    } catch {
      // persistence is best-effort in the mockup
    }
  }, 400);
}

export async function clearPersisted(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}
