import { describe, expect, it } from 'vitest';
import { ANTHROPIC_TOOLS, runAssistantTurn, type AiConfig } from '../lib/aiProviders';
import type { GeminiWorkspaceContext } from '../lib/geminiAgent';

const workspace: GeminiWorkspaceContext = {
  refLabel: '3HS4.cif',
  mobLabel: 'AF-P00918-F1-model_v6.cif',
  refChain: 'A',
  mobChain: 'A',
  refInspect: null,
  mobInspect: null,
  comparison: null,
  peptide: null,
  crispr: null,
  smiles: null,
  ramachandran: null,
};

const config: AiConfig = {
  provider: 'anthropic',
  synlexa: { apiKey: '', model: 'gemini-3.1-flash-lite' },
  anthropic: { apiKey: 'sk-ant-test', model: 'claude-opus-5-5' },
  gemini: { apiKey: '', model: 'gemini-3.1-flash-lite' },
};

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('Anthropic BYOK assistant (mocked network)', () => {
  it('converts every tool declaration to a JSON-schema object', () => {
    expect(ANTHROPIC_TOOLS.length).toBeGreaterThan(5);
    for (const t of ANTHROPIC_TOOLS) {
      expect(t.input_schema.type).toBe('object');
    }
  });

  it('runs a tool_use → tool_result loop and sums usage', async () => {
    const requests: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
    const replies = [
      {
        id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'focus_3d_residues', input: { seqIds: [94] } }],
        stop_reason: 'tool_use', usage: { input_tokens: 100, output_tokens: 20 },
      },
      {
        id: 'msg_2', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
        content: [{ type: 'text', text: 'Focused His94. Research use only (RUO).' }],
        stop_reason: 'end_turn', usage: { input_tokens: 150, output_tokens: 30 },
      },
    ];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
      return jsonResponse(replies[requests.length - 1]);
    }) as typeof fetch;

    const executed: string[] = [];
    const reply = await runAssistantTurn({
      prompt: 'focus the zinc histidine',
      history: [],
      workspace,
      config,
      fetchImpl,
      executeTool: async (name, args) => {
        executed.push(`${name}:${JSON.stringify(args)}`);
        return { ok: true, summary: 'Focused residue 94', data: { seqIds: [94] } };
      },
    });

    expect(executed).toEqual(['focus_3d_residues:{"seqIds":[94]}']);
    expect(reply.mode).toBe('anthropic-api');
    expect(reply.usage).toEqual({ inputTokens: 250, outputTokens: 50 });
    expect(reply.text).toContain('Focused His94');
    expect(requests).toHaveLength(2);
    expect(requests[0].url).toContain('/v1/messages');
    expect(requests[0].headers.get('anthropic-dangerous-direct-browser-access')).toBe('true');
    expect(requests[0].body.model).toBe('claude-opus-5-5');
    const second = requests[1].body.messages as Array<{ role: string; content: unknown }>;
    const last = second[second.length - 1] as { role: string; content: Array<{ type: string; tool_use_id: string }> };
    expect(last.role).toBe('user');
    expect(last.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_1' });
  });

  it('falls back to the built-in assistant on an invalid key', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    const reply = await runAssistantTurn({
      prompt: 'list artifacts',
      history: [],
      workspace,
      config,
      fetchImpl,
      executeTool: async () => ({ ok: true, summary: '', data: null }),
    });
    expect(reply.mode).toBe('local-deterministic-fallback');
    expect(reply.error).toBe('invalid Anthropic API key');
  });
});
