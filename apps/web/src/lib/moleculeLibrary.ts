/**
 * Local molecule library — structures, compounds, and sequences stored in
 * IndexedDB on this device (with an in-memory fallback when IndexedDB is
 * unavailable). Every item keeps its provenance (source URL, license,
 * retrieval timestamp, origin, SHA-256); fields a source did not supply stay null.
 */
import { sha256HexUniversal } from './sha256';

export type LibraryKind = 'structure' | 'compound' | 'sequence';

export interface LibraryItem {
  id: string;
  kind: LibraryKind;
  name: string;
  /** File format: cif, pdb, smiles, fasta, … */
  format: string;
  /** Raw content: mmCIF/PDB text, SMILES string, or sequence. */
  content: string;
  /** Optional companion data, e.g. AlphaFold PAE JSON for a structure. */
  paeJson?: string | null;
  sha256: string;
  sizeBytes: number;
  tags: string[];
  notes: string;
  favorite: boolean;
  source: {
    database: string | null;
    accession: string | null;
    sourceUrl: string | null;
    license: string | null;
    retrievedAtUtc: string | null;
    origin: 'live-network' | 'pinned-local-cache' | 'local-file' | 'manual' | null;
    sourceTypeHint?: 'experimental' | 'prediction' | 'auto';
    dataRevision?: string | null;
  };
  createdAtUtc: string;
  updatedAtUtc: string;
  lastOpenedAtUtc: string | null;
}

export type NewLibraryItem = Omit<
  LibraryItem,
  'id' | 'sha256' | 'sizeBytes' | 'createdAtUtc' | 'updatedAtUtc' | 'lastOpenedAtUtc' | 'tags' | 'notes' | 'favorite'
> &
  Partial<Pick<LibraryItem, 'tags' | 'notes' | 'favorite'>>;

const DB_NAME = 'synlexa_studio_library';
const STORE = 'items';
const memory = new Map<string, LibraryItem>();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function subscribeLibrary(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let dbPromise: Promise<IDBDatabase | null> | null = null;
function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('sha256', 'sha256', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function newId(): string {
  const rnd = new Uint8Array(8);
  globalThis.crypto?.getRandomValues?.(rnd);
  return `lib_${Date.now().toString(36)}_${Array.from(rnd, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export async function listLibrary(): Promise<LibraryItem[]> {
  const db = await openDb();
  const items = db ? await tx<LibraryItem[]>(db, 'readonly', (s) => s.getAll()) : Array.from(memory.values());
  return items.sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    return (b.lastOpenedAtUtc ?? b.updatedAtUtc).localeCompare(a.lastOpenedAtUtc ?? a.updatedAtUtc);
  });
}

export async function getLibraryItem(id: string): Promise<LibraryItem | null> {
  const db = await openDb();
  if (!db) return memory.get(id) ?? null;
  return (await tx<LibraryItem | undefined>(db, 'readonly', (s) => s.get(id))) ?? null;
}

async function put(item: LibraryItem): Promise<void> {
  const db = await openDb();
  if (db) await tx(db, 'readwrite', (s) => s.put(item));
  else memory.set(item.id, item);
}

/**
 * Adds an item. If an item with identical content (same SHA-256 and kind)
 * already exists, it is returned instead of creating a duplicate.
 */
export async function addToLibrary(input: NewLibraryItem): Promise<{ item: LibraryItem; duplicate: boolean }> {
  const sha256 = await sha256HexUniversal(input.content);
  const existing = (await listLibrary()).find((i) => i.sha256 === sha256 && i.kind === input.kind);
  if (existing) return { item: existing, duplicate: true };
  const now = new Date().toISOString();
  const item: LibraryItem = {
    ...input,
    id: newId(),
    sha256,
    sizeBytes: new TextEncoder().encode(input.content).byteLength,
    tags: input.tags ?? [],
    notes: input.notes ?? '',
    favorite: input.favorite ?? false,
    createdAtUtc: now,
    updatedAtUtc: now,
    lastOpenedAtUtc: null,
  };
  await put(item);
  emit();
  return { item, duplicate: false };
}

export async function updateLibraryItem(
  id: string,
  patch: Partial<Pick<LibraryItem, 'name' | 'tags' | 'notes' | 'favorite' | 'content' | 'lastOpenedAtUtc'>>,
): Promise<LibraryItem | null> {
  const item = await getLibraryItem(id);
  if (!item) return null;
  const next: LibraryItem = { ...item, ...patch };
  if (patch.content !== undefined && patch.content !== item.content) {
    next.sha256 = await sha256HexUniversal(patch.content);
    next.sizeBytes = new TextEncoder().encode(patch.content).byteLength;
    next.source = { ...item.source, origin: 'manual' };
  }
  if (patch.lastOpenedAtUtc === undefined) next.updatedAtUtc = new Date().toISOString();
  await put(next);
  emit();
  return next;
}

export async function duplicateLibraryItem(id: string): Promise<LibraryItem | null> {
  const item = await getLibraryItem(id);
  if (!item) return null;
  const now = new Date().toISOString();
  const copy: LibraryItem = {
    ...item,
    id: newId(),
    name: `${item.name} (copy)`,
    favorite: false,
    createdAtUtc: now,
    updatedAtUtc: now,
    lastOpenedAtUtc: null,
  };
  await put(copy);
  emit();
  return copy;
}

export async function deleteLibraryItems(ids: string[]): Promise<void> {
  const db = await openDb();
  for (const id of ids) {
    if (db) await tx(db, 'readwrite', (s) => s.delete(id));
    else memory.delete(id);
  }
  emit();
}

export async function clearLibrary(): Promise<void> {
  const db = await openDb();
  if (db) await tx(db, 'readwrite', (s) => s.clear());
  else memory.clear();
  emit();
}

export interface LibraryExport {
  format: 'synlexa.library.v1';
  exportedAtUtc: string;
  disclaimer: string;
  items: LibraryItem[];
}

export async function exportLibrary(disclaimer: string, ids?: string[]): Promise<LibraryExport> {
  const all = await listLibrary();
  return {
    format: 'synlexa.library.v1',
    exportedAtUtc: new Date().toISOString(),
    disclaimer,
    items: ids ? all.filter((i) => ids.includes(i.id)) : all,
  };
}

/** Imports a library export; skips items whose content already exists. Returns count added. */
export async function importLibrary(json: string): Promise<number> {
  const parsed = JSON.parse(json) as Partial<LibraryExport>;
  if (parsed.format !== 'synlexa.library.v1' || !Array.isArray(parsed.items)) {
    throw new Error('Not a Synlexa library export (expected format "synlexa.library.v1").');
  }
  let added = 0;
  for (const raw of parsed.items) {
    if (!raw || typeof raw.content !== 'string' || typeof raw.name !== 'string') continue;
    const { duplicate } = await addToLibrary({
      kind: raw.kind,
      name: raw.name,
      format: raw.format,
      content: raw.content,
      paeJson: raw.paeJson ?? null,
      tags: raw.tags,
      notes: raw.notes,
      favorite: raw.favorite,
      source: raw.source,
    });
    if (!duplicate) added++;
  }
  return added;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function detectFormat(fileName: string): { kind: LibraryKind; format: string } | null {
  const lower = fileName.toLowerCase();
  if (/\.(cif|mmcif)$/.test(lower)) return { kind: 'structure', format: 'cif' };
  if (/\.(pdb|ent)$/.test(lower)) return { kind: 'structure', format: 'pdb' };
  if (/\.smi$/.test(lower)) return { kind: 'compound', format: 'smiles' };
  if (/\.(fasta|fa|faa)$/.test(lower)) return { kind: 'sequence', format: 'fasta' };
  return null;
}
