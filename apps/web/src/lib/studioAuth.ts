import { sha256Digest } from './sha256';
/**
 * Synlexa Studio <-> synlexa.com account connection (Research-Use-Only).
 *
 * Implements the client half of an OAuth 2.0 Authorization Code + PKCE
 * (RFC 7636, S256) handshake. The Studio generates a code_verifier/state,
 * sends the user to synlexa.com, and receives `code` + `state` back either via
 * the desktop deep link `synlexa-studio://auth/callback` or via a web
 * redirect to `${origin}/?studio_auth=callback`.
 *
 * Honesty rules:
 *  - A session is only labelled `serverVerified: true` when the token
 *    endpoint accepted the code + code_verifier. Otherwise it is labelled
 *    `verification: 'local-pkce-only'`.
 *  - The code_verifier and raw authorization code are never persisted and are
 *    never logged. The access token returned by the token endpoint is kept
 *    under its own storage key (never inside the session record) and is only
 *    sent to synlexa.com as a bearer token (Synlexa Cloud assistant).
 *
 * This module is pure and injectable: no `window` access at module top-level,
 * so it runs in the Node/Vitest environment (globalThis.crypto.subtle).
 */

function resolveCloudOrigin(): string {
  try {
    const raw = (import.meta as { env?: { VITE_SYNLEXA_CLOUD_URL?: string } })?.env?.VITE_SYNLEXA_CLOUD_URL?.trim();
    if (raw) return raw.replace(/\/+$/, '');
  } catch {
    // Node/Vitest fallback
  }
  return 'https://synlexa.com';
}

const CLOUD_ORIGIN = resolveCloudOrigin();

export const STUDIO_AUTH_BASE = `${CLOUD_ORIGIN}/auth/studio-connect`;
export const STUDIO_DEEP_LINK_REDIRECT = 'synlexa-studio://auth/callback';
export const STUDIO_CLIENT_ID = 'synlexa-studio';
export const STUDIO_TOKEN_ENDPOINT = `${CLOUD_ORIGIN}/api/studio/token`;
/** Optional Synlexa Cloud assistant proxy; bearer-authenticated. Offline local/BYOK mode requires no cloud endpoint. */
export const STUDIO_ASSISTANT_ENDPOINT = `${CLOUD_ORIGIN}/api/studio/assistant`;

export const STUDIO_AUTH_PENDING_KEY = 'synlexa.studio.auth.pending';
export const STUDIO_AUTH_SESSION_KEY = 'synlexa.studio.auth.session';
export const STUDIO_AUTH_TOKEN_KEY = 'synlexa.studio.auth.token';
/** Tauri event emitted by apps/desktop/src-tauri when the OS opens a deep link. */
export const STUDIO_DEEP_LINK_EVENT = 'studio-auth-callback';
/** Pending handshakes expire after 10 minutes. */
export const STUDIO_AUTH_PENDING_TTL_MS = 10 * 60 * 1000;

const VERIFIER_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
const VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;
const MAX_PARAM_LENGTH = 2048;

export type StudioAuthMode = 'signin' | 'signup';
export type StudioCallbackSource = 'deep-link' | 'web';
export type StudioVerification = 'server-token-exchange' | 'local-pkce-only';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PendingStudioAuth {
  mode: StudioAuthMode;
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  redirectUri: string;
  webRedirectUri: string;
  createdAtUtc: string;
}

export interface StudioSession {
  mode: StudioAuthMode;
  email: string | null;
  displayName: string | null;
  serverVerified: boolean;
  verification: StudioVerification;
  establishedAtUtc: string;
  callbackSource: StudioCallbackSource;
}

export type StudioAuthErrorCode =
  | 'STATE_MISMATCH'
  | 'NO_PENDING'
  | 'EXPIRED'
  | 'PKCE_MISMATCH'
  | 'INVALID_CALLBACK'
  | 'PROVIDER_ERROR';

export class StudioAuthError extends Error {
  readonly code: StudioAuthErrorCode;

  constructor(code: StudioAuthErrorCode, message: string) {
    super(message);
    this.name = 'StudioAuthError';
    this.code = code;
  }
}

export type StudioAuthCallbackResult =
  | { ok: true; code: string; state: string; source: StudioCallbackSource; email?: string }
  | {
      ok: false;
      reason: 'INVALID_CALLBACK' | 'PROVIDER_ERROR';
      message: string;
      error?: string;
      errorDescription?: string;
    };

export interface StudioTokenExchangeRequest {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
}

export interface StudioTokenExchangeResult {
  accessToken?: string;
  email?: string;
  displayName?: string;
}

export type StudioTokenExchange = (req: StudioTokenExchangeRequest) => Promise<StudioTokenExchangeResult>;

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

/** Simple in-memory StorageLike (tests and non-browser fallback). */
export function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => {
      map.set(k, String(v));
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

function browserStorage(kind: 'sessionStorage' | 'localStorage'): StorageLike | null {
  try {
    const g = globalThis as unknown as Record<string, unknown>;
    const s = g[kind] as StorageLike | undefined;
    if (s && typeof s.getItem === 'function' && typeof s.setItem === 'function') return s;
  } catch {
    // Access can throw (e.g. disabled storage / sandboxed iframe).
  }
  return null;
}

let memoryFallback: StorageLike | null = null;
function fallbackStorage(): StorageLike {
  if (!memoryFallback) memoryFallback = createMemoryStorage();
  return memoryFallback;
}

/**
 * Default pending-handshake storage: sessionStorage, mirrored to localStorage
 * because a desktop deep link / external browser redirect may land in a new tab.
 */
export function defaultPendingStorage(): StorageLike {
  const stores = [browserStorage('sessionStorage'), browserStorage('localStorage')].filter(
    (s): s is StorageLike => s !== null,
  );
  if (stores.length === 0) return fallbackStorage();
  return {
    getItem(key) {
      for (const s of stores) {
        try {
          const v = s.getItem(key);
          if (v !== null) return v;
        } catch {
          /* ignore */
        }
      }
      return null;
    },
    setItem(key, value) {
      for (const s of stores) {
        try {
          s.setItem(key, value);
        } catch {
          /* ignore quota / disabled storage */
        }
      }
    },
    removeItem(key) {
      for (const s of stores) {
        try {
          s.removeItem(key);
        } catch {
          /* ignore */
        }
      }
    },
  };
}

function defaultSessionStore(): StorageLike {
  return browserStorage('localStorage') ?? fallbackStorage();
}

// ---------------------------------------------------------------------------
// PKCE primitives
// ---------------------------------------------------------------------------

function getCrypto(): Crypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error('Web Crypto (crypto.getRandomValues) is unavailable in this runtime.');
  }
  return c;
}

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Unpadded base64url (RFC 4648 §5) encoding. */
export function base64UrlEncode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63] + B64URL[(n >> 6) & 63] + B64URL[n & 63];
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i] << 16;
    out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63];
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63] + B64URL[(n >> 6) & 63];
  }
  return out;
}

/** RFC 7636 §4.1 code_verifier: unreserved charset, 43..128 chars, unbiased sampling. */
export function generateCodeVerifier(length = 64): string {
  if (!Number.isInteger(length) || length < 43 || length > 128) {
    throw new RangeError('PKCE code_verifier length must be an integer between 43 and 128.');
  }
  const c = getCrypto();
  const limit = 256 - (256 % VERIFIER_CHARSET.length); // rejection sampling avoids modulo bias
  let out = '';
  while (out.length < length) {
    const buf = c.getRandomValues(new Uint8Array(length * 2));
    for (let i = 0; i < buf.length && out.length < length; i++) {
      if (buf[i] < limit) out += VERIFIER_CHARSET[buf[i] % VERIFIER_CHARSET.length];
    }
  }
  return out;
}

/** 256-bit random state, base64url encoded (43 chars). */
export function generateState(): string {
  return base64UrlEncode(getCrypto().getRandomValues(new Uint8Array(32)));
}

/** BASE64URL(SHA256(ASCII(code_verifier))) per RFC 7636 §4.2. */
export async function computeCodeChallengeS256(verifier: string): Promise<string> {
  return base64UrlEncode(await sha256Digest(new TextEncoder().encode(verifier)));
}

/** Length-checked, branch-free-per-character comparison. */
function timingSafeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Authorization request
// ---------------------------------------------------------------------------

function normalizeOrigin(webOrigin: string): string {
  return webOrigin.replace(/\/+$/, '');
}

export function buildWebRedirectUri(webOrigin: string): string {
  return `${normalizeOrigin(webOrigin)}/?studio_auth=callback`;
}

export type StudioPlatform = 'web' | 'desktop';

export function buildStudioConnectUrl(opts: {
  mode: StudioAuthMode;
  state: string;
  codeChallenge: string;
  webOrigin: string;
  /** Tells synlexa.com which return path to offer (desktop deep link vs. this browser). */
  platform?: StudioPlatform;
}): string {
  const url = new URL(STUDIO_AUTH_BASE);
  url.searchParams.set('mode', opts.mode);
  url.searchParams.set('client', STUDIO_CLIENT_ID);
  url.searchParams.set('redirect_uri', STUDIO_DEEP_LINK_REDIRECT);
  url.searchParams.set('web_redirect_uri', buildWebRedirectUri(opts.webOrigin));
  url.searchParams.set('code_challenge', opts.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', opts.state);
  if (opts.platform) url.searchParams.set('platform', opts.platform);
  return url.toString();
}

export async function beginStudioAuth(
  mode: StudioAuthMode,
  opts: { webOrigin?: string; storage?: StorageLike; now?: () => Date; platform?: StudioPlatform } = {},
): Promise<{ url: string; pending: PendingStudioAuth }> {
  if (mode !== 'signin' && mode !== 'signup') {
    throw new StudioAuthError('INVALID_CALLBACK', 'Unsupported Studio auth mode.');
  }
  const storage = opts.storage ?? defaultPendingStorage();
  const now = opts.now ?? (() => new Date());
  const browserOrigin = (globalThis as { location?: { origin?: string } }).location?.origin;
  const webOrigin = opts.webOrigin ?? (browserOrigin && browserOrigin !== 'null' ? browserOrigin : 'http://localhost:5173');
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await computeCodeChallengeS256(codeVerifier);
  const state = generateState();
  const pending: PendingStudioAuth = {
    mode,
    state,
    codeVerifier,
    codeChallenge,
    redirectUri: STUDIO_DEEP_LINK_REDIRECT,
    webRedirectUri: buildWebRedirectUri(webOrigin),
    createdAtUtc: now().toISOString(),
  };
  storage.setItem(STUDIO_AUTH_PENDING_KEY, JSON.stringify(pending));
  const url = buildStudioConnectUrl({ mode, state, codeChallenge, webOrigin, platform: opts.platform });
  return { url, pending };
}

export function loadPendingStudioAuth(storage: StorageLike = defaultPendingStorage()): PendingStudioAuth | null {
  let raw: string | null = null;
  try {
    raw = storage.getItem(STUDIO_AUTH_PENDING_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<PendingStudioAuth>;
    if (
      (p.mode === 'signin' || p.mode === 'signup') &&
      typeof p.state === 'string' &&
      typeof p.codeVerifier === 'string' &&
      typeof p.codeChallenge === 'string' &&
      typeof p.redirectUri === 'string' &&
      typeof p.webRedirectUri === 'string' &&
      typeof p.createdAtUtc === 'string'
    ) {
      return p as PendingStudioAuth;
    }
  } catch {
    /* malformed */
  }
  return null;
}

export function clearPendingStudioAuth(storage: StorageLike = defaultPendingStorage()): void {
  try {
    storage.removeItem(STUDIO_AUTH_PENDING_KEY);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Callback parsing
// ---------------------------------------------------------------------------

function invalid(message: string): StudioAuthCallbackResult {
  return { ok: false, reason: 'INVALID_CALLBACK', message };
}

function resultFromParams(params: URLSearchParams, source: StudioCallbackSource): StudioAuthCallbackResult {
  const error = params.get('error');
  if (error) {
    const errorDescription = params.get('error_description') ?? undefined;
    return {
      ok: false,
      reason: 'PROVIDER_ERROR',
      message: errorDescription ? `${error}: ${errorDescription}` : error,
      error,
      errorDescription,
    };
  }
  const code = params.get('code');
  const state = params.get('state');
  if (!code || !state) return invalid('Callback is missing the required code and/or state parameter.');
  if (code.length > MAX_PARAM_LENGTH || state.length > MAX_PARAM_LENGTH) {
    return invalid('Callback parameters exceed the maximum allowed length.');
  }
  const email = params.get('email');
  const result: StudioAuthCallbackResult = { ok: true, code, state, source };
  if (email) result.email = email;
  return result;
}

/**
 * Accepts `synlexa-studio://auth/callback?code=..&state=..` (deep link) or an
 * http(s) URL carrying `studio_auth=callback` (web redirect).
 */
export function parseStudioAuthCallback(uri: string): StudioAuthCallbackResult {
  if (typeof uri !== 'string') return invalid('Callback URI must be a string.');
  const trimmed = uri.trim();
  if (!trimmed) return invalid('Callback URI is empty.');
  if (trimmed.length > 8192) return invalid('Callback URI is too long.');

  const lower = trimmed.toLowerCase();
  if (lower.startsWith('synlexa-studio:')) {
    const prefix = STUDIO_DEEP_LINK_REDIRECT; // already lower-case
    if (!lower.startsWith(prefix)) return invalid('Deep link must target synlexa-studio://auth/callback.');
    const rest = trimmed.slice(prefix.length);
    if (rest !== '' && rest[0] !== '?' && rest[0] !== '#') {
      return invalid('Deep link must target synlexa-studio://auth/callback.');
    }
    const query = rest.startsWith('?') ? rest.slice(1).split('#')[0] : '';
    return resultFromParams(new URLSearchParams(query), 'deep-link');
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return invalid('Callback URI is not a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return invalid(`Unsupported callback scheme "${url.protocol}".`);
  }
  if (url.searchParams.get('studio_auth') !== 'callback') {
    return invalid('Web callback must include studio_auth=callback.');
  }
  return resultFromParams(url.searchParams, 'web');
}

/** Returns `href` when it is a Studio web callback, else null. Caller strips the query via history.replaceState. */
export function consumeWebCallbackFromLocation(href: string): string | null {
  try {
    const url = new URL(href);
    if (url.searchParams.get('studio_auth') === 'callback') return url.toString();
  } catch {
    /* not a URL */
  }
  return null;
}

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

/** Default token exchange: POST JSON to STUDIO_TOKEN_ENDPOINT. Throws when unavailable or rejected. */
export async function defaultStudioTokenExchange(req: StudioTokenExchangeRequest): Promise<StudioTokenExchangeResult> {
  const f = (globalThis as { fetch?: typeof fetch }).fetch;
  if (typeof f !== 'function') throw new Error('fetch is unavailable');
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 10_000) : null;
  try {
    const res = await f(STUDIO_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: req.code,
        code_verifier: req.codeVerifier,
        redirect_uri: req.redirectUri,
        client_id: req.clientId,
      }),
      signal: controller?.signal,
    });
    if (!res.ok) throw new Error(`Token endpoint responded with HTTP ${res.status}`);
    const parsed: unknown = await res.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Token endpoint returned non-object JSON');
    }
    const body = parsed as Record<string, unknown>;
    if (typeof body.error === 'string' && body.error) {
      throw new Error(`Token endpoint error: ${body.error}`);
    }
    const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
    return {
      accessToken: str(body.access_token) ?? str(body.accessToken),
      email: str(body.email),
      displayName: str(body.display_name) ?? str(body.displayName),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface CompleteStudioAuthOptions {
  /** Where the pending handshake was stored (defaults to sessionStorage+localStorage mirror). */
  storage?: StorageLike;
  /** Where the resulting session is persisted (defaults to localStorage). */
  sessionStore?: StorageLike;
  /** Token exchange; defaults to POSTing to STUDIO_TOKEN_ENDPOINT. */
  exchange?: StudioTokenExchange;
  now?: () => Date;
}

export async function completeStudioAuth(
  callbackUri: string,
  opts: CompleteStudioAuthOptions = {},
): Promise<StudioSession> {
  const storage = opts.storage ?? defaultPendingStorage();
  const now = opts.now ?? (() => new Date());

  const parsed = parseStudioAuthCallback(callbackUri);
  if (!parsed.ok) throw new StudioAuthError(parsed.reason, parsed.message);

  const pending = loadPendingStudioAuth(storage);
  if (!pending) {
    throw new StudioAuthError(
      'NO_PENDING',
      'No pending Studio sign-in was found in this app/browser profile. Start again from "Continue on synlexa.com".',
    );
  }

  if (!timingSafeEqual(parsed.state, pending.state)) {
    throw new StudioAuthError('STATE_MISMATCH', 'Callback state does not match the pending handshake.');
  }

  const created = Date.parse(pending.createdAtUtc);
  const age = now().getTime() - created;
  if (!Number.isFinite(created) || age < -60_000 || age > STUDIO_AUTH_PENDING_TTL_MS) {
    clearPendingStudioAuth(storage);
    throw new StudioAuthError('EXPIRED', 'The pending Studio sign-in expired (10 minute limit). Please start again.');
  }

  const recomputed = VERIFIER_PATTERN.test(pending.codeVerifier)
    ? await computeCodeChallengeS256(pending.codeVerifier)
    : '';
  if (!recomputed || !timingSafeEqual(recomputed, pending.codeChallenge)) {
    clearPendingStudioAuth(storage);
    throw new StudioAuthError('PKCE_MISMATCH', 'Stored PKCE verifier does not match its code challenge.');
  }

  const exchange = opts.exchange ?? defaultStudioTokenExchange;
  let exchanged: StudioTokenExchangeResult | null = null;
  try {
    exchanged = await exchange({
      code: parsed.code,
      codeVerifier: pending.codeVerifier,
      redirectUri: parsed.source === 'deep-link' ? pending.redirectUri : pending.webRedirectUri,
      clientId: STUDIO_CLIENT_ID,
    });
  } catch {
    exchanged = null; // Server verification unavailable: fall back to honest local-only labelling.
  }

  const serverVerified = exchanged !== null;
  const session: StudioSession = {
    mode: pending.mode,
    email: exchanged?.email ?? parsed.email ?? null,
    displayName: exchanged?.displayName ?? null,
    serverVerified,
    verification: serverVerified ? 'server-token-exchange' : 'local-pkce-only',
    establishedAtUtc: now().toISOString(),
    callbackSource: parsed.source,
  };

  clearPendingStudioAuth(storage);
  saveStudioSession(session, opts.sessionStore);
  saveStudioAccessToken(exchanged?.accessToken ?? null, opts.sessionStore);
  return session;
}

// ---------------------------------------------------------------------------
// Session persistence (never contains code_verifier, raw code, or tokens)
// ---------------------------------------------------------------------------

export function saveStudioSession(session: StudioSession, store: StorageLike = defaultSessionStore()): void {
  const record: StudioSession = {
    mode: session.mode,
    email: session.email,
    displayName: session.displayName,
    serverVerified: session.serverVerified,
    verification: session.verification,
    establishedAtUtc: session.establishedAtUtc,
    callbackSource: session.callbackSource,
  };
  try {
    store.setItem(STUDIO_AUTH_SESSION_KEY, JSON.stringify(record));
  } catch {
    /* ignore quota / disabled storage */
  }
}

export function loadStudioSession(store: StorageLike = defaultSessionStore()): StudioSession | null {
  let raw: string | null = null;
  try {
    raw = store.getItem(STUDIO_AUTH_SESSION_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<StudioSession>;
    const strOrNull = (v: unknown) => v === null || typeof v === 'string';
    if (
      (s.mode === 'signin' || s.mode === 'signup') &&
      strOrNull(s.email) &&
      strOrNull(s.displayName) &&
      typeof s.serverVerified === 'boolean' &&
      (s.verification === 'server-token-exchange' || s.verification === 'local-pkce-only') &&
      s.serverVerified === (s.verification === 'server-token-exchange') &&
      typeof s.establishedAtUtc === 'string' &&
      (s.callbackSource === 'deep-link' || s.callbackSource === 'web')
    ) {
      return {
        mode: s.mode,
        email: s.email ?? null,
        displayName: s.displayName ?? null,
        serverVerified: s.serverVerified,
        verification: s.verification,
        establishedAtUtc: s.establishedAtUtc,
        callbackSource: s.callbackSource,
      };
    }
  } catch {
    /* malformed */
  }
  return null;
}

export function clearStudioSession(store: StorageLike = defaultSessionStore()): void {
  try {
    store.removeItem(STUDIO_AUTH_SESSION_KEY);
    store.removeItem(STUDIO_AUTH_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

/** Stores (or clears, when null) the synlexa.com access token separately from the session record. */
export function saveStudioAccessToken(token: string | null, store: StorageLike = defaultSessionStore()): void {
  try {
    if (token && /^[A-Za-z0-9._~+/=-]{16,512}$/.test(token)) store.setItem(STUDIO_AUTH_TOKEN_KEY, token);
    else store.removeItem(STUDIO_AUTH_TOKEN_KEY);
  } catch {
    /* ignore quota / disabled storage */
  }
}

export function loadStudioAccessToken(store: StorageLike = defaultSessionStore()): string | null {
  try {
    const t = store.getItem(STUDIO_AUTH_TOKEN_KEY);
    return t && /^[A-Za-z0-9._~+/=-]{16,512}$/.test(t) ? t : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Desktop (Tauri) integration
// ---------------------------------------------------------------------------

interface TauriGlobal {
  event?: {
    listen?: (event: string, handler: (e: { payload: unknown }) => void) => Promise<() => void>;
  };
  opener?: { openUrl?: (url: string) => Promise<void> };
}

function tauriGlobal(): TauriGlobal | null {
  const t = (globalThis as { __TAURI__?: TauriGlobal }).__TAURI__;
  return t && typeof t === 'object' ? t : null;
}

/**
 * Listens for the desktop deep-link event emitted by the Tauri shell.
 * No-op outside Tauri. Returns an unsubscribe function.
 */
export function subscribeDesktopDeepLink(cb: (uri: string) => void): () => void {
  const listen = tauriGlobal()?.event?.listen;
  if (typeof listen !== 'function') return () => {};
  let disposed = false;
  let unlisten: (() => void) | null = null;
  listen(STUDIO_DEEP_LINK_EVENT, (e) => {
    if (!disposed && typeof e.payload === 'string') cb(e.payload);
  })
    .then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    })
    .catch(() => {
      /* event permission missing: stay a no-op */
    });
  return () => {
    disposed = true;
    if (unlisten) {
      unlisten();
      unlisten = null;
    }
  };
}

/**
 * Opens the synlexa.com connect URL in the system browser: Tauri opener plugin
 * when present, otherwise window.open. Returns false when nothing could open it.
 */
export async function openStudioConnectUrl(url: string): Promise<boolean> {
  const openUrl = tauriGlobal()?.opener?.openUrl;
  if (typeof openUrl === 'function') {
    try {
      await openUrl(url);
      return true;
    } catch {
      /* fall through to window.open */
    }
  }
  const w = (globalThis as { open?: (u: string, t?: string, f?: string) => unknown }).open;
  if (typeof w === 'function') {
    w(url, '_blank', 'noopener,noreferrer');
    // With 'noopener' browsers return null even when a tab opens successfully.
    return true;
  }
  return false;
}

/** True inside the Tauri desktop shell (sign-in returns through the OS deep link). */
export function isDesktopShell(): boolean {
  return tauriGlobal() !== null;
}

// ---------------------------------------------------------------------------
// Web popup sign-in
// ---------------------------------------------------------------------------

/** window.name of the sign-in popup; lets the popup recognise itself after the synlexa.com round trip. */
export const STUDIO_AUTH_POPUP_NAME = 'synlexa-studio-signin';
export const STUDIO_AUTH_POPUP_ACTIVE_KEY = 'synlexa.studio.auth.popup_active';
export const STUDIO_AUTH_RELAY_KEY = 'synlexa.studio.auth.callback_relay';
const STUDIO_AUTH_CHANNEL = 'synlexa-studio-auth';
const STUDIO_AUTH_MESSAGE = 'synlexa-studio-auth-callback';

export function clearPopupActiveMarker(): void {
  try {
    window.localStorage?.removeItem(STUDIO_AUTH_POPUP_ACTIVE_KEY);
  } catch {
    /* ignore */
  }
}

/** Opens synlexa.com in a centred popup. Returns null when the browser blocked it. */
export function openSignInPopup(url: string): Window | null {
  if (typeof window === 'undefined' || typeof window.open !== 'function') return null;
  const w = 480;
  const h = 720;
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - w) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - h) / 2));
  const popup = window.open(url, STUDIO_AUTH_POPUP_NAME, `popup=yes,width=${w},height=${h},left=${left},top=${top}`);
  if (popup) {
    try {
      window.localStorage?.setItem(STUDIO_AUTH_POPUP_ACTIVE_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
  }
  return popup;
}

/**
 * Called on page load. When this window is the sign-in popup and the URL is a
 * Studio web callback, hands the callback to the Studio window that opened it
 * (BroadcastChannel, localStorage relay event, plus postMessage to the opener)
 * and returns true so the caller closes immediately instead of booting the app.
 */
export function relayPopupCallback(href: string): boolean {
  if (typeof window === 'undefined') return false;
  const cb = consumeWebCallbackFromLocation(href);
  if (!cb) return false;
  const opener = window.opener as Window | null;
  let popupMarkerFresh = false;
  try {
    const rawTs = window.localStorage?.getItem(STUDIO_AUTH_POPUP_ACTIVE_KEY);
    if (rawTs) {
      const ts = Number(rawTs);
      popupMarkerFresh = Number.isFinite(ts) && Date.now() - ts <= STUDIO_AUTH_PENDING_TTL_MS;
    }
  } catch {
    popupMarkerFresh = false;
  }
  const smallPopupWindow =
    window.outerWidth > 0 &&
    window.outerWidth <= 620 &&
    window.outerHeight > 0 &&
    window.outerHeight <= 860;
  const isPopup =
    window.name === STUDIO_AUTH_POPUP_NAME ||
    Boolean(opener) ||
    popupMarkerFresh ||
    smallPopupWindow;
  if (!isPopup) return false;

  clearPopupActiveMarker();
  const message = { type: STUDIO_AUTH_MESSAGE, href: cb, ts: Date.now() };
  let delivered = false;
  try {
    if (typeof BroadcastChannel === 'function') {
      const ch = new BroadcastChannel(STUDIO_AUTH_CHANNEL);
      ch.postMessage(message);
      ch.close();
      delivered = true;
    }
  } catch {
    /* ignore */
  }
  try {
    if (window.localStorage) {
      window.localStorage.setItem(STUDIO_AUTH_RELAY_KEY, JSON.stringify(message));
      delivered = true;
    }
  } catch {
    /* ignore */
  }
  try {
    if (opener && !opener.closed) {
      opener.postMessage(message, window.location.origin);
      delivered = true;
    }
  } catch {
    /* ignore */
  }
  return delivered;
}

/** Listens (in the main Studio window) for callbacks relayed by the sign-in popup. */
export function subscribePopupCallback(cb: (href: string) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  let last = '';
  const handle = (data: unknown) => {
    if (!data || typeof data !== 'object') return;
    const d = data as { type?: unknown; href?: unknown };
    if (d.type !== STUDIO_AUTH_MESSAGE || typeof d.href !== 'string' || d.href === last) return;
    last = d.href;
    cb(d.href);
  };
  const onMessage = (e: MessageEvent) => {
    if (e.origin === window.location.origin) handle(e.data);
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STUDIO_AUTH_RELAY_KEY || !e.newValue) return;
    try {
      handle(JSON.parse(e.newValue));
      window.localStorage?.removeItem(STUDIO_AUTH_RELAY_KEY);
    } catch {
      /* ignore */
    }
  };
  window.addEventListener('message', onMessage);
  window.addEventListener('storage', onStorage);
  let ch: BroadcastChannel | null = null;
  try {
    if (typeof BroadcastChannel === 'function') {
      ch = new BroadcastChannel(STUDIO_AUTH_CHANNEL);
      ch.onmessage = (e) => handle(e.data);
    }
  } catch {
    ch = null;
  }
  return () => {
    window.removeEventListener('message', onMessage);
    window.removeEventListener('storage', onStorage);
    ch?.close();
  };
}
