/**
 * Keeps the Synlexa Cloud access token fresh (Research-Use-Only).
 *
 * synlexa.com issues a short-lived access token (1 hour) and a rotating refresh
 * token (30 days). The server treats a refresh token presented twice as stolen
 * and ends the sign-in, so refreshes must never race: they run one at a time
 * across every Studio tab (Web Locks API, with an in-tab fallback), and each
 * refresh re-reads storage first in case another tab already refreshed.
 *
 * Tokens are never logged. This module is pure and injectable for tests.
 */
import {
  STUDIO_CLIENT_ID,
  STUDIO_TOKEN_ENDPOINT,
  clearStudioSession,
  clearStudioTokens,
  loadStudioAccessExpiry,
  loadStudioAccessToken,
  loadStudioRefreshToken,
  saveStudioTokenSet,
  type StorageLike,
} from './studioAuth';

export const STUDIO_REVOKE_ENDPOINT = STUDIO_TOKEN_ENDPOINT.replace(/\/token$/u, '/revoke');
/** Refresh this long before the access token expires. */
export const STUDIO_REFRESH_SKEW_MS = 60_000;
const REFRESH_LOCK_NAME = 'synlexa-studio-token-refresh';
const REQUEST_TIMEOUT_MS = 15_000;

export interface StudioTokenOptions {
  store?: StorageLike;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

interface LockManagerLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

function lockManager(): LockManagerLike | null {
  const locks = (globalThis as { navigator?: { locks?: LockManagerLike } }).navigator?.locks;
  return locks && typeof locks.request === 'function' ? locks : null;
}

let inTabRefresh: Promise<string | null> | null = null;

/** Runs `task` while holding the cross-tab refresh lock; one in-flight task per tab. */
function withRefreshLock(task: () => Promise<string | null>): Promise<string | null> {
  if (inTabRefresh) return inTabRefresh;
  const locks = lockManager();
  const run = locks ? locks.request(REFRESH_LOCK_NAME, task) : task();
  inTabRefresh = run.finally(() => {
    inTabRefresh = null;
  });
  return inTabRefresh;
}

function resolveFetch(fetchImpl?: typeof fetch): typeof fetch | null {
  const f = fetchImpl ?? (globalThis as { fetch?: typeof fetch }).fetch;
  return typeof f === 'function' ? f : null;
}

async function postForm(f: typeof fetch, url: string, params: Record<string, string>) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
  try {
    return await f(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(params).toString(),
      signal: controller?.signal,
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Exchanges the refresh token for a new token pair. Returns the new access
 * token, the token another tab already refreshed to, or null when the user must
 * sign in again (tokens are then cleared) or the server is unreachable (tokens
 * are kept for a later try).
 *
 * `staleAccessToken` is the token known to be expired or rejected; if storage
 * already holds a different, unexpired token, that one is returned unchanged.
 */
export function refreshStudioAccessToken(
  opts: StudioTokenOptions & { staleAccessToken?: string | null } = {},
): Promise<string | null> {
  const now = opts.now ?? (() => new Date());
  return withRefreshLock(async () => {
    const current = loadStudioAccessToken(opts.store);
    const expiry = loadStudioAccessExpiry(opts.store);
    if (current && current !== opts.staleAccessToken && expiry && expiry - now().getTime() > STUDIO_REFRESH_SKEW_MS) {
      return current;
    }
    const refreshToken = loadStudioRefreshToken(opts.store);
    const f = resolveFetch(opts.fetchImpl);
    if (!refreshToken || !f) return null;

    let res: Response;
    try {
      res = await postForm(f, STUDIO_TOKEN_ENDPOINT, {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: STUDIO_CLIENT_ID,
      });
    } catch {
      return null; // offline or timed out: keep tokens, try again later
    }
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (res.ok && body && typeof body.access_token === 'string') {
      saveStudioTokenSet(
        {
          accessToken: body.access_token,
          refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null,
          expiresIn: typeof body.expires_in === 'number' ? body.expires_in : null,
        },
        opts.store,
        now,
      );
      return loadStudioAccessToken(opts.store);
    }
    if (res.status === 400 || res.status === 401) {
      // Refresh token expired, revoked or reused: the user must sign in again.
      clearStudioTokens(opts.store);
    }
    return null;
  });
}

/**
 * The access token to send now: the stored one while it has more than a minute
 * left, otherwise a refreshed one. Null when signed out or a refresh failed.
 * Tokens stored without an expiry are returned as they are.
 */
export async function getFreshStudioAccessToken(opts: StudioTokenOptions = {}): Promise<string | null> {
  const now = opts.now ?? (() => new Date());
  const current = loadStudioAccessToken(opts.store);
  const expiry = loadStudioAccessExpiry(opts.store);
  if (!current) return null;
  if (expiry === null || expiry - now().getTime() > STUDIO_REFRESH_SKEW_MS) return current;
  return refreshStudioAccessToken({ ...opts, staleAccessToken: current });
}

function bearerFrom(init: RequestInit | undefined): string | null {
  const headers = new Headers(init?.headers);
  const value = headers.get('Authorization');
  return value?.startsWith('Bearer ') ? value.slice('Bearer '.length) : null;
}

/**
 * Wraps fetch for Synlexa Cloud calls: on a 401 it refreshes the access token
 * once and repeats the request with the new token. Request bodies must be
 * strings (as Studio's JSON requests are) so they can be sent twice.
 */
export function withStudioTokenRetry(fetchImpl: typeof fetch, opts: Omit<StudioTokenOptions, 'fetchImpl'> = {}): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await fetchImpl(input, init);
    if (res.status !== 401) return res;
    const sent = bearerFrom(init);
    const fresh = await refreshStudioAccessToken({ ...opts, fetchImpl, staleAccessToken: sent });
    if (!fresh || fresh === sent) return res;
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${fresh}`);
    return fetchImpl(input, { ...init, headers });
  }) as typeof fetch;
}

/** Signs out: revokes the sign-in on synlexa.com (best effort), then clears local state. */
export async function signOutStudio(opts: StudioTokenOptions = {}): Promise<void> {
  const token = loadStudioRefreshToken(opts.store) ?? loadStudioAccessToken(opts.store);
  const f = resolveFetch(opts.fetchImpl);
  if (token && f) {
    try {
      await postForm(f, STUDIO_REVOKE_ENDPOINT, { token });
    } catch {
      /* offline: the token still expires on its own */
    }
  }
  clearStudioSession(opts.store);
}
