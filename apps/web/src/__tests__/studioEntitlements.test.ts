import { describe, expect, it, vi } from 'vitest';
import { createMemoryStorage, saveStudioTokenSet, STUDIO_TOKEN_ENDPOINT } from '../lib/studioAuth';
import {
  STUDIO_ENTITLEMENTS_ENDPOINT,
  fetchStudioEntitlements,
  parseStudioEntitlements,
  planDisplayName,
  usagePercent,
} from '../lib/studioEntitlements';

const ACCESS_1 = `slx_at_${'1'.repeat(64)}`;
const ACCESS_2 = `slx_at_${'2'.repeat(64)}`;
const REFRESH = `slx_rt_${'a'.repeat(64)}`;

const entitlements = {
  plan: 'pro',
  productLine: 'individual',
  features: ['cloud_assistant', 'report_export'],
  allowedModels: ['gemini-3.1-flash-lite', 'gemini-3.1-pro-preview'],
  metered: false,
  usage: [
    { kind: 'five_hour', limit: 1500, used: 375, remaining: 1125, resetsAt: '2027-01-01T05:00:00.000Z' },
    { kind: 'daily', limit: null, used: 375, remaining: null, resetsAt: '2027-01-02T00:00:00.000Z' },
    { kind: 'weekly', limit: 6000, used: 375, remaining: 5625, resetsAt: '2027-01-08T00:00:00.000Z' },
  ],
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('Studio entitlements', () => {
  it('parses the server payload and rejects malformed ones', () => {
    const parsed = parseStudioEntitlements(entitlements);
    expect(parsed?.plan).toBe('pro');
    expect(planDisplayName(parsed!.plan)).toBe('Pro');
    expect(usagePercent(parsed!.usage[0])).toBe(25);
    expect(usagePercent(parsed!.usage[1])).toBeNull();

    expect(parseStudioEntitlements({ ...entitlements, plan: 'max' })).toBeNull();
    expect(parseStudioEntitlements({ ...entitlements, usage: [{ kind: 'hourly', used: 1 }] })).toBeNull();
    expect(parseStudioEntitlements(null)).toBeNull();
  });

  it('fetches with the access token, refreshing after a 401', async () => {
    const store = createMemoryStorage();
    saveStudioTokenSet({ accessToken: ACCESS_1, refreshToken: REFRESH, expiresIn: 3600 }, store);
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === STUDIO_TOKEN_ENDPOINT) return json({ access_token: ACCESS_2, refresh_token: REFRESH + 'b', expires_in: 3600 });
      const auth = new Headers(init?.headers).get('Authorization');
      return auth === `Bearer ${ACCESS_2}` ? json({ ok: true, entitlements }) : json({ ok: false }, 401);
    });
    const result = await fetchStudioEntitlements({ fetchImpl: fetchImpl as unknown as typeof fetch, store });
    expect(result?.allowedModels).toEqual(['gemini-3.1-flash-lite', 'gemini-3.1-pro-preview']);
    expect(fetchImpl.mock.calls[0][0]).toBe(STUDIO_ENTITLEMENTS_ENDPOINT);
    expect(STUDIO_ENTITLEMENTS_ENDPOINT).toBe('https://synlexa.com/api/studio/entitlements');
  });

  it('returns null when signed out, offline, or the server refuses', async () => {
    const fetchImpl = vi.fn();
    expect(await fetchStudioEntitlements({ fetchImpl, store: createMemoryStorage() })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();

    const store = createMemoryStorage();
    saveStudioTokenSet({ accessToken: ACCESS_1, refreshToken: null, expiresIn: 3600 }, store);
    const offline = vi.fn(async () => {
      throw new TypeError('offline');
    });
    expect(await fetchStudioEntitlements({ fetchImpl: offline as unknown as typeof fetch, store })).toBeNull();
    const refused = vi.fn(async () => json({ ok: false }, 502));
    expect(await fetchStudioEntitlements({ fetchImpl: refused as unknown as typeof fetch, store })).toBeNull();
  });
});
