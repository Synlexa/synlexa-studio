import { describe, expect, it, vi } from 'vitest';
import {
  buildGeminiEndpoint,
  GEMINI_TOOL_DECLARATIONS,
  loadGeminiConfig,
  runGeminiAgentTurn,
  saveGeminiConfig,
  type GeminiWorkspaceContext,
  type StorageLike,
} from '../lib/geminiAgent';

function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

const SAMPLE_CTX: GeminiWorkspaceContext = {
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

describe('Gemini AI Agent & Function Calling (RUO)', () => {
  it('declares all 8 required IDE orchestration tools', () => {
    const names = GEMINI_TOOL_DECLARATIONS.map((d) => d.name);
    expect(names).toEqual([
      'fetch_from_database',
      'run_structure_superposition',
      'focus_3d_residues',
      'engineer_peptide_mutation',
      'design_crispr_edit',
      'inspect_chemical_smiles',
      'analyze_ramachandran',
      'export_ruo_report',
    ]);
  });

  it('persists model & API key locally via injected StorageLike', () => {
    const store = createMemoryStorage();
    expect(loadGeminiConfig(store).keySource).toBe('none');
    const saved = saveGeminiConfig({ apiKey: 'test-key-123', model: 'gemini-4-argon' }, store);
    expect(saved).toEqual({
      apiKey: 'test-key-123',
      model: 'gemini-4-argon',
      keySource: 'localStorage',
    });
    expect(buildGeminiEndpoint('gemini-3.1-flash-lite')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent',
    );
  });

  it('executes a mocked multi-turn Gemini functionCall round-trip and enforces RUO notice', async () => {
    const executeTool = vi.fn(async (name, args) => ({
      ok: true,
      summary: `Applied ${name}(${JSON.stringify(args)})`,
      data: { applied: args, rmsdAngstrom: 0.368 },
    }));

    const fetchMock = vi
      .fn()
      // Round 1: Gemini asks to call focus_3d_residues and engineer_peptide_mutation
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  { functionCall: { name: 'focus_3d_residues', args: { seqIds: [94] } } },
                  { functionCall: { name: 'engineer_peptide_mutation', args: { mutations: ['H94A'] } } },
                ],
              },
            },
          ],
        }),
      } as Response)
      // Round 2: Gemini returns grounded summary text
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  {
                    text: 'Focused residue 94 and queued deterministic mutation H94A in the Peptide workbench.',
                  },
                ],
              },
            },
          ],
        }),
      } as Response);

    const msg = await runGeminiAgentTurn({
      prompt: 'Focus residue 94 and mutate H94A',
      history: [],
      workspace: SAMPLE_CTX,
      executeTool,
      apiKey: 'dummy-api-key',
      model: 'gemini-3.1-flash-lite',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain('/models/gemini-3.1-flash-lite:generateContent');
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({
      'x-goog-api-key': 'dummy-api-key',
    });
    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(executeTool).toHaveBeenNthCalledWith(1, 'focus_3d_residues', { seqIds: [94] });
    expect(executeTool).toHaveBeenNthCalledWith(2, 'engineer_peptide_mutation', {
      mutations: ['H94A'],
    });
    expect(msg.mode).toBe('gemini-api');
    expect(msg.executedTools).toHaveLength(2);
    expect(msg.text).toMatch(/RESEARCH USE ONLY/i);
  });

  it('gracefully falls back to deterministic local Copilot when no API key is configured', async () => {
    const onFallbackAction = vi.fn();
    const executeTool = vi.fn();
    const msg = await runGeminiAgentTurn({
      prompt: 'focus_residues 94, 96',
      history: [],
      workspace: SAMPLE_CTX,
      executeTool,
      onFallbackAction,
      apiKey: '',
    });

    expect(executeTool).not.toHaveBeenCalled();
    expect(onFallbackAction).toHaveBeenCalledWith({
      type: 'focus_residues',
      seqIds: [94, 96],
    });
    expect(msg.mode).toBe('local-deterministic-fallback');
    expect(msg.text).toContain('94, 96');
  });

  it('falls back gracefully if Gemini API returns an HTTP error', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: 'Quota exceeded', code: 429 } }),
    })) as unknown as typeof fetch;

    const msg = await runGeminiAgentTurn({
      prompt: 'list_artifacts',
      history: [],
      workspace: SAMPLE_CTX,
      executeTool: vi.fn(),
      apiKey: 'dummy-key',
      fetchImpl: fetchMock,
    });

    expect(msg.mode).toBe('local-deterministic-fallback');
    expect(msg.error).toBe('Quota exceeded');
    expect(msg.text).toContain('Active Artifacts (RUO)');
  });
});
