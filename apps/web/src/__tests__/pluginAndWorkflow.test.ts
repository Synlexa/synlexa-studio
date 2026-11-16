import { describe, expect, it } from 'vitest';
import { computeDockingBox } from '../lib/dockingBox';
import { handleMcpJsonRpc, MCP_TOOLS, type McpServerRuntime } from '../lib/mcpServer';
import {
  installCustomPlugin,
  listAllPlugins,
  removeCustomPlugin,
  resetPluginsForTesting,
} from '../lib/pluginRegistry';
import {
  exportWorkflowToNextflow,
  exportWorkflowToSnakemake,
  topologicalSortWorkflow,
  WORKFLOW_TEMPLATES,
  type WorkflowGraph,
} from '../lib/workflowEngine';
import type { CompareStructuresResult } from '@synlexa/wasm-bridge';

describe('Plugin Registry, MCP Wiring, Workflow DAG & Docking Box (RUO)', () => {
  it('enforces license isolation and wires custom plugin MCP tools cleanly', async () => {
    resetPluginsForTesting();
    const plugins = listAllPlugins();
    const ob = plugins.find((p) => p.id === 'org.synlexa.openbabel-external');
    expect(ob?.commercialSafe).toBe(false);
    expect(ob?.enabled).toBe(false);

    // Rejects plugin without ruoRequired: true
    expect(() =>
      installCustomPlugin({
        schemaVersion: '1.0.0',
        id: 'org.test.invalid',
        name: 'Bad Plugin',
        version: '0.1.0',
        category: 'Quantum chemistry',
        tier: 'tier2-compute',
        license: 'MIT',
        commercialSafe: true,
        ruoRequired: false,
        description: 'Missing RUO flag',
      }),
    ).toThrow(/ruoRequired/);

    const installed = installCustomPlugin({
      schemaVersion: '1.0.0',
      id: 'org.test.xtb-plugin',
      name: 'xTB Plugin',
      version: '1.0.0',
      category: 'Quantum chemistry',
      tier: 'tier2-compute',
      license: 'LGPL-3.0',
      commercialSafe: true,
      ruoRequired: true,
      description: 'GFN2-xTB adapter',
      mcpTools: [
        {
          name: 'run_xtb_opt',
          description: 'Optimize geometry via xTB',
          inputSchema: { type: 'object', properties: {}, required: [] },
        },
      ],
    });
    expect(installed.id).toBe('org.test.xtb-plugin');

    const runtime: McpServerRuntime = {
      workspace: {
        refLabel: '3HS4.cif',
        mobLabel: 'AF.cif',
        refChain: 'A',
        mobChain: 'A',
        refInspect: null,
        mobInspect: null,
        comparison: null,
        peptide: null,
        crispr: null,
        smiles: null,
        ramachandran: null,
      },
      libraryItems: [],
      executeTool: async (name) => ({ ok: true, summary: `Ran ${name}`, data: {} }),
    };

    const listRes = await handleMcpJsonRpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, runtime);
    const tools = (listRes.result as { tools: Array<{ name: string }> }).tools;
    expect(tools).toHaveLength(MCP_TOOLS.length + 1);
    expect(tools.some((t) => t.name === 'run_xtb_opt')).toBe(true);

    removeCustomPlugin('org.test.xtb-plugin');
  });

  it('sorts DAG templates, rejects cycles, and exports Nextflow/Snakemake scripts', () => {
    for (const tpl of WORKFLOW_TEMPLATES) {
      const sorted = topologicalSortWorkflow(tpl);
      expect(sorted.length).toBe(tpl.nodes.length);
      const nf = exportWorkflowToNextflow(tpl);
      const smk = exportWorkflowToSnakemake(tpl);
      expect(nf).toContain('nextflow.enable.dsl=2');
      expect(smk).toContain('rule all:');
    }

    const cyclic: WorkflowGraph = {
      schemaVersion: '1.0.0',
      id: 'bad',
      name: 'Cycle',
      ruoNotice: 'RUO',
      nodes: [
        { id: 'a', kind: 'load_structures', x: 0, y: 0, params: {} },
        { id: 'b', kind: 'rdkit_prep', x: 100, y: 0, params: {} },
      ],
      edges: [
        { id: 'e1', from: 'a', to: 'b' },
        { id: 'e2', from: 'b', to: 'a' },
      ],
    };
    expect(() => topologicalSortWorkflow(cyclic)).toThrow(/cycle/i);
  });

  it('computes a Vina docking box around an experimental ligand', () => {
    const fakeCmp = {
      refDisplayAtoms: {
        ca: [[1, 2, 3]],
        residues: [{ seqId: 94, insCode: '', resName3: 'HIS', resCode1: 'H', ca: [1, 2, 3], bFactor: 12 }],
        ligands: [
          {
            resName: 'AZM',
            chainId: 'A',
            seqId: 262,
            atoms: [
              { name: 'C1', xyz: [10, 20, 30], element: 'C' },
              { name: 'S1', xyz: [14, 24, 34], element: 'S' },
              { name: 'N1', xyz: [12, 22, 32], element: 'N' },
              { name: 'O1', xyz: [11, 21, 31], element: 'O' },
            ],
          },
        ],
        pocketAtoms: [],
      },
    } as unknown as CompareStructuresResult;

    const box = computeDockingBox(fakeCmp, 94);
    expect(box).not.toBeNull();
    expect(box?.center).toEqual([12, 22, 32]);
    expect(box?.sourceLabel).toContain('AZM');
  });
});
