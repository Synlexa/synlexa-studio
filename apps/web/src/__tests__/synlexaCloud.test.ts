import { describe, expect, it, vi } from 'vitest';
import { runAssistantTurn, type AiConfig } from '../lib/aiProviders';
import type { GeminiWorkspaceContext } from '../lib/geminiAgent';
import {
  beginStudioAuth,
  clearStudioSession,
  completeStudioAuth,
  createMemoryStorage,
  loadStudioAccessToken,
  STUDIO_ASSISTANT_ENDPOINT,
  STUDIO_AUTH_SESSION_KEY,
  STUDIO_AUTH_TOKEN_KEY,
} from '../lib/studioAuth';

const workspace: GeminiWorkspaceContext = {
  refLabel: '3HS4.cif',
  mobLabel: null,
  refChain: 'A',
  mobChain: null,
  refInspect: null,
  mobInspect: null,
  comparison: null,
  peptide: null,
  crispr: null,
  smiles: null,
  ramachandran: null,
} as unknown as GeminiWorkspaceContext;

const TOKEN = '0b6f1f0e-8d2a-4c55-9b1e-1f2a3b4c5d6e';

const config: AiConfig = {
  provider: 'synlexa',
  synlexa: { apiKey: TOKEN, model: 'gemini-4-argon' },
  anthropic: { apiKey: '', model: 'claude-opus-5-5' },
  gemini: { apiKey: '', model: 'gemini-3.1-flash-lite' },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('Synlexa Cloud assistant (mocked network)', () => {
  it('sends Gemini requests to the synlexa.com proxy with a bearer token and no Google key', async () => {
    const fetchImpl = vi.fn(async () =>
      json({
        candidates: [{ content: { role: 'model', parts: [{ text: 'Reference structure 3HS4 chain A is loaded.' }] } }],
        usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30 },
      }),
    );
    const reply = await runAssistantTurn({
      prompt: 'What is loaded?',
      history: [],
      workspace,
      executeTool: vi.fn(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      config,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(STUDIO_ASSISTANT_ENDPOINT);
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers['x-goog-api-key']).toBeUndefined();
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.model).toBe('gemini-4-argon');
    expect(Array.isArray(body.contents)).toBe(true);
    expect(reply.mode).toBe('synlexa-cloud');
    expect(reply.usage).toEqual({ inputTokens: 120, outputTokens: 30 });
    expect(reply.text).toMatch(/RESEARCH USE ONLY/i);
  });

  it('falls back to the built-in assistant with the server message when the account is rejected', async () => {
    const fetchImpl = vi.fn(async () =>
      json({ error: { code: 401, message: 'Sign in to synlexa.com to use Synlexa Cloud.' } }, 401),
    );
    const reply = await runAssistantTurn({
      prompt: 'focus 94',
      history: [],
      workspace,
      executeTool: vi.fn(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      config,
    });
    expect(reply.mode).toBe('local-deterministic-fallback');
    expect(reply.error).toBe('Sign in to synlexa.com to use Synlexa Cloud.');
  });
});

describe('Studio access token storage', () => {
  it('keeps the token out of the session record and clears it on sign-out', async () => {
    const storage = createMemoryStorage();
    const sessionStore = createMemoryStorage();
    const t0 = new Date('2026-11-15T12:00:00.000Z');
    const { pending } = await beginStudioAuth('signin', { webOrigin: 'http://localhost:5180', storage, now: () => t0 });

    await completeStudioAuth(`synlexa-studio://auth/callback?code=sealed_code_value&state=${pending.state}`, {
      storage,
      sessionStore,
      now: () => t0,
      exchange: async () => ({ accessToken: TOKEN, email: 'researcher@example.org' }),
    });

    expect(sessionStore.getItem(STUDIO_AUTH_SESSION_KEY) ?? '').not.toContain(TOKEN);
    expect(sessionStore.getItem(STUDIO_AUTH_TOKEN_KEY)).toBe(TOKEN);
    expect(loadStudioAccessToken(sessionStore)).toBe(TOKEN);

    clearStudioSession(sessionStore);
    expect(loadStudioAccessToken(sessionStore)).toBeNull();
  });
});
