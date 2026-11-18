import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAssistantTurn, type AiConfig } from '../lib/aiProviders';
import type { GeminiWorkspaceContext } from '../lib/geminiAgent';
import {
  STUDIO_ASSISTANT_ENDPOINT,
  STUDIO_AUTH_EXPIRES_KEY,
  STUDIO_AUTH_REFRESH_KEY,
  STUDIO_AUTH_SESSION_KEY,
  STUDIO_TOKEN_ENDPOINT,
  beginStudioAuth,
  clearStudioSession,
  completeStudioAuth,
  createMemoryStorage,
  defaultStudioTokenExchange,
  loadStudioAccessExpiry,
  loadStudioAccessToken,
  loadStudioRefreshToken,
  saveStudioTokenSet,
} from '../lib/studioAuth';
import {
  STUDIO_REVOKE_ENDPOINT,
  getFreshStudioAccessToken,
  refreshStudioAccessToken,
  signOutStudio,
  withStudioTokenRetry,
} from '../lib/studioTokens';

const ACCESS_1 = `slx_at_${'1'.repeat(64)}`;
const ACCESS_2 = `slx_at_${'2'.repeat(64)}`;
const REFRESH_1 = `slx_rt_${'a'.repeat(64)}`;
const REFRESH_2 = `slx_rt_${'b'.repeat(64)}`;
const T0 = new Date('2026-11-18T12:00:00.000Z');
const at = (minutes: number) => () => new Date(T0.getTime() + minutes * 60_000);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function signedIn(expiresInSeconds = 3600) {
  const store = createMemoryStorage();
  saveStudioTokenSet({ accessToken: ACCESS_1, refreshToken: REFRESH_1, expiresIn: expiresInSeconds }, store, () => T0);
  return store;
}

function refreshResponse() {
  return json({ ok: true, access_token: ACCESS_2, refresh_token: REFRESH_2, expires_in: 3600, token_type: 'Bearer' });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('token storage', () => {
  it('stores refresh token and expiry from sign-in outside the session record, and clears them on sign-out', async () => {
    const storage = createMemoryStorage();
    const sessionStore = createMemoryStorage();
    const { pending } = await beginStudioAuth('signin', { webOrigin: 'http://localhost:5180', storage, now: () => T0 });
    await completeStudioAuth(`synlexa-studio://auth/callback?code=slx_ac_code&state=${pending.state}`, {
      storage,
      sessionStore,
      now: () => T0,
      exchange: async () => ({ accessToken: ACCESS_1, refreshToken: REFRESH_1, expiresIn: 3600, email: 'r@example.org' }),
    });

    expect(loadStudioAccessToken(sessionStore)).toBe(ACCESS_1);
    expect(loadStudioRefreshToken(sessionStore)).toBe(REFRESH_1);
    expect(loadStudioAccessExpiry(sessionStore)).toBe(T0.getTime() + 3_600_000);
    const record = sessionStore.getItem(STUDIO_AUTH_SESSION_KEY) ?? '';
    expect(record).not.toContain(REFRESH_1);
    expect(record).not.toContain(ACCESS_1);

    clearStudioSession(sessionStore);
    expect(sessionStore.getItem(STUDIO_AUTH_REFRESH_KEY)).toBeNull();
    expect(sessionStore.getItem(STUDIO_AUTH_EXPIRES_KEY)).toBeNull();
    expect(loadStudioAccessToken(sessionStore)).toBeNull();
  });

  it('reads refresh_token and expires_in from the token endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ access_token: ACCESS_1, refresh_token: REFRESH_1, expires_in: 3600, email: 'r@example.org' })),
    );
    const result = await defaultStudioTokenExchange({
      code: 'slx_ac_code',
      codeVerifier: 'v'.repeat(43),
      redirectUri: 'synlexa-studio://auth/callback',
      clientId: 'synlexa-studio',
    });
    expect(result).toMatchObject({ accessToken: ACCESS_1, refreshToken: REFRESH_1, expiresIn: 3600 });
  });
});

describe('refresh', () => {
  it('uses the stored token while it has more than a minute left', async () => {
    const store = signedIn();
    const fetchImpl = vi.fn();
    expect(await getFreshStudioAccessToken({ store, fetchImpl, now: at(58) })).toBe(ACCESS_1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refreshes near expiry with the refresh token and stores the rotated pair', async () => {
    const store = signedIn();
    const fetchImpl = vi.fn(async () => refreshResponse());
    expect(await getFreshStudioAccessToken({ store, fetchImpl, now: at(59.5) })).toBe(ACCESS_2);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(STUDIO_TOKEN_ENDPOINT);
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      grant_type: 'refresh_token',
      refresh_token: REFRESH_1,
      client_id: 'synlexa-studio',
    });
    expect(loadStudioRefreshToken(store)).toBe(REFRESH_2);
    expect(loadStudioAccessExpiry(store)).toBe(at(59.5)().getTime() + 3_600_000);
  });

  it('clears tokens when the server rejects the refresh token, and keeps them when offline', async () => {
    const rejected = signedIn();
    const reject = vi.fn(async () => json({ ok: false, error: 'invalid_grant' }, 400));
    expect(await refreshStudioAccessToken({ store: rejected, fetchImpl: reject, now: at(61) })).toBeNull();
    expect(loadStudioAccessToken(rejected)).toBeNull();
    expect(loadStudioRefreshToken(rejected)).toBeNull();

    const offline = signedIn();
    const fail = vi.fn(async () => {
      throw new TypeError('network down');
    });
    expect(await refreshStudioAccessToken({ store: offline, fetchImpl: fail as unknown as typeof fetch, now: at(61) })).toBeNull();
    expect(loadStudioRefreshToken(offline)).toBe(REFRESH_1);
  });

  it('sends one refresh when several calls need it at once', async () => {
    const store = signedIn();
    let release: (r: Response) => void = () => {};
    const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => (release = resolve)));
    const calls = [1, 2, 3].map(() => getFreshStudioAccessToken({ store, fetchImpl, now: at(61) }));
    await Promise.resolve();
    release(refreshResponse());
    expect(await Promise.all(calls)).toEqual([ACCESS_2, ACCESS_2, ACCESS_2]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('takes the cross-tab lock and reuses a token another tab already refreshed', async () => {
    const lockNames: string[] = [];
    vi.stubGlobal('navigator', {
      locks: {
        request: async <T>(name: string, cb: () => Promise<T>) => {
          lockNames.push(name);
          return cb();
        },
      },
    });
    const store = signedIn();
    // Another tab refreshed while this one waited for the lock.
    saveStudioTokenSet({ accessToken: ACCESS_2, refreshToken: REFRESH_2, expiresIn: 3600 }, store, at(60));
    const fetchImpl = vi.fn();
    expect(await refreshStudioAccessToken({ store, fetchImpl, now: at(61), staleAccessToken: ACCESS_1 })).toBe(ACCESS_2);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(lockNames).toEqual(['synlexa-studio-token-refresh']);
  });
});

describe('retry on 401 and sign-out', () => {
  it('refreshes once and repeats a request the server rejected with 401', async () => {
    const store = signedIn();
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === STUDIO_TOKEN_ENDPOINT) return refreshResponse();
      const auth = new Headers(init?.headers).get('Authorization');
      return auth === `Bearer ${ACCESS_2}` ? json({ ok: true }) : json({ error: 'expired' }, 401);
    });
    const wrapped = withStudioTokenRetry(fetchImpl as unknown as typeof fetch, { store, now: at(10) });
    const res = await wrapped(STUDIO_ASSISTANT_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ACCESS_1}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(200);
    expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual([STUDIO_ASSISTANT_ENDPOINT, STUDIO_TOKEN_ENDPOINT, STUDIO_ASSISTANT_ENDPOINT]);
  });

  it('returns the 401 unchanged when there is nothing to refresh with', async () => {
    const store = createMemoryStorage();
    const fetchImpl = vi.fn(async () => json({ error: 'signed out' }, 401));
    const res = await withStudioTokenRetry(fetchImpl as unknown as typeof fetch, { store })(STUDIO_ASSISTANT_ENDPOINT, {
      headers: { Authorization: `Bearer ${ACCESS_1}` },
    });
    expect(res.status).toBe(401);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('revokes the sign-in on synlexa.com and clears local state, even when offline', async () => {
    const store = signedIn();
    const fetchImpl = vi.fn(async () => json({}));
    await signOutStudio({ store, fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(STUDIO_REVOKE_ENDPOINT);
    expect(url).toBe('https://synlexa.com/api/studio/revoke');
    expect(new URLSearchParams(String(init.body)).get('token')).toBe(REFRESH_1);
    expect(loadStudioAccessToken(store)).toBeNull();

    const offlineStore = signedIn();
    await signOutStudio({
      store: offlineStore,
      fetchImpl: vi.fn(async () => {
        throw new TypeError('offline');
      }) as unknown as typeof fetch,
    });
    expect(loadStudioRefreshToken(offlineStore)).toBeNull();
  });
});

describe('Synlexa Cloud assistant with an expired access token', () => {
  it('refreshes before calling the assistant', async () => {
    // runAssistantTurn reads the default store, which is in-memory under Node.
    saveStudioTokenSet({ accessToken: ACCESS_1, refreshToken: REFRESH_1, expiresIn: 1 }, undefined, () => new Date(Date.now() - 10_000));
    const fetchImpl = vi.fn(async (url: string) =>
      url === STUDIO_TOKEN_ENDPOINT
        ? refreshResponse()
        : json({
            candidates: [{ content: { role: 'model', parts: [{ text: 'Reference structure is loaded.' }] } }],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
          }),
    );
    const config: AiConfig = {
      provider: 'synlexa',
      synlexa: { apiKey: ACCESS_1, model: 'gemini-3.1-flash-lite' },
      anthropic: { apiKey: '', model: 'claude-opus-5-5' },
      gemini: { apiKey: '', model: 'gemini-3.1-flash-lite' },
    };
    const reply = await runAssistantTurn({
      prompt: 'What is loaded?',
      history: [],
      workspace: { refLabel: '3HS4.cif' } as unknown as GeminiWorkspaceContext,
      executeTool: vi.fn(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      config,
    });

    expect(fetchImpl.mock.calls[0][0]).toBe(STUDIO_TOKEN_ENDPOINT);
    const [url, init] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe(STUDIO_ASSISTANT_ENDPOINT);
    expect(new Headers(init.headers).get('Authorization')).toBe(`Bearer ${ACCESS_2}`);
    expect(reply.mode).toBe('synlexa-cloud');
    clearStudioSession();
  });
});
