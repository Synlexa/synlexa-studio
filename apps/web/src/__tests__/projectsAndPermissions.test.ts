import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { resolveActiveAiRoute, runAssistantTurn, type AiConfig } from '../lib/aiProviders';
import {
  EXTRA_STUDIO_TOOL_DECLARATIONS,
  runGeminiAgentTurn,
  type AgentStepTrace,
  type GeminiWorkspaceContext,
} from '../lib/geminiAgent';
import {
  addMoleculeToActiveProject,
  addStructureToActiveProject,
  createProject,
  deleteProject,
  getProjectsSnapshot,
  loadProjects,
  splitStructureIntoParts,
  switchProject,
} from '../lib/projectsStore';
import {
  classifyToolPermission,
  DEFAULT_PERMISSION_POLICIES,
  type ToolPermissionCategory,
} from '../lib/toolPermissions';
import { DEFAULT_LAYOUT, type ToolTabId } from '../lib/workspaceLayout';
import { AssistantView } from '../components/AssistantView';
import { HomeView } from '../components/HomeView';
import { TutorialGuideModal } from '../components/TutorialGuideModal';
import { ToolsPanel } from '../components/workspace/Shell';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

const emptyWorkspace: GeminiWorkspaceContext = {
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

describe('Start Page default layout & Tools grouping', () => {
  it('opens Synlexa Studio on the Start page (home) with AI Assistant docked', () => {
    expect(DEFAULT_LAYOUT.groups[0].active).toBe('home');
    expect(DEFAULT_LAYOUT.groups[0].tabs).toContain('home');
    expect(DEFAULT_LAYOUT.groups[0].tabs).toContain('viewer');
    expect(DEFAULT_LAYOUT.groups[1].active).toBe('assistant');
  });

  it('registers all 5 octopus-arm tools in EXTRA_STUDIO_TOOL_DECLARATIONS', () => {
    const names = EXTRA_STUDIO_TOOL_DECLARATIONS.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'control_app_ui',
        'manage_project',
        'design_molecule_rdkit',
        'run_workflow_pipeline',
        'manage_plugins',
      ]),
    );
  });
});

describe('Multi-project workspace & structure chain/ligand splitting', () => {
  it('creates, switches, populates, and deletes isolated projects', () => {
    const storage = memoryStorage();
    const initial = loadProjects(storage);
    expect(initial.length).toBeGreaterThanOrEqual(1);

    const p2 = createProject({ name: 'CA-II Sulfonamide Series', template: 'ligand-docking' }, storage);
    expect(getProjectsSnapshot().activeProject?.id).toBe(p2.id);

    addMoleculeToActiveProject({ name: 'Fluoro-AZM', smiles: 'FCc1nnc(S(N)(=O)=O)s1' }, storage);
    addStructureToActiveProject({ label: '3HS4_A.pdb', role: 'reference', content: 'ATOM      1  CA  ALA A   1' }, storage);

    const active = getProjectsSnapshot().activeProject!;
    expect(active.molecules.some((m) => m.name === 'Fluoro-AZM')).toBe(true);
    expect(active.structures.some((s) => s.label === '3HS4_A.pdb')).toBe(true);

    const switched = switchProject('proj-default', storage);
    expect(switched?.id).toBe('proj-default');
    expect(getProjectsSnapshot().activeProject?.molecules.some((m) => m.name === 'Fluoro-AZM')).toBe(false);

    deleteProject(p2.id, storage);
    expect(getProjectsSnapshot().projects.some((p) => p.id === p2.id)).toBe(false);
  });

  it('splits multi-chain PDB and non-water HETATM ligands cleanly', () => {
    const samplePdb = [
      'ATOM      1  CA  ALA A   1       1.000   2.000   3.000  1.00 10.00           C',
      'ATOM      2  CA  GLY B   1       4.000   5.000   6.000  1.00 12.00           C',
      'HETATM    3  C1  AZM A 901       7.000   8.000   9.000  1.00  8.00           C',
      'HETATM    4  O   HOH A 999      10.000  11.000  12.000  1.00 20.00           O',
      'END',
    ].join('\n');

    const parts = splitStructureIntoParts(samplePdb, 'complex.pdb');
    expect(parts.map((p) => p.label)).toEqual([
      'complex_chain_A.pdb',
      'complex_chain_B.pdb',
      'complex_ligand_AZM_A.pdb',
    ]);
    expect(parts[2].kind).toBe('ligand');
    expect(parts[2].pdbContent).toContain('AZM');
    expect(parts.some((p) => p.pdbContent.includes('HOH'))).toBe(false);
  });
});

describe('Agent permission gates & live thinking process', () => {
  it('classifies tools across safe_read, workspace_mutate, external_network, and remote_compute', () => {
    expect(classifyToolPermission('control_app_ui', { tab: 'viewer' }).category).toBe('safe_read');
    expect(classifyToolPermission('manage_project', { action: 'create' }).category).toBe('workspace_mutate');
    expect(classifyToolPermission('fetch_from_database', { source: 'rcsb', query: '3HS4' }).category).toBe('external_network');
    expect(classifyToolPermission('run_workflow_pipeline', { action: 'run' }).category).toBe('remote_compute');
  });

  it('captures model thought parts + streams stepTrace + enforces allow_session & deny permission decisions', async () => {
    let callIdx = 0;
    const responses = [
      {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                { thought: true, text: 'Need to inspect 3HS4 online first.' },
                { text: 'Requesting RCSB fetch.' },
                { functionCall: { name: 'fetch_from_database', args: { source: 'rcsb', query: '3HS4' } } },
              ],
            },
          },
        ],
      },
      {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ functionCall: { name: 'fetch_from_database', args: { source: 'uniprot', query: 'P00918' } } }],
            },
          },
        ],
      },
      {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ functionCall: { name: 'run_workflow_pipeline', args: { action: 'run' } } }],
            },
          },
        ],
      },
      {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'Handled allowed & denied steps cleanly. Research use only (RUO).' }],
            },
          },
        ],
      },
    ];

    const fetchImpl = vi.fn(async () => {
      const payload = responses[callIdx++];
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    const executeTool = vi.fn(async (name: string) => ({
      ok: true,
      summary: `Executed ${name}`,
      data: { ok: true },
    }));

    const promptsRequested: string[] = [];
    const sessionCategories = new Set<ToolPermissionCategory>();
    const progressSnapshots: AgentStepTrace[][] = [];

    const reply = await runGeminiAgentTurn({
      prompt: 'Fetch 3HS4 & P00918, then run workflow',
      history: [],
      workspace: emptyWorkspace,
      apiKey: 'AIza-test-key',
      fetchImpl,
      executeTool,
      permissionPolicies: DEFAULT_PERMISSION_POLICIES,
      sessionApprovedCategories: sessionCategories,
      onProgress: (steps) => progressSnapshots.push(steps),
      requestToolPermission: async (req) => {
        promptsRequested.push(req.toolName);
        if (req.category === 'external_network') return 'allow_session';
        return 'deny';
      },
    });

    // Prompted only once for external_network (second call used session approval), plus once for remote_compute (denied)
    expect(promptsRequested).toEqual(['fetch_from_database', 'run_workflow_pipeline']);
    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(reply.thinkingTrace).toEqual(['Need to inspect 3HS4 online first.', 'Requesting RCSB fetch.']);
    expect(reply.executedTools?.map((t) => t.permissionStatus)).toEqual([
      'allowed-session',
      'allowed-session',
      'denied',
    ]);
    expect(progressSnapshots.length).toBeGreaterThan(2);
  });
});

describe('BYOK vs Synlexa Cloud routing', () => {
  it('uses the user BYOK key instead of Synlexa Cloud by default even when signed in', async () => {
    const mixedConfig: AiConfig = {
      provider: 'synlexa',
      routingPreference: 'byok-first',
      synlexa: { apiKey: 'cloud-bearer-token', model: 'gemini-4-argon' },
      anthropic: { apiKey: '', model: 'claude-opus-5-5' },
      gemini: { apiKey: 'AIza-user-byok-key', model: 'gemini-3.1-flash-lite' },
      openai: { apiKey: '', model: 'gpt-4.1' },
    };

    const route = resolveActiveAiRoute(mixedConfig);
    expect(route.provider).toBe('gemini');
    expect(route.isByok).toBe(true);
    expect(route.overriddenFromCloud).toBe(true);

    const urlsCalled: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      urlsCalled.push(String(url));
      return new Response(
        JSON.stringify({
          candidates: [{ content: { role: 'model', parts: [{ text: 'Answered with BYOK. Research use only (RUO).' }] } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const reply = await runAssistantTurn({
      prompt: 'Check status',
      history: [],
      workspace: emptyWorkspace,
      config: mixedConfig,
      executeTool: vi.fn(),
      fetchImpl,
    });

    expect(reply.mode).toBe('gemini-api');
    expect(urlsCalled[0]).toContain('generativelanguage.googleapis.com');
    expect(urlsCalled[0]).not.toContain('synlexa.com');
  });

  it('allows explicitly selecting Synlexa Cloud in manual mode', () => {
    const manualConfig: AiConfig = {
      provider: 'synlexa',
      routingPreference: 'manual',
      synlexa: { apiKey: 'cloud-bearer-token', model: 'gemini-4-argon' },
      anthropic: { apiKey: '', model: 'claude-opus-5-5' },
      gemini: { apiKey: 'AIza-user-byok-key', model: 'gemini-3.1-flash-lite' },
      openai: { apiKey: '', model: 'gpt-4.1' },
    };

    const route = resolveActiveAiRoute(manualConfig);
    expect(route.provider).toBe('synlexa');
    expect(route.isByok).toBe(false);
  });
});

describe('Upgraded UI & Tutorial SSR renders', () => {
  it('renders HomeView, TutorialGuideModal, ToolsPanel, and AssistantView with live trace & permission card', () => {
    const htmlHome = renderToStaticMarkup(
      createElement(HomeView, {
        activeStarterId: null,
        runHistory: [],
        projects: [],
        activeProject: null,
        onImportFile: () => {},
        onSearchDatabases: () => {},
        onOpenLibrary: () => {},
        onOpenAssistant: () => {},
        onLaunchStarter: () => {},
        onOpenLibraryItem: () => {},
      }),
    );
    expect(htmlHome).toContain('Welcome to Synlexa Studio');

    const htmlGuide = renderToStaticMarkup(
      createElement(TutorialGuideModal, {
        open: true,
        onClose: () => {},
        onExecuteStepAction: () => {},
      }),
    );
    expect(htmlGuide).toContain('Synlexa Studio Interactive Guide');
    expect(htmlGuide).toContain('Start Page &amp; Multi-Project Workspaces');

    const htmlTools = renderToStaticMarkup(
      createElement(ToolsPanel, {
        openTabs: new Set<ToolTabId>(['home', 'assistant']),
        onOpen: () => {},
      }),
    );
    expect(htmlTools).toContain('Structures &amp; 3D');
    expect(htmlTools).toContain('Design &amp; Editing');
    expect(htmlTools).toContain('Pipelines &amp; GPU');

    const htmlAssistant = renderToStaticMarkup(
      createElement(AssistantView, {
        messages: [],
        busy: true,
        liveSteps: [{ round: 1, phase: 'thinking', title: 'Round 1 · Planning', detail: 'Checking 3HS4' }],
        pendingPermission: {
          id: 'p1',
          toolName: 'fetch_from_database',
          category: 'external_network',
          title: 'Fetch from RCSB',
          detail: 'Query "3HS4" and import into workspace.',
          args: { source: 'rcsb', query: '3HS4' },
        },
        config: {
          provider: 'gemini',
          synlexa: { apiKey: '', model: 'gemini-3.1-flash-lite' },
          anthropic: { apiKey: '', model: 'claude-opus-5-5' },
          gemini: { apiKey: 'AIza-demo', model: 'gemini-3.1-flash-lite' },
        },
        onSelectProvider: () => {},
        onSend: () => {},
        onClear: () => {},
        onOpenKeySettings: () => {},
      }),
    );
    expect(htmlAssistant).toContain('Live thinking &amp; tool trace');
    expect(htmlAssistant).toContain('Allow once');
    expect(htmlAssistant).toContain('Always allow this session');
    expect(htmlAssistant).toContain('BYOK · state.vscdb');
  });
});
