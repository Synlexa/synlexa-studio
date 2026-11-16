import { describe, expect, it, vi } from 'vitest';
import {
  getVaultSecret,
  getVaultStatus,
  initSecureVault,
  resetVaultForTesting,
  setVaultSecret,
} from '../lib/secureKeyVault';
import {
  getExternalMcpSnippets,
  handleMcpJsonRpc,
  MCP_RESOURCES,
  MCP_TOOLS,
  type McpServerRuntime,
} from '../lib/mcpServer';
import { searchScientificWeb } from '../lib/webSearchConnector';
import type { GeminiWorkspaceContext } from '../lib/geminiAgent';
import {
  relayPopupCallback,
  STUDIO_AUTH_POPUP_ACTIVE_KEY,
  STUDIO_AUTH_RELAY_KEY,
} from '../lib/studioAuth';

const TEST_WORKSPACE: GeminiWorkspaceContext = {
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

describe('Encrypted state.vscdb Local BYOK Vault', () => {
  it('stores and removes provider API keys without plain-text localStorage persistence', async () => {
    resetVaultForTesting();
    await initSecureVault();

    await setVaultSecret('anthropic', 'sk-ant-test-secret-012345');
    await setVaultSecret('openai', 'sk-openai-test-secret-6789');

    expect(getVaultSecret('anthropic')).toBe('sk-ant-test-secret-012345');
    expect(getVaultSecret('openai')).toBe('sk-openai-test-secret-6789');

    const status = getVaultStatus();
    expect(status.dbName).toBe('state.vscdb');
    expect(status.tableName).toBe('ItemTable');
    expect(status.encrypted).toBe(true);
    expect(status.storedProviders).toEqual(['anthropic', 'openai']);

    await setVaultSecret('anthropic', '');
    expect(getVaultSecret('anthropic')).toBe('');
    expect(getVaultStatus().storedProviders).toEqual(['openai']);
  });
});

describe('In-App MCP Server (JSON-RPC 2.0)', () => {
  const runtime: McpServerRuntime = {
    workspace: TEST_WORKSPACE,
    libraryItems: [],
    executeTool: async (name, args) => ({
      ok: true,
      summary: `Executed ${name}`,
      data: { name, args },
    }),
  };

  it('responds to initialize, tools/list, tools/call, and resources/read', async () => {
    const init = await handleMcpJsonRpc({ jsonrpc: '2.0', id: 1, method: 'initialize' }, runtime);
    expect(init.error).toBeUndefined();
    expect((init.result as { protocolVersion: string }).protocolVersion).toBe('2024-11-05');

    const tools = await handleMcpJsonRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, runtime);
    expect((tools.result as { tools: unknown[] }).tools).toHaveLength(MCP_TOOLS.length);
    expect(MCP_TOOLS.some((t) => t.name === 'search_scientific_web')).toBe(true);

    const call = await handleMcpJsonRpc(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'get_workspace_state', arguments: { section: 'all' } },
      },
      runtime,
    );
    expect(call.error).toBeUndefined();
    expect((call.result as { isError: boolean }).isError).toBe(false);

    const resList = await handleMcpJsonRpc({ jsonrpc: '2.0', id: 4, method: 'resources/list' }, runtime);
    expect((resList.result as { resources: unknown[] }).resources).toHaveLength(MCP_RESOURCES.length);

    const vaultRes = await handleMcpJsonRpc(
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'resources/read',
        params: { uri: 'synlexa://vault/status' },
      },
      runtime,
    );
    expect(vaultRes.error).toBeUndefined();
    const snippets = getExternalMcpSnippets(4179);
    expect(snippets.claudeCodeCmd).toContain('synlexa-studio mcp');
    expect(snippets.codexCliCmd).toContain('codex mcp add');
  });
});

describe('Scientific Web Search Connector (RUO)', () => {
  it('parses verified Europe PMC and ClinicalTrials.gov records with provenance', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('europepmc')) {
        return new Response(
          JSON.stringify({
            resultList: {
              result: [
                {
                  id: '19244051',
                  source: 'MED',
                  pmid: '19244051',
                  doi: '10.1021/bi9001234',
                  title: 'High-resolution crystal structure of human carbonic anhydrase II',
                  authorString: 'Sjoblom B, et al.',
                  journalTitle: 'Biochemistry',
                  pubYear: '2009',
                  abstractText: 'Active site coordination around His94 and Zn2+.',
                },
              ],
            },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          studies: [
            {
              protocolSection: {
                identificationModule: {
                  nctId: 'NCT01234567',
                  briefTitle: 'Carbonic anhydrase translational study',
                  organization: { fullName: 'Research University' },
                },
                statusModule: { overallStatus: 'COMPLETED', startDateStruct: { date: '2024-01' } },
                designModule: { phases: ['PHASE2'] },
                conditionsModule: { conditions: ['Autoimmune Thyroiditis'] },
              },
            },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const result = await searchScientificWeb('carbonic anhydrase II', {
      scope: 'all',
      limit: 3,
      fetchImpl: fetchMock,
    });

    expect(result.origin).toBe('live-network');
    expect(result.hits).toHaveLength(2);
    expect(result.hits[0].identifier).toBe('PMID:19244051');
    expect(result.hits[0].sourceUrl).toBe('https://pubmed.ncbi.nlm.nih.gov/19244051/');
    expect(result.hits[1].identifier).toBe('NCT01234567');
    expect(result.hits[1].sourceUrl).toBe('https://clinicaltrials.gov/study/NCT01234567');
  });

  it('falls back cleanly to pinned citations when offline', async () => {
    const result = await searchScientificWeb('3HS4 acetazolamide', { offline: true });
    expect(result.origin).toBe('offline-fallback');
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0].identifier).toBe('PDB:3HS4');
  });
});

describe('Popup Sign-In Relay & Closing Guard', () => {
  it('relays popup callback via localStorage marker even when window.opener and window.name are cleared', () => {
    const prevWindow = (globalThis as { window?: unknown }).window;
    const store = new Map<string, string>();
    store.set(STUDIO_AUTH_POPUP_ACTIVE_KEY, String(Date.now()));
    (globalThis as { window?: unknown }).window = {
      name: '',
      opener: null,
      outerWidth: 1200,
      outerHeight: 900,
      location: { origin: 'http://127.0.0.1:4179' },
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
        removeItem: (k: string) => store.delete(k),
      },
    };
    try {
      const ok = relayPopupCallback(
        'http://127.0.0.1:4179/?studio_auth=callback&code=abc123&state=xyz789',
      );
      expect(ok).toBe(true);
      expect(store.has(STUDIO_AUTH_POPUP_ACTIVE_KEY)).toBe(false);
      const relayed = JSON.parse(store.get(STUDIO_AUTH_RELAY_KEY) || '{}') as {
        href?: string;
      };
      expect(relayed.href).toContain('code=abc123');
    } finally {
      (globalThis as { window?: unknown }).window = prevWindow;
    }
  });
});
