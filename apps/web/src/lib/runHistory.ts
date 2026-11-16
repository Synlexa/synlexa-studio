export interface RunHistoryEntry {
  id: string;
  createdAtUtc: string;
  refLabel: string;
  refChain: string;
  refSha256: string;
  mobLabel: string;
  mobChain: string;
  mobSha256: string;
  rmsdAngstrom: number;
  matchedCaCount: number;
  paeStatus: string;
}

const DB_NAME = 'synlexa_studio_db';
const STORE_NAME = 'run_history';
const LS_KEY = 'synlexa.studio.runHistory.v1';
const MAX_HISTORY = 25;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function readLocalFallback(): RunHistoryEntry[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RunHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function writeLocalFallback(entries: RunHistoryEntry[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY)));
  } catch {
    // Ignore quota errors on fallback storage
  }
}

export async function loadRunHistory(): Promise<RunHistoryEntry[]> {
  const db = await openDb();
  if (!db) {
    return readLocalFallback();
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const items = (req.result as RunHistoryEntry[]) ?? [];
        items.sort((a, b) => b.createdAtUtc.localeCompare(a.createdAtUtc));
        db.close();
        resolve(items.length > 0 ? items.slice(0, MAX_HISTORY) : readLocalFallback());
      };
      req.onerror = () => {
        db.close();
        resolve(readLocalFallback());
      };
    } catch {
      db.close();
      resolve(readLocalFallback());
    }
  });
}

export async function saveRunHistoryEntry(
  entry: RunHistoryEntry,
): Promise<RunHistoryEntry[]> {
  const existing = await loadRunHistory();
  const deduped = [
    entry,
    ...existing.filter((item) => item.id !== entry.id),
  ].slice(0, MAX_HISTORY);

  writeLocalFallback(deduped);

  const db = await openDb();
  if (db) {
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put(entry);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          resolve();
        };
      } catch {
        db.close();
        resolve();
      }
    });
  }

  return deduped;
}

export async function clearRunHistory(): Promise<void> {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(LS_KEY);
  }
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}
