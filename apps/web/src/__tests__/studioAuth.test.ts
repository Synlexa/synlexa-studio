import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SettingsDialog } from '../components/SettingsView';
import { FeedbackProvider } from '../components/ui';
import {
  STUDIO_AUTH_BASE,
  STUDIO_AUTH_PENDING_KEY,
  STUDIO_AUTH_PENDING_TTL_MS,
  STUDIO_AUTH_SESSION_KEY,
  STUDIO_CLIENT_ID,
  STUDIO_DEEP_LINK_REDIRECT,
  STUDIO_TOKEN_ENDPOINT,
  StudioAuthError,
  base64UrlEncode,
  beginStudioAuth,
  buildStudioConnectUrl,
  clearStudioSession,
  completeStudioAuth,
  computeCodeChallengeS256,
  consumeWebCallbackFromLocation,
  createMemoryStorage,
  generateCodeVerifier,
  generateState,
  loadPendingStudioAuth,
  loadStudioSession,
  parseStudioAuthCallback,
  subscribeDesktopDeepLink,
} from '../lib/studioAuth';

describe('Synlexa Studio Auth (OAuth 2.0 + PKCE S256)', () => {
  it('matches the RFC 7636 Appendix B S256 test vector', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const expectedChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    expect(await computeCodeChallengeS256(verifier)).toBe(expectedChallenge);
  });

  it('encodes base64url without padding and generates valid RFC 7636 verifiers & state', () => {
    expect(base64UrlEncode(new Uint8Array([]))).toBe('');
    expect(base64UrlEncode(new Uint8Array([0xfb, 0xff]))).toBe('-_8');

    const unreserved = /^[A-Za-z0-9\-._~]+$/;
    const vDefault = generateCodeVerifier();
    expect(vDefault).toHaveLength(64);
    expect(vDefault).toMatch(unreserved);

    const vMin = generateCodeVerifier(43);
    expect(vMin).toHaveLength(43);
    expect(vMin).toMatch(unreserved);

    const vMax = generateCodeVerifier(128);
    expect(vMax).toHaveLength(128);
    expect(vMax).toMatch(unreserved);

    expect(() => generateCodeVerifier(42)).toThrow(RangeError);
    expect(() => generateCodeVerifier(129)).toThrow(RangeError);

    const s1 = generateState();
    const s2 = generateState();
    expect(s1.length).toBeGreaterThanOrEqual(32);
    expect(s1).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(s1).not.toBe(s2);
  });

  it('builds signin and signup connect URLs with all required parameters', async () => {
    expect(STUDIO_AUTH_BASE).toBe('https://synlexa.com/auth/studio-connect');
    expect(STUDIO_DEEP_LINK_REDIRECT).toBe('synlexa-studio://auth/callback');
    expect(STUDIO_CLIENT_ID).toBe('synlexa-studio');
    expect(STUDIO_TOKEN_ENDPOINT).toBe('https://synlexa.com/api/studio/token');

    for (const mode of ['signin', 'signup'] as const) {
      const storage = createMemoryStorage();
      const { url, pending } = await beginStudioAuth(mode, {
        webOrigin: 'http://localhost:5173/',
        storage,
      });

      const parsed = new URL(url);
      expect(`${parsed.origin}${parsed.pathname}`).toBe(STUDIO_AUTH_BASE);
      expect(parsed.searchParams.get('mode')).toBe(mode);
      expect(parsed.searchParams.get('client')).toBe('synlexa-studio');
      expect(parsed.searchParams.get('redirect_uri')).toBe('synlexa-studio://auth/callback');
      expect(parsed.searchParams.get('web_redirect_uri')).toBe(
        'http://localhost:5173/?studio_auth=callback',
      );
      expect(parsed.searchParams.get('code_challenge')).toBe(pending.codeChallenge);
      expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
      expect(parsed.searchParams.get('state')).toBe(pending.state);

      expect(loadPendingStudioAuth(storage)).toEqual(pending);
    }

    const built = buildStudioConnectUrl({
      mode: 'signup',
      state: 'st_123',
      codeChallenge: 'cc_456',
      webOrigin: 'https://studio.synlexa.com',
    });
    expect(built).toContain('mode=signup');
    expect(built).toContain('redirect_uri=synlexa-studio%3A%2F%2Fauth%2Fcallback');
  });

  it('parses deep-link and web callbacks and rejects invalid schemes/paths', () => {
    const deep = parseStudioAuthCallback(
      'synlexa-studio://auth/callback?code=auth_code_1&state=state_1&email=researcher%40synlexa.com',
    );
    expect(deep).toEqual({
      ok: true,
      code: 'auth_code_1',
      state: 'state_1',
      source: 'deep-link',
      email: 'researcher@synlexa.com',
    });

    const web = parseStudioAuthCallback(
      'http://127.0.0.1:4179/?studio_auth=callback&code=web_code&state=web_state',
    );
    expect(web).toEqual({
      ok: true,
      code: 'web_code',
      state: 'web_state',
      source: 'web',
    });

    expect(
      consumeWebCallbackFromLocation(
        'http://127.0.0.1:4179/?studio_auth=callback&code=web_code&state=web_state',
      ),
    ).toBe('http://127.0.0.1:4179/?studio_auth=callback&code=web_code&state=web_state');
    expect(consumeWebCallbackFromLocation('http://127.0.0.1:4179/?tab=peptide')).toBeNull();

    const providerErr = parseStudioAuthCallback(
      'synlexa-studio://auth/callback?error=access_denied&error_description=Cancelled',
    );
    expect(providerErr).toMatchObject({
      ok: false,
      reason: 'PROVIDER_ERROR',
      error: 'access_denied',
      errorDescription: 'Cancelled',
    });

    for (const bad of [
      '',
      'javascript:alert(1)',
      'myapp://auth/callback?code=1&state=2',
      'synlexa-studio://other/callback?code=1&state=2',
      'synlexa-studio://auth/callback/extra?code=1&state=2',
      'https://localhost:5173/?code=1&state=2',
      'synlexa-studio://auth/callback?code=1',
      'synlexa-studio://auth/callback?state=2',
    ]) {
      const res = parseStudioAuthCallback(bad);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toBe('INVALID_CALLBACK');
    }
  });

  it('rejects missing pending state, state mismatch, expiry, and PKCE tampering', async () => {
    const emptyStorage = createMemoryStorage();
    await expect(
      completeStudioAuth('synlexa-studio://auth/callback?code=c&state=s', {
        storage: emptyStorage,
        sessionStore: emptyStorage,
      }),
    ).rejects.toMatchObject({ name: 'StudioAuthError', code: 'NO_PENDING' });

    // State mismatch
    const s1 = createMemoryStorage();
    await beginStudioAuth('signin', { webOrigin: 'http://localhost:5173', storage: s1 });
    await expect(
      completeStudioAuth('synlexa-studio://auth/callback?code=c&state=wrong-state', {
        storage: s1,
        sessionStore: s1,
      }),
    ).rejects.toMatchObject({ code: 'STATE_MISMATCH' });

    // Expiry (> 10 minutes)
    const s2 = createMemoryStorage();
    const t0 = new Date('2026-11-15T12:00:00.000Z');
    const { pending: p2 } = await beginStudioAuth('signin', {
      webOrigin: 'http://localhost:5173',
      storage: s2,
      now: () => t0,
    });
    const expiredNow = new Date(t0.getTime() + STUDIO_AUTH_PENDING_TTL_MS + 1000);
    await expect(
      completeStudioAuth(`synlexa-studio://auth/callback?code=c&state=${p2.state}`, {
        storage: s2,
        sessionStore: s2,
        now: () => expiredNow,
      }),
    ).rejects.toMatchObject({ code: 'EXPIRED' });
    expect(s2.getItem(STUDIO_AUTH_PENDING_KEY)).toBeNull();

    // PKCE challenge tamper in storage
    const s3 = createMemoryStorage();
    const { pending: p3 } = await beginStudioAuth('signup', {
      webOrigin: 'http://localhost:5173',
      storage: s3,
    });
    s3.setItem(
      STUDIO_AUTH_PENDING_KEY,
      JSON.stringify({ ...p3, codeChallenge: 'tampered_challenge_value_00000000000000000' }),
    );
    await expect(
      completeStudioAuth(`synlexa-studio://auth/callback?code=c&state=${p3.state}`, {
        storage: s3,
        sessionStore: s3,
      }),
    ).rejects.toMatchObject({ code: 'PKCE_MISMATCH' });
    expect(s3.getItem(STUDIO_AUTH_PENDING_KEY)).toBeNull();
  });

  it('completes with serverVerified=true when mocked exchange succeeds and clears sensitive pending fields', async () => {
    const storage = createMemoryStorage();
    const sessionStore = createMemoryStorage();
    const t0 = new Date('2026-11-15T12:30:00.000Z');

    const { pending } = await beginStudioAuth('signin', {
      webOrigin: 'http://localhost:5173',
      storage,
      now: () => t0,
    });

    let seenReq: unknown = null;
    const session = await completeStudioAuth(
      `synlexa-studio://auth/callback?code=secret_auth_code_99&state=${pending.state}`,
      {
        storage,
        sessionStore,
        now: () => t0,
        exchange: async (req) => {
          seenReq = req;
          return {
            accessToken: 'tok_ephemeral',
            email: 'scientist@synlexa.com',
            displayName: 'Dr. Researcher',
          };
        },
      },
    );

    expect(seenReq).toEqual({
      code: 'secret_auth_code_99',
      codeVerifier: pending.codeVerifier,
      redirectUri: STUDIO_DEEP_LINK_REDIRECT,
      clientId: STUDIO_CLIENT_ID,
    });
    expect(session).toEqual({
      mode: 'signin',
      email: 'scientist@synlexa.com',
      displayName: 'Dr. Researcher',
      serverVerified: true,
      verification: 'server-token-exchange',
      establishedAtUtc: '2026-11-15T12:30:00.000Z',
      callbackSource: 'deep-link',
    });

    // Pending cleared; persisted session never contains verifier, raw code, or access token.
    expect(storage.getItem(STUDIO_AUTH_PENDING_KEY)).toBeNull();
    const rawSaved = sessionStore.getItem(STUDIO_AUTH_SESSION_KEY) ?? '';
    expect(rawSaved).not.toContain(pending.codeVerifier);
    expect(rawSaved).not.toContain('secret_auth_code_99');
    expect(rawSaved).not.toContain('tok_ephemeral');
    expect(loadStudioSession(sessionStore)).toEqual(session);

    clearStudioSession(sessionStore);
    expect(loadStudioSession(sessionStore)).toBeNull();
  });

  it('falls back honestly to local-pkce-only when token exchange fails', async () => {
    const storage = createMemoryStorage();
    const sessionStore = createMemoryStorage();
    const { pending } = await beginStudioAuth('signup', {
      webOrigin: 'https://studio.synlexa.com',
      storage,
    });

    const session = await completeStudioAuth(
      `https://studio.synlexa.com/?studio_auth=callback&code=code_local&state=${pending.state}&email=beta%40synlexa.com`,
      {
        storage,
        sessionStore,
        exchange: async () => {
          throw new Error('503 token endpoint offline');
        },
      },
    );

    expect(session.mode).toBe('signup');
    expect(session.email).toBe('beta@synlexa.com');
    expect(session.serverVerified).toBe(false);
    expect(session.verification).toBe('local-pkce-only');
    expect(session.callbackSource).toBe('web');
    expect(storage.getItem(STUDIO_AUTH_PENDING_KEY)).toBeNull();
    expect(loadStudioSession(sessionStore)).toEqual(session);
  });

  it('passes the platform hint to synlexa.com', async () => {
    const { url } = await beginStudioAuth('signin', {
      webOrigin: 'http://localhost:5180',
      storage: createMemoryStorage(),
      platform: 'web',
    });
    expect(new URL(url).searchParams.get('platform')).toBe('web');
  });

  it('handles subscribeDesktopDeepLink cleanly outside Tauri and renders the Settings account views', () => {
    const noopUnsub = subscribeDesktopDeepLink(() => {});
    expect(() => noopUnsub()).not.toThrow();

    const baseProps = {
      open: true,
      onClose: () => {},
      section: 'account' as const,
      onSectionChange: () => {},
      aiConfig: {
        provider: 'synlexa' as const,
        synlexa: { apiKey: '', model: 'gemini-3.1-flash-lite' },
        anthropic: { apiKey: '', model: 'claude-opus-5-5' },
        gemini: { apiKey: '', model: 'gemini-3.1-flash-lite' },
      },
      onUpdateAiConfig: () => {},
      onSessionChange: () => {},
      onSignIn: () => {},
      onCancelSignIn: () => {},
      onResetLayout: () => {},
      onClearedHistory: () => {},
    };
    const render = (extra: Record<string, unknown>) =>
      renderToStaticMarkup(
        createElement(FeedbackProvider, null, createElement(SettingsDialog, { ...baseProps, session: null, signInPending: false, ...extra })),
      );

    const signedOutHtml = render({});
    expect(signedOutHtml).toContain('role="dialog"');
    expect(signedOutHtml).toContain('Not signed in');
    expect(signedOutHtml).toContain('Create account');
    expect(signedOutHtml).not.toContain('Paste');

    expect(render({ signInPending: true })).toContain('Waiting for synlexa.com');

    const localOnlyHtml = render({
      session: {
        mode: 'signin',
        email: 'bench@synlexa.com',
        displayName: null,
        serverVerified: false,
        verification: 'local-pkce-only',
        establishedAtUtc: '2026-11-15T12:00:00.000Z',
        callbackSource: 'deep-link',
      },
    });
    expect(localOnlyHtml).toContain('bench@synlexa.com');
    expect(localOnlyHtml).toContain('Not confirmed by synlexa.com');
    expect(localOnlyHtml).toContain('Reconnect');
    expect(localOnlyHtml).toContain('Sign out');

    // Keep StudioAuthError class coverage clean
    const err = new StudioAuthError('INVALID_CALLBACK', 'bad');
    expect(err instanceof Error).toBe(true);
  });
});
