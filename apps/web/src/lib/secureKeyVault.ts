/**
 * Local encrypted BYOK credential vault (`state.vscdb`, `ItemTable`).
 *
 * Security model:
 *  - API keys are NEVER persisted in plain-text JSON files, project bundles,
 *    or plain-text localStorage keys.
 *  - In the browser / WebView, keys are encrypted with a non-extractable
 *    WebCrypto AES-256-GCM key stored in IndexedDB `state.vscdb` (`VaultKeyStore`)
 *    and written as encrypted `secret://synlexa.studio.vault/<provider>` rows into
 *    the `ItemTable` object store.
 *  - When hosted by the native desktop binary (`127.0.0.1` native host), keys are
 *    also persisted to the local SQLite database `~/.synlexa-studio/state.vscdb`
 *    (`ItemTable` table) using machine-bound encryption (`vscdb-enc-v1`).
 */
import { sha256HexUniversal } from './sha256';

export type VaultProvider = 'anthropic' | 'gemini' | 'openai';

export interface VaultEntryMeta {
  provider: VaultProvider;
  fingerprint: string;
  updatedAtUtc: string;
  cipher: string;
}

export interface VaultStatus {
  initialized: boolean;
  backend: 'sqlite-state.vscdb' | 'indexeddb-state.vscdb-aes256gcm' | 'memory-fallback';
  dbName: string;
  tableName: string;
  dbPath: string;
  encrypted: boolean;
  cipher: string;
  storedProviders: VaultProvider[];
  entries: Partial<Record<VaultProvider, VaultEntryMeta>>;
  migratedLegacyCount: number;
}

const DB_NAME = 'state.vscdb';
const DB_VERSION = 1;
const ITEM_TABLE = 'ItemTable';
const KEY_STORE = 'VaultKeyStore';
const MASTER_KEY_ID = 'synlexa.studio.master.aes256gcm';
const SECRET_PREFIX = 'secret://synlexa.studio.vault/';
const CUSTOM_SECRET_PREFIX = 'secret://synlexa.studio.vault/custom/';

const LEGACY_LS_KEYS: Record<VaultProvider, string> = {
  gemini: 'synlexa.studio.gemini.apiKey',
  anthropic: 'synlexa.studio.anthropic.apiKey',
  openai: 'synlexa.studio.openai.apiKey',
};

const PROVIDERS: VaultProvider[] = ['anthropic', 'gemini', 'openai'];

interface EncryptedRow {
  key: string;
  value: {
    v: 1;
    alg: 'AES-GCM-256' | 'LOCAL-OBF-V1';
    iv: string;
    ct: string;
    fingerprint: string;
    updatedAtUtc: string;
  };
}

const memorySecrets = new Map<VaultProvider, string>();
const memoryMeta = new Map<VaultProvider, VaultEntryMeta>();
const customMemorySecrets = new Map<string, string>();
const listeners = new Set<() => void>();

let vaultState: VaultStatus = {
  initialized: false,
  backend: 'memory-fallback',
  dbName: DB_NAME,
  tableName: ITEM_TABLE,
  dbPath: 'IndexedDB://state.vscdb/ItemTable',
  encrypted: true,
  cipher: 'AES-256-GCM',
  storedProviders: [],
  entries: {},
  migratedLegacyCount: 0,
};

let initPromise: Promise<VaultStatus> | null = null;
let dbPromise: Promise<IDBDatabase | null> | null = null;

function emit() {
  for (const fn of listeners) fn();
}

export function subscribeVault(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getVaultStatus(): VaultStatus {
  return {
    ...vaultState,
    storedProviders: PROVIDERS.filter((p) => memorySecrets.has(p) && Boolean(memorySecrets.get(p))),
    entries: Object.fromEntries(memoryMeta.entries()),
  };
}

export function getVaultSecret(provider: VaultProvider): string {
  return memorySecrets.get(provider) ?? '';
}

export function getCustomVaultSecret(namespaceKey: string): string {
  return customMemorySecrets.get(namespaceKey) ?? '';
}

export async function setCustomVaultSecret(namespaceKey: string, secret: string): Promise<void> {
  const cleanKey = namespaceKey.trim().replace(/[^a-zA-Z0-9._:-]/g, '_');
  if (!cleanKey) return;
  const trimmed = secret.trim();
  const now = new Date().toISOString();
  if (!trimmed) {
    customMemorySecrets.delete(cleanKey);
  } else {
    customMemorySecrets.set(cleanKey, trimmed);
  }
  const db = await openStateVscdb();
  if (db) {
    const key = await getOrCreateMasterKey(db);
    const rowKey = `${CUSTOM_SECRET_PREFIX}${cleanKey}`;
    if (!trimmed) {
      const tx = db.transaction(ITEM_TABLE, 'readwrite');
      await idbReq(tx.objectStore(ITEM_TABLE).delete(rowKey));
    } else {
      const enc = await encryptSecret(trimmed, key);
      const fp = await computeFingerprint(trimmed);
      const row: EncryptedRow = {
        key: rowKey,
        value: {
          v: 1,
          alg: enc.alg,
          iv: enc.iv,
          ct: enc.ct,
          fingerprint: fp,
          updatedAtUtc: now,
        },
      };
      const tx = db.transaction(ITEM_TABLE, 'readwrite');
      await idbReq(tx.objectStore(ITEM_TABLE).put(row));
    }
  }
  emit();
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function openStateVscdb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(ITEM_TABLE)) {
          db.createObjectStore(ITEM_TABLE, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(KEY_STORE)) {
          db.createObjectStore(KEY_STORE, { keyPath: 'id' });
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

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getOrCreateMasterKey(db: IDBDatabase): Promise<CryptoKey | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  try {
    const readTx = db.transaction(KEY_STORE, 'readonly');
    const existing = (await idbReq<{ id: string; key: CryptoKey } | undefined>(
      readTx.objectStore(KEY_STORE).get(MASTER_KEY_ID),
    )) ?? null;
    if (existing?.key) return existing.key;

    const generated = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    const writeTx = db.transaction(KEY_STORE, 'readwrite');
    await idbReq(writeTx.objectStore(KEY_STORE).put({ id: MASTER_KEY_ID, key: generated }));
    return generated;
  } catch {
    return null;
  }
}

async function encryptSecret(
  plaintext: string,
  key: CryptoKey | null,
): Promise<{ alg: 'AES-GCM-256' | 'LOCAL-OBF-V1'; iv: string; ct: string }> {
  const enc = new TextEncoder().encode(plaintext);
  if (key && globalThis.crypto?.subtle && globalThis.crypto?.getRandomValues) {
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const buf = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc);
    return {
      alg: 'AES-GCM-256',
      iv: bytesToB64(iv),
      ct: bytesToB64(new Uint8Array(buf)),
    };
  }
  // Fallback when subtle crypto is absent (e.g. insecure non-localhost origin)
  const nonce = new Uint8Array(12);
  globalThis.crypto?.getRandomValues?.(nonce);
  const masked = new Uint8Array(enc.length);
  for (let i = 0; i < enc.length; i++) masked[i] = enc[i] ^ nonce[i % nonce.length] ^ 0x5a;
  return { alg: 'LOCAL-OBF-V1', iv: bytesToB64(nonce), ct: bytesToB64(masked) };
}

async function decryptSecret(
  row: EncryptedRow['value'],
  key: CryptoKey | null,
): Promise<string | null> {
  try {
    const iv = b64ToBytes(row.iv);
    const ct = b64ToBytes(row.ct);
    if (row.alg === 'AES-GCM-256') {
      if (!key || !globalThis.crypto?.subtle) return null;
      const plain = await globalThis.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv as BufferSource },
        key,
        ct as BufferSource,
      );
      return new TextDecoder().decode(plain);
    }
    const out = new Uint8Array(ct.length);
    for (let i = 0; i < ct.length; i++) out[i] = ct[i] ^ iv[i % iv.length] ^ 0x5a;
    return new TextDecoder().decode(out);
  } catch {
    return null;
  }
}

async function computeFingerprint(secret: string): Promise<string> {
  const hash = await sha256HexUniversal(`synlexa-vault-fp:${secret}`);
  return hash.slice(0, 12);
}

function isLocalhostLoopback(): boolean {
  if (typeof window === 'undefined') return false;
  const h = window.location?.hostname ?? '';
  return h === '127.0.0.1' || h === 'localhost';
}

async function probeNativeSqliteVault(): Promise<{
  available: boolean;
  dbPath?: string;
  keys?: Partial<Record<VaultProvider, string>>;
}> {
  if (!isLocalhostLoopback() || typeof fetch !== 'function') return { available: false };
  try {
    const res = await fetch('/api/local-vault/keys', { method: 'GET' });
    if (!res.ok) return { available: false };
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) return { available: false };
    const data = (await res.json()) as {
      ok?: boolean;
      dbPath?: string;
      keys?: Partial<Record<VaultProvider, string>>;
    };
    if (!data?.ok) return { available: false };
    return { available: true, dbPath: data.dbPath, keys: data.keys ?? {} };
  } catch {
    return { available: false };
  }
}

async function syncToNativeSqliteVault(provider: VaultProvider, apiKey: string): Promise<string | null> {
  if (!isLocalhostLoopback() || typeof fetch !== 'function') return null;
  try {
    const res = await fetch('/api/local-vault/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, apiKey }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { ok?: boolean; dbPath?: string };
    return data?.ok ? data.dbPath ?? '~/.synlexa-studio/state.vscdb' : null;
  } catch {
    return null;
  }
}

function scrubLegacyLocalStorage(): Array<{ provider: VaultProvider; key: string }> {
  const migrated: Array<{ provider: VaultProvider; key: string }> = [];
  try {
    if (typeof localStorage === 'undefined') return migrated;
    for (const p of PROVIDERS) {
      const lsKey = LEGACY_LS_KEYS[p];
      const val = localStorage.getItem(lsKey)?.trim();
      if (val) {
        migrated.push({ provider: p, key: val });
        localStorage.removeItem(lsKey);
      }
    }
  } catch {
    // ignore restricted storage
  }
  return migrated;
}

export async function setVaultSecret(provider: VaultProvider, apiKey: string): Promise<VaultStatus> {
  const trimmed = apiKey.trim();
  const now = new Date().toISOString();

  // Never keep plain-text copies in localStorage
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(LEGACY_LS_KEYS[provider]);
  } catch {
    /* ignore */
  }

  if (!trimmed) {
    memorySecrets.delete(provider);
    memoryMeta.delete(provider);
  } else {
    memorySecrets.set(provider, trimmed);
    const fingerprint = await computeFingerprint(trimmed);
    memoryMeta.set(provider, {
      provider,
      fingerprint,
      updatedAtUtc: now,
      cipher: vaultState.cipher,
    });
  }

  const db = await openStateVscdb();
  if (db) {
    const key = await getOrCreateMasterKey(db);
    const rowKey = `${SECRET_PREFIX}${provider}`;
    if (!trimmed) {
      const tx = db.transaction(ITEM_TABLE, 'readwrite');
      await idbReq(tx.objectStore(ITEM_TABLE).delete(rowKey));
    } else {
      const enc = await encryptSecret(trimmed, key);
      const fp = memoryMeta.get(provider)?.fingerprint ?? (await computeFingerprint(trimmed));
      const row: EncryptedRow = {
        key: rowKey,
        value: {
          v: 1,
          alg: enc.alg,
          iv: enc.iv,
          ct: enc.ct,
          fingerprint: fp,
          updatedAtUtc: now,
        },
      };
      const tx = db.transaction(ITEM_TABLE, 'readwrite');
      await idbReq(tx.objectStore(ITEM_TABLE).put(row));
    }
  }

  const nativePath = await syncToNativeSqliteVault(provider, trimmed);
  if (nativePath) {
    vaultState = {
      ...vaultState,
      backend: 'sqlite-state.vscdb',
      dbPath: `${nativePath} (ItemTable)`,
      cipher: 'AES-256-GCM + vscdb-enc-v1',
    };
  } else if (db) {
    vaultState = {
      ...vaultState,
      backend: 'indexeddb-state.vscdb-aes256gcm',
      dbPath: 'IndexedDB://state.vscdb/ItemTable',
      cipher: globalThis.crypto?.subtle ? 'AES-256-GCM' : 'LOCAL-OBF-V1',
    };
  }

  const status = getVaultStatus();
  vaultState = { ...status, initialized: true };
  emit();
  return vaultState;
}

export async function initSecureVault(): Promise<VaultStatus> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const db = await openStateVscdb();
    let masterKey: CryptoKey | null = null;
    if (db) {
      masterKey = await getOrCreateMasterKey(db);
      try {
        const tx = db.transaction(ITEM_TABLE, 'readonly');
        const rows = (await idbReq<EncryptedRow[]>(tx.objectStore(ITEM_TABLE).getAll())) ?? [];
        for (const row of rows) {
          if (!row?.key?.startsWith(SECRET_PREFIX)) continue;
          if (row.key.startsWith(CUSTOM_SECRET_PREFIX)) {
            const customKey = row.key.slice(CUSTOM_SECRET_PREFIX.length);
            const plainCustom = await decryptSecret(row.value, masterKey);
            if (plainCustom && customKey) {
              customMemorySecrets.set(customKey, plainCustom);
            }
            continue;
          }
          const p = row.key.slice(SECRET_PREFIX.length) as VaultProvider;
          if (!PROVIDERS.includes(p)) continue;
          const plain = await decryptSecret(row.value, masterKey);
          if (plain) {
            memorySecrets.set(p, plain);
            memoryMeta.set(p, {
              provider: p,
              fingerprint: row.value.fingerprint,
              updatedAtUtc: row.value.updatedAtUtc,
              cipher: row.value.alg,
            });
          }
        }
      } catch {
        /* ignore corrupt store */
      }
    }

    // Check native desktop SQLite state.vscdb host if available
    const native = await probeNativeSqliteVault();
    if (native.available && native.keys) {
      for (const p of PROVIDERS) {
        const nk = native.keys[p]?.trim();
        if (nk && !memorySecrets.has(p)) {
          memorySecrets.set(p, nk);
          memoryMeta.set(p, {
            provider: p,
            fingerprint: await computeFingerprint(nk),
            updatedAtUtc: new Date().toISOString(),
            cipher: 'vscdb-enc-v1',
          });
        }
      }
    }

    // Migrate any legacy plain-text keys from localStorage into state.vscdb and scrub them
    const legacy = scrubLegacyLocalStorage();
    for (const item of legacy) {
      await setVaultSecret(item.provider, item.key);
    }

    vaultState = {
      ...vaultState,
      initialized: true,
      backend: native.available
        ? 'sqlite-state.vscdb'
        : db
          ? 'indexeddb-state.vscdb-aes256gcm'
          : 'memory-fallback',
      dbPath: native.available
        ? `${native.dbPath ?? '~/.synlexa-studio/state.vscdb'} (ItemTable)`
        : db
          ? 'IndexedDB://state.vscdb/ItemTable'
          : 'memory://state.vscdb/ItemTable',
      cipher: native.available
        ? 'AES-256-GCM + SQLite state.vscdb'
        : db && masterKey
          ? 'AES-256-GCM'
          : 'In-memory sealed session',
      migratedLegacyCount: legacy.length,
    };
    const next = { ...getVaultStatus(), initialized: true };
    vaultState = next;
    emit();
    return next;
  })();
  return initPromise;
}

/** Test helper to reset vault state between unit tests. */
export function resetVaultForTesting(): void {
  memorySecrets.clear();
  memoryMeta.clear();
  customMemorySecrets.clear();
  initPromise = null;
  dbPromise = null;
  vaultState = {
    initialized: false,
    backend: 'memory-fallback',
    dbName: DB_NAME,
    tableName: ITEM_TABLE,
    dbPath: 'IndexedDB://state.vscdb/ItemTable',
    encrypted: true,
    cipher: 'AES-256-GCM',
    storedProviders: [],
    entries: {},
    migratedLegacyCount: 0,
  };
}
