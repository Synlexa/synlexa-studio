import type { AnalyzeRamachandranResult } from '@synlexa/wasm-bridge';
import {
  executeCopilotCommand,
  type CopilotAction,
  type CopilotContext,
} from './copilotEngine';
import { RUO_DISCLAIMER } from './reportGenerator';
import { getVaultSecret, setVaultSecret } from './secureKeyVault';
import {
  classifyToolPermission,
  loadPermissionPolicies,
  type PermissionDecision,
  type ToolPermissionCategory,
  type ToolPermissionPolicyMap,
  type ToolPermissionRequest,
} from './toolPermissions';

/**
 * Gemini models offered in Studio, fastest first. IDs are the exact API model
 * strings from Google's model list (checked 2026-11-15); the deprecated 2.5
 * family is no longer offered.
 */
export type GeminiModelId =
  | 'gemini-3.1-flash-lite'
  | 'gemini-3-flash-preview'
  | 'gemini-3.1-pro-preview'
  | 'gemini-4-hydrogen'
  | 'gemini-4-argon'
  | 'gemini-4-carbon';

export const DEFAULT_GEMINI_MODEL: GeminiModelId = 'gemini-3.1-flash-lite';

export const GEMINI_MODELS: Array<{ id: GeminiModelId; label: string; note: string }> = [
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', note: 'Fastest · default for quick answers' },
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash', note: 'Multi-step reasoning & tool use · preview' },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', note: 'Deep reasoning, 1M-token context · preview' },
  { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen', note: 'Fast, efficient agentic workflows' },
  { id: 'gemini-4-argon', label: 'Gemini 4 Argon', note: 'Efficient frontier reasoning for math & science' },
  { id: 'gemini-4-carbon', label: 'Gemini 4 Carbon', note: 'Strongest reasoning · complex scientific work' },
];

export function isGeminiModelId(value: unknown): value is GeminiModelId {
  return typeof value === 'string' && GEMINI_MODELS.some((m) => m.id === value);
}

export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
export const LS_API_KEY = 'synlexa.studio.gemini.apiKey';
export const LS_MODEL_KEY = 'synlexa.studio.gemini.model';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface GeminiFunctionDeclaration {
  name: GeminiToolName;
  description: string;
  parameters: {
    type: 'OBJECT';
    properties: Record<
      string,
      {
        type: 'STRING' | 'NUMBER' | 'INTEGER' | 'BOOLEAN' | 'ARRAY';
        description: string;
        enum?: string[];
        items?: { type: 'STRING' | 'INTEGER' | 'NUMBER' };
      }
    >;
    required?: string[];
  };
}

export type GeminiToolName =
  | 'fetch_from_database'
  | 'run_structure_superposition'
  | 'focus_3d_residues'
  | 'engineer_peptide_mutation'
  | 'design_crispr_edit'
  | 'inspect_chemical_smiles'
  | 'analyze_ramachandran'
  | 'export_ruo_report'
  | 'get_workspace_state'
  | 'search_scientific_web'
  | 'query_local_library'
  | 'list_compute_nodes'
  | 'run_compute_job'
  | 'control_app_ui'
  | 'manage_project'
  | 'design_molecule_rdkit'
  | 'run_workflow_pipeline'
  | 'manage_plugins';

export const GEMINI_TOOL_DECLARATIONS: GeminiFunctionDeclaration[] = [
  {
    name: 'fetch_from_database',
    description:
      'Search or import a verified public structure or compound from RCSB PDB, AlphaFold DB, UniProtKB, or PubChem (or pinned local cache if offline).',
    parameters: {
      type: 'OBJECT',
      properties: {
        source: {
          type: 'STRING',
          description: 'Public database source to query.',
          enum: ['rcsb', 'alphafold', 'uniprot', 'pubchem'],
        },
        query: {
          type: 'STRING',
          description: 'PDB ID, UniProt accession, protein name, or compound name (e.g. "1UBQ", "P0CG48", "imatinib").',
        },
        role: {
          type: 'STRING',
          description: 'When importing a structure, whether to assign it as reference or mobile.',
          enum: ['reference', 'mobile'],
        },
        autoImport: {
          type: 'BOOLEAN',
          description: 'If true, immediately import the top matching record into the IDE workspace.',
        },
      },
      required: ['source', 'query'],
    },
  },
  {
    name: 'run_structure_superposition',
    description:
      'Run deterministic float64 Kabsch 3D rigid superposition between the currently loaded Reference and Mobile structures.',
    parameters: {
      type: 'OBJECT',
      properties: {
        refChain: {
          type: 'STRING',
          description: 'Optional explicit polymer chain ID for the reference structure.',
        },
        mobChain: {
          type: 'STRING',
          description: 'Optional explicit polymer chain ID for the mobile structure.',
        },
      },
    },
  },
  {
    name: 'focus_3d_residues',
    description:
      'Highlight and center one or more residue sequence numbers across the 3D viewport, sequence Δd track, PAE matrix, and Ramachandran plot.',
    parameters: {
      type: 'OBJECT',
      properties: {
        seqIds: {
          type: 'ARRAY',
          description: 'Positive 1-based residue sequence IDs to focus.',
          items: { type: 'INTEGER' },
        },
      },
      required: ['seqIds'],
    },
  },
  {
    name: 'engineer_peptide_mutation',
    description:
      'Apply one or more point mutations (e.g. H94A, T199V, E7V) in the Peptide Engineering workbench and compute deterministic biophysical deltas.',
    parameters: {
      type: 'OBJECT',
      properties: {
        mutations: {
          type: 'ARRAY',
          description: 'Point mutations in <WT><pos><Mut> format, e.g. ["H94A"].',
          items: { type: 'STRING' },
        },
        focusSeqId: {
          type: 'INTEGER',
          description: 'Optional residue ID for 5.0 Å local 3D contact shell inspection.',
        },
      },
      required: ['mutations'],
    },
  },
  {
    name: 'design_crispr_edit',
    description:
      'Evaluate a coding-transcript nucleotide edit consequence (synonymous/missense/nonsense) and scan SpCas9, SaCas9, or Cas12a PAM sites.',
    parameters: {
      type: 'OBJECT',
      properties: {
        transcriptId: {
          type: 'STRING',
          description: 'RefSeq transcript ID (NM_000067.3 CA2, NM_000518.5 HBB, NM_000546.6 TP53).',
          enum: ['NM_000067.3', 'NM_000518.5', 'NM_000546.6'],
        },
        targetCodonIndex: {
          type: 'INTEGER',
          description: '1-based target codon index in the CDS.',
        },
        baseEditOffset: {
          type: 'INTEGER',
          description: 'Codon base offset (0, 1, or 2).',
        },
        newBase: {
          type: 'STRING',
          description: 'Substituted DNA nucleotide.',
          enum: ['A', 'C', 'G', 'T'],
        },
        nuclease: {
          type: 'STRING',
          description: 'CRISPR nuclease PAM scanner.',
          enum: ['SpCas9', 'SaCas9', 'Cas12a'],
        },
      },
      required: ['targetCodonIndex'],
    },
  },
  {
    name: 'inspect_chemical_smiles',
    description:
      'Parse a SMILES string in the deterministic Wasm chemistry engine to compute formula, MW, TPSA, cLogP, Lipinski/Veber metrics, and 2D layout.',
    parameters: {
      type: 'OBJECT',
      properties: {
        smiles: {
          type: 'STRING',
          description: 'Canonical or isomeric SMILES string.',
        },
        name: {
          type: 'STRING',
          description: 'Human-readable compound label.',
        },
      },
      required: ['smiles'],
    },
  },
  {
    name: 'analyze_ramachandran',
    description:
      'Compute backbone (φ, ψ) dihedral angles, secondary structure counts (Helix/Sheet/Loop), Ramachandran favored/allowed/outlier counts, and Cα–Cα contacts.',
    parameters: {
      type: 'OBJECT',
      properties: {
        target: {
          type: 'STRING',
          description: 'Which loaded structure to analyze.',
          enum: ['reference', 'mobile'],
        },
        chainId: {
          type: 'STRING',
          description: 'Optional polymer chain ID.',
        },
      },
    },
  },
  {
    name: 'export_ruo_report',
    description:
      'Export a self-contained Research-Use-Only (RUO) HTML report, JSON provenance manifest, or versioned .synlexa.bundle.json project file.',
    parameters: {
      type: 'OBJECT',
      properties: {
        format: {
          type: 'STRING',
          description: 'Export format.',
          enum: ['html', 'json', 'bundle'],
        },
      },
      required: ['format'],
    },
  },
];

export const EXTRA_STUDIO_TOOL_DECLARATIONS: GeminiFunctionDeclaration[] = [
  {
    name: 'get_workspace_state',
    description:
      'Inspect the complete live deterministic workspace state via the in-app MCP server: top deviating residues, ligand/metal active-site contacts, Ramachandran outliers, peptide deltas, CRISPR PAM sites, SMILES descriptors, and saved library items.',
    parameters: {
      type: 'OBJECT',
      properties: {
        section: {
          type: 'STRING',
          description: 'Which slice of workspace telemetry to inspect.',
          enum: ['all', 'comparison', 'contacts', 'peptide', 'crispr', 'chemistry', 'ramachandran', 'library'],
        },
        topN: {
          type: 'INTEGER',
          description: 'Maximum number of residue/contact/PAM rows to include (default 10).',
        },
      },
    },
  },
  {
    name: 'search_scientific_web',
    description:
      'Search live peer-reviewed scientific literature (Europe PMC / PubMed) and trial registries (ClinicalTrials.gov API v2) with verified PMIDs, DOIs, NCT IDs, source URLs, and UTC timestamps.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description: 'Scientific search query (e.g. "carbonic anhydrase II acetazolamide 3HS4", "hashimoto autoimmune thyroid biomarker").',
        },
        scope: {
          type: 'STRING',
          description: 'Sources to query.',
          enum: ['all', 'literature', 'trials'],
        },
        limit: {
          type: 'INTEGER',
          description: 'Maximum results per source (1-8).',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'query_local_library',
    description:
      'List or filter saved structures, ligands, and sequences in the local IndexedDB molecule library with SHA-256 checksums and provenance.',
    parameters: {
      type: 'OBJECT',
      properties: {
        kind: {
          type: 'STRING',
          description: 'Filter by item kind.',
          enum: ['all', 'structure', 'compound', 'sequence'],
        },
        query: {
          type: 'STRING',
          description: 'Optional substring filter by name, accession, or tag.',
        },
      },
    },
  },
  {
    name: 'list_compute_nodes',
    description:
      'List paired external GPU / Colab / local Compute Nodes, detected GPUs/VRAM, and installed bioinformatics engines (Vina, OpenMM, Boltz-2, RFdiffusion, PySCF, GROMACS).',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
  },
  {
    name: 'run_compute_job',
    description:
      'Submit a scientific compute job (vina_docking, openmm_md, boltz_predict, rfdiffusion_design, pyscf_qm, rdkit_3d, gromacs_md) to the currently active connected Compute Node.',
    parameters: {
      type: 'OBJECT',
      properties: {
        toolId: {
          type: 'STRING',
          description: 'Compute adapter ID on the connected node.',
          enum: [
            'vina_docking',
            'openmm_md',
            'boltz_predict',
            'rfdiffusion_design',
            'pyscf_qm',
            'rdkit_3d',
            'gromacs_md',
          ],
        },
        smiles: {
          type: 'STRING',
          description: 'Optional ligand SMILES (defaults to active Chemistry Workbench SMILES).',
        },
        steps: {
          type: 'INTEGER',
          description: 'Optional OpenMM MD steps (default 1000).',
        },
      },
      required: ['toolId'],
    },
  },
  {
    name: 'control_app_ui',
    description:
      'Navigate and control the Synlexa Studio UI ("octopus arms"): open/split any workbench tab, switch the 3D engine (Fast WebGL2 vs Mol* Pro), change 3D layout/style/colorMode/camera preset, switch sidebar view, or open the interactive Tutorial.',
    parameters: {
      type: 'OBJECT',
      properties: {
        openTab: {
          type: 'STRING',
          description: 'Tab to open or focus.',
          enum: [
            'home',
            'viewer',
            'results',
            'sequence',
            'ramachandran',
            'peptide',
            'crispr',
            'chemistry',
            'workflow',
            'compute',
            'plugins',
            'assistant',
            'mcp',
            'library',
          ],
        },
        toSide: {
          type: 'BOOLEAN',
          description: 'If true, open the tab in a split side pane.',
        },
        viewportEngine: {
          type: 'STRING',
          description: 'Switch 3D engine between Fast WebGL2 and Mol* Pro.',
          enum: ['webgl2', 'molstar'],
        },
        viewportLayout: {
          type: 'STRING',
          description: 'Set 3D comparison layout.',
          enum: ['overlay', 'split', 'reference', 'mobile'],
        },
        renderStyle: {
          type: 'STRING',
          description: 'Set 3D representation style.',
          enum: ['ribbon', 'trace', 'pocket'],
        },
        colorMode: {
          type: 'STRING',
          description: 'Set 3D coloring mode.',
          enum: ['identity', 'plddt', 'bfactor', 'deviation'],
        },
        cameraPreset: {
          type: 'STRING',
          description: 'Move 3D camera to preset.',
          enum: ['overview', 'active-site', 'n-terminus', 'reset'],
        },
        sidebarView: {
          type: 'STRING',
          description: 'Switch left sidebar view.',
          enum: ['explorer', 'library', 'tools', 'history'],
        },
        openTutorial: {
          type: 'BOOLEAN',
          description: 'Open the interactive Studio guided tutorial.',
        },
      },
    },
  },
  {
    name: 'manage_project',
    description:
      'Create, list, or switch multi-asset research projects; save designed molecules/peptides; split multi-chain/ligand structures into individual parts; or bind a receptor and ligand for docking.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: {
          type: 'STRING',
          description: 'Project action to perform.',
          enum: ['list', 'create', 'switch', 'add_molecule', 'split_chains', 'stage_binding'],
        },
        projectId: { type: 'STRING', description: 'Target project ID when switching.' },
        name: { type: 'STRING', description: 'Project or molecule name.' },
        description: { type: 'STRING', description: 'Project description.' },
        template: {
          type: 'STRING',
          description: 'Project starter template.',
          enum: ['blank', 'structure-compare', 'ligand-docking', 'peptide-crispr'],
        },
        smiles: { type: 'STRING', description: 'SMILES string when adding a molecule.' },
        target: {
          type: 'STRING',
          description: 'Which loaded structure to split (reference or mobile).',
          enum: ['reference', 'mobile'],
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'design_molecule_rdkit',
    description:
      'Analyze, validate, screen for PAINS/Brenk alerts, or run SMARTS substructure search on a molecule using the in-browser RDKit WASM engine, and optionally save it into the active project.',
    parameters: {
      type: 'OBJECT',
      properties: {
        smiles: { type: 'STRING', description: 'SMILES or MOL block to analyze/design.' },
        name: { type: 'STRING', description: 'Molecule label.' },
        smartsQuery: { type: 'STRING', description: 'Optional SMARTS pattern for substructure matching/highlighting.' },
        saveToProject: { type: 'BOOLEAN', description: 'Save molecule to the active project.' },
      },
      required: ['smiles'],
    },
  },
  {
    name: 'run_workflow_pipeline',
    description:
      'Open Workflow Canvas and inspect, export (Nextflow/Snakemake), or execute a multi-step scientific DAG workflow template.',
    parameters: {
      type: 'OBJECT',
      properties: {
        templateId: {
          type: 'STRING',
          description: 'Workflow template ID.',
          enum: ['tpl-structure-audit', 'tpl-hit-to-lead', 'tpl-binder-design', 'tpl-quantum-ligand'],
        },
        action: {
          type: 'STRING',
          description: 'Whether to run, export Nextflow, or export Snakemake.',
          enum: ['run', 'export_nextflow', 'export_snakemake'],
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'manage_plugins',
    description:
      'List all open-source biochemistry plugins & license status, or enable/disable an add-on.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: {
          type: 'STRING',
          description: 'Plugin action to perform.',
          enum: ['list', 'enable', 'disable'],
        },
        pluginId: { type: 'STRING', description: 'Plugin ID (e.g. org.synlexa.autodock-vina).' },
      },
      required: ['action'],
    },
  },
];

export const STUDIO_TOOL_DECLARATIONS: GeminiFunctionDeclaration[] = [
  ...GEMINI_TOOL_DECLARATIONS,
  ...EXTRA_STUDIO_TOOL_DECLARATIONS,
];

export interface GeminiWorkspaceContext extends CopilotContext {
  refChain: string;
  mobChain: string;
  ramachandran: AnalyzeRamachandranResult | null;
}

export interface ExecutedToolRecord {
  name: GeminiToolName | string;
  args: Record<string, unknown>;
  ok: boolean;
  summary: string;
  result: unknown;
  durationMs?: number;
  permissionStatus?: 'auto' | 'allowed-once' | 'allowed-session' | 'denied';
}

export interface AgentStepTrace {
  round: number;
  phase: 'thinking' | 'permission' | 'tool' | 'error';
  title: string;
  detail?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  durationMs?: number;
  ok?: boolean;
  status?: 'running' | 'done' | 'error';
  startedAtMs?: number;
}

export interface AgentChatMessage {
  id: string;
  role: 'user' | 'assistant';
  mode?: 'gemini-api' | 'anthropic-api' | 'openai-api' | 'synlexa-cloud' | 'local-deterministic-fallback';
  model?: string;
  providerLabel?: string;
  text: string;
  thinkingTrace?: string[];
  stepTrace?: AgentStepTrace[];
  executedTools?: ExecutedToolRecord[];
  citations?: string[];
  timestampUtc: string;
  durationMs?: number;
  error?: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface GeminiConfig {
  apiKey: string;
  model: GeminiModelId;
  keySource: 'env' | 'vault' | 'localStorage' | 'none';
}

export type ToolExecutor = (
  name: GeminiToolName,
  args: Record<string, unknown>,
) => Promise<{ ok: boolean; summary: string; data: unknown }>;

function safeStorage(override?: StorageLike | null): StorageLike | null {
  if (override !== undefined) return override;
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function getEnvGeminiApiKey(): string {
  try {
    const envVal = (import.meta as unknown as { env?: Record<string, string | undefined> })?.env
      ?.VITE_GEMINI_API_KEY;
    return typeof envVal === 'string' ? envVal.trim() : '';
  } catch {
    return '';
  }
}

export function loadGeminiConfig(storageOverride?: StorageLike | null): GeminiConfig {
  const storage = safeStorage(storageOverride);
  const storedModel = storage?.getItem(LS_MODEL_KEY);
  const model: GeminiModelId = isGeminiModelId(storedModel) ? storedModel : DEFAULT_GEMINI_MODEL;

  if (storageOverride !== undefined) {
    const storedKey = storage?.getItem(LS_API_KEY)?.trim() ?? '';
    if (storedKey) return { apiKey: storedKey, model, keySource: 'localStorage' };
    const envKey = getEnvGeminiApiKey();
    if (envKey) return { apiKey: envKey, model, keySource: 'env' };
    return { apiKey: '', model, keySource: 'none' };
  }

  const vaultKey = getVaultSecret('gemini').trim();
  if (vaultKey) {
    return { apiKey: vaultKey, model, keySource: 'vault' };
  }
  const envKey = getEnvGeminiApiKey();
  if (envKey) {
    return { apiKey: envKey, model, keySource: 'env' };
  }
  return { apiKey: '', model, keySource: 'none' };
}

export function saveGeminiConfig(
  update: { apiKey?: string; model?: GeminiModelId },
  storageOverride?: StorageLike | null,
): GeminiConfig {
  const storage = safeStorage(storageOverride);
  if (storageOverride !== undefined) {
    if (storage) {
      if (update.apiKey !== undefined) {
        const trimmed = update.apiKey.trim();
        if (trimmed) storage.setItem(LS_API_KEY, trimmed);
        else storage.removeItem(LS_API_KEY);
      }
      if (update.model) storage.setItem(LS_MODEL_KEY, update.model);
    }
    return loadGeminiConfig(storage);
  }

  if (storage && update.model) {
    storage.setItem(LS_MODEL_KEY, update.model);
  }
  if (update.apiKey !== undefined) {
    void setVaultSecret('gemini', update.apiKey);
  }
  return loadGeminiConfig();
}

export function buildGeminiEndpoint(model: GeminiModelId): string {
  return `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent`;
}

export function buildWorkspaceSummaryText(ctx: GeminiWorkspaceContext): string {
  const lines: string[] = [
    `Active Reference: ${ctx.refLabel || 'none'} (chain=${ctx.refChain || 'unselected'}, sha256=${ctx.comparison?.reference.sha256 ?? ctx.refInspect?.sha256 ?? 'none'}, confidence=${ctx.comparison?.reference.confidenceKind ?? ctx.refInspect?.confidenceKind ?? 'none'})`,
    `Active Mobile: ${ctx.mobLabel || 'none'} (chain=${ctx.mobChain || 'unselected'}, sha256=${ctx.comparison?.mobile.sha256 ?? ctx.mobInspect?.sha256 ?? 'none'}, confidence=${ctx.comparison?.mobile.confidenceKind ?? ctx.mobInspect?.confidenceKind ?? 'none'})`,
  ];

  if (ctx.comparison) {
    const m = ctx.comparison.metrics;
    const plddtVals = ctx.comparison.matchedResidues
      .map((r) => r.mobPlddt)
      .filter((v): v is number => v !== null && Number.isFinite(v));
    const meanPlddt = plddtVals.length > 0 ? plddtVals.reduce((a, b) => a + b, 0) / plddtVals.length : null;
    const ligands = ctx.comparison.refDisplayAtoms?.ligands.map((l) => `${l.resName}(${l.chainId}:${l.seqId})`).join(', ') || 'none';
    lines.push(
      `Comparison (${ctx.comparison.resultId.slice(0, 12)}): RMSD=${m.rmsdAngstrom.toFixed(4)} Å across ${m.matchedCaCount} Cα, refCov=${m.refCoverage.numerator}/${m.refCoverage.denominator} (${m.refCoverage.denominatorKind}), mobCov=${m.mobCoverage.numerator}/${m.mobCoverage.denominator}, meanPlddt=${meanPlddt !== null ? meanPlddt.toFixed(1) : 'n/a'}, PAE=${m.paeStatus}, ligands=[${ligands}]`,
    );

    const topDev = [...ctx.comparison.matchedResidues]
      .sort((a, b) => b.distanceAngstrom - a.distanceAngstrom)
      .slice(0, 6);
    if (topDev.length > 0) {
      lines.push(
        `Top Cα Deviations: ${topDev
          .map(
            (r) =>
              `${r.resName3}${r.refSeqId}=${r.distanceAngstrom.toFixed(3)}Å${r.mobPlddt !== null ? `(pLDDT ${r.mobPlddt.toFixed(1)})` : ''}`,
          )
          .join(', ')}`,
      );
    }

    const contacts = ctx.comparison.refContacts ?? [];
    if (contacts.length > 0) {
      const sampleContacts = [...contacts]
        .sort((a, b) => a.distanceAngstrom - b.distanceAngstrom)
        .slice(0, 6)
        .map(
          (c) =>
            `${c.ligandResName}.${c.ligandAtom}–${c.proteinResName3}${c.proteinSeqId}.${c.proteinAtom}(${c.distanceAngstrom.toFixed(2)}Å)`,
        );
      lines.push(`Active-Site Ligand/Metal Contacts (≤4.5 Å, total=${contacts.length}): ${sampleContacts.join(', ')}`);
    }
  }

  if (ctx.peptide) {
    const p = ctx.peptide;
    lines.push(
      `Peptide: len=${p.engineered.length}, mutations=[${p.appliedMutations.map((m) => m.notation).join(',') || 'none'}], WT_MW=${p.wildType.mwAverageDa.toFixed(1)} Da, ΔMW=${p.deltas.mwAverageDa.toFixed(2)} Da, pI=${p.engineered.pi.toFixed(2)} (Δ${p.deltas.pi.toFixed(2)}), charge@7.4=${p.engineered.chargeAtPh74.toFixed(2)}, GRAVY=${p.engineered.gravy.toFixed(3)}, 3D_contacts=${p.local3dContacts.slice(0, 5).map((c) => `${c.resName3}${c.seqId}(${c.distanceAngstrom.toFixed(2)}Å)`).join(', ') || 'none'}`,
    );
  }

  if (ctx.crispr) {
    const c = ctx.crispr;
    const topPams = c.pamSites
      .slice(0, 4)
      .map((s) => `${s.nuclease}:${s.pam}(${s.strand},cut=${s.cutBp1},Δ=${s.distanceToTargetCodonBp}bp,GC=${s.gcPercent.toFixed(0)}%)`);
    lines.push(
      `CRISPR: ${c.geneSymbol} (${c.transcriptId}, ${c.cdsLengthBp} bp), codon=${c.targetCodon.codonIndex1} (${c.targetCodon.wtCodon}/${c.targetCodon.wtAa} -> ${c.targetCodon.editedCodon}/${c.targetCodon.editedAa}, ${c.targetCodon.consequence}), PAMs=${c.pamSites.length} [${topPams.join('; ')}]`,
    );
  }

  if (ctx.smiles) {
    const s = ctx.smiles;
    lines.push(
      `SMILES: ${s.name}, formula=${s.formula}, MW=${s.molecularWeight.toFixed(2)} Da, exactMass=${s.exactMass.toFixed(4)} Da, TPSA=${s.tpsa.toFixed(2)} Å², cLogP=${s.crippenLogP.toFixed(2)}, HBD=${s.hbd}, HBA=${s.hba}, rotBonds=${s.rotatableBonds}, rings=${s.ringCount}, LipinskiViol=${s.lipinskiViolations}, Veber=${s.veberCompliant ? 'pass' : 'fail'}`,
    );
  }

  if (ctx.ramachandran) {
    const r = ctx.ramachandran;
    const outliers = r.residues
      .filter((x) => x.region === 'outlier')
      .slice(0, 5)
      .map((x) => `${x.resName3}${x.seqId}(φ=${x.phiDeg?.toFixed(1) ?? 'n/a'},ψ=${x.psiDeg?.toFixed(1) ?? 'n/a'})`);
    lines.push(
      `Ramachandran: chain=${r.chainId}, residues=${r.residueCount}, H/S/L=${r.secondaryCounts.helix}/${r.secondaryCounts.sheet}/${r.secondaryCounts.loop}, favored/allowed/outlier=${r.regionCounts.favored}/${r.regionCounts.allowed}/${r.regionCounts.outlier}, contacts=${r.contactPairs.length}${outliers.length ? `, outliers=[${outliers.join(', ')}]` : ''}`,
    );
  }

  return lines.join('\n');
}

export const SYSTEM_INSTRUCTION = [
  'You are the autonomous AI scientific assistant inside Synlexa Studio, a Research-Use-Only (RUO) computational biology and chemistry IDE powered by an in-app MCP server.',
  'STRICT RULES:',
  '1. NEVER make diagnostic, therapeutic, clinical-decision, drug-efficacy, or FDA-clearance claims.',
  '2. NEVER fabricate or guess PMIDs, DOIs, ClinicalTrials.gov NCT IDs, p-values, cohorts, or structural numbers.',
  '3. Ground every quantitative statement in the live workspace summary or MCP tool execution outputs (get_workspace_state, run_structure_superposition, analyze_ramachandran, engineer_peptide_mutation, design_crispr_edit, inspect_chemical_smiles, design_molecule_rdkit, manage_project, run_workflow_pipeline, query_local_library).',
  '4. Use your tools like octopus arms: you can inspect the workspace, switch UI tabs/panels/compare modes (`control_app_ui`), organize multi-structure/ligand projects and split chains or stage binding (`manage_project`), design and score molecules (`design_molecule_rdkit`), manage plugins (`manage_plugins`), and run multi-step workflows (`run_workflow_pipeline`). Run tests across rounds to verify inside the UI.',
  '5. Before calling tools, write a brief 1-2 sentence plan/reasoning note so the user sees your thinking process step-by-step.',
  '6. If the user denies permission for an external fetch or remote GPU/workflow tool, respect the denial immediately and continue with local/offline tools or propose alternatives.',
  '7. When the user asks for recent papers, literature context, citations, or registered studies, call `search_scientific_web` and include the exact returned PMID/DOI/NCT ID and sourceUrl.',
  '8. Clearly distinguish source-observed facts, deterministic engine numbers, and model-generated synthesis.',
  '9. Always end or annotate with a concise Research-Use-Only (RUO) reminder.',
  '10. Format responses in clean, well-structured Markdown: use concise section headings (##/###), bullet or numbered lists, GFM pipe tables for multi-item comparisons or structural metrics, fenced code blocks for sequences/SMILES/commands, and [label](url) links for verified references.',
].join('\n');

interface GeminiPart {
  thought?: boolean;
  thoughtSignature?: string;
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: { result: unknown } };
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiApiResponse {
  candidates?: Array<{
    content?: {
      role?: string;
      parts?: GeminiPart[];
    };
  }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  error?: { message?: string; code?: number };
}

export interface RunGeminiTurnOptions {
  prompt: string;
  history: AgentChatMessage[];
  workspace: GeminiWorkspaceContext;
  executeTool: ToolExecutor;
  onFallbackAction?: (action: CopilotAction) => void;
  apiKey?: string;
  model?: GeminiModelId;
  fetchImpl?: typeof fetch;
  maxToolRounds?: number;
  enableWebSearch?: boolean;
  onProgress?: (steps: AgentStepTrace[]) => void;
  requestToolPermission?: (req: ToolPermissionRequest) => Promise<PermissionDecision>;
  sessionApprovedCategories?: Set<ToolPermissionCategory>;
  permissionPolicies?: ToolPermissionPolicyMap;
  /**
   * Send requests to a Gemini-compatible proxy instead of Google directly
   * (Synlexa Cloud). The body gains a `model` field and `headers` replace the
   * `x-goog-api-key` header; no API key is needed in the browser.
   */
  transport?: { endpoint: string; headers: Record<string, string> };
}

export interface ToolTraceContext {
  round: number;
  executeTool: ToolExecutor;
  requestToolPermission?: (req: ToolPermissionRequest) => Promise<PermissionDecision>;
  sessionApprovedCategories?: Set<ToolPermissionCategory>;
  permissionPolicies?: ToolPermissionPolicyMap;
  onProgress?: (steps: AgentStepTrace[]) => void;
  stepTrace: AgentStepTrace[];
  executedTools: ExecutedToolRecord[];
}

export function emitStepProgress(
  onProgress: ((steps: AgentStepTrace[]) => void) | undefined,
  stepTrace: AgentStepTrace[],
): void {
  onProgress?.(stepTrace.map((s) => ({ ...s })));
}

export function beginRoundPlanningStep(
  stepTrace: AgentStepTrace[],
  round: number,
  providerLabel: string,
  onProgress?: (steps: AgentStepTrace[]) => void,
): { step: AgentStepTrace; startedAtMs: number } {
  const startedAtMs = Date.now();
  const step: AgentStepTrace = {
    round,
    phase: 'thinking',
    title: `Reasoning (round ${round})`,
    detail: `Analyzing request with ${providerLabel}…`,
    status: 'running',
    startedAtMs,
  };
  stepTrace.push(step);
  emitStepProgress(onProgress, stepTrace);
  return { step, startedAtMs };
}

export function resolveRoundPlanningStep(
  stepTrace: AgentStepTrace[],
  planningStep: AgentStepTrace,
): void {
  const idx = stepTrace.indexOf(planningStep);
  if (idx !== -1) {
    stepTrace.splice(idx, 1);
  }
}

export function pushRoundReasoningSteps(opts: {
  stepTrace: AgentStepTrace[];
  thinkingTrace: string[];
  round: number;
  thoughts: string[];
  preToolRationale?: string;
  roundDurationMs?: number;
  thoughtTitle?: string;
}): void {
  let attachedDuration = false;
  for (const t of opts.thoughts) {
    const clean = t.trim();
    if (!clean) continue;
    opts.thinkingTrace.push(clean);
    opts.stepTrace.push({
      round: opts.round,
      phase: 'thinking',
      title: `${opts.thoughtTitle ?? 'Model reasoning'} (round ${opts.round})`,
      detail: clean,
      status: 'done',
      ...(!attachedDuration && opts.roundDurationMs ? { durationMs: opts.roundDurationMs } : {}),
    });
    attachedDuration = true;
  }
  const rationale = opts.preToolRationale?.trim();
  if (rationale) {
    opts.thinkingTrace.push(rationale);
    opts.stepTrace.push({
      round: opts.round,
      phase: 'thinking',
      title: `Pre-tool rationale (round ${opts.round})`,
      detail: rationale,
      status: 'done',
      ...(!attachedDuration && opts.roundDurationMs ? { durationMs: opts.roundDurationMs } : {}),
    });
  }
}

export async function executeAgentToolWithTrace(
  ctx: ToolTraceContext,
  toolName: GeminiToolName,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; summary: string; data: unknown }> {
  const perm = classifyToolPermission(toolName, args);
  let permissionStatus: ExecutedToolRecord['permissionStatus'] = 'auto';

  const policies = ctx.permissionPolicies ?? loadPermissionPolicies();
  const mode = policies[perm.category] ?? 'ask';

  if (ctx.sessionApprovedCategories?.has(perm.category)) {
    permissionStatus = 'allowed-session';
  } else if (mode === 'deny') {
    permissionStatus = 'denied';
    const outcome = {
      ok: false,
      summary: `Blocked by permission policy (${perm.category})`,
      data: { denied: true, category: perm.category, reason: 'Denied by Studio permission policy' },
    };
    ctx.executedTools.push({
      name: toolName,
      args,
      ok: false,
      summary: outcome.summary,
      result: outcome.data,
      durationMs: 0,
      permissionStatus,
    });
    ctx.stepTrace.push({
      round: ctx.round,
      phase: 'permission',
      title: `Blocked: ${perm.title}`,
      detail: outcome.summary,
      toolName,
      args,
      ok: false,
      status: 'error',
    });
    emitStepProgress(ctx.onProgress, ctx.stepTrace);
    return outcome;
  } else if (mode === 'ask' && ctx.requestToolPermission) {
    const permStep: AgentStepTrace = {
      round: ctx.round,
      phase: 'permission',
      title: `Permission requested: ${perm.title}`,
      detail: perm.detail,
      toolName,
      args,
      status: 'running',
      startedAtMs: Date.now(),
    };
    ctx.stepTrace.push(permStep);
    emitStepProgress(ctx.onProgress, ctx.stepTrace);

    const decision = await ctx.requestToolPermission({
      id: `perm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      toolName,
      category: perm.category,
      title: perm.title,
      detail: perm.detail,
      args,
    });

    if (decision === 'deny') {
      permissionStatus = 'denied';
      permStep.ok = false;
      permStep.status = 'error';
      permStep.detail = `${perm.detail} — Denied by user.`;
      const outcome = {
        ok: false,
        summary: `Permission denied by user for ${toolName}`,
        data: { denied: true, category: perm.category, reason: 'User denied permission' },
      };
      ctx.executedTools.push({
        name: toolName,
        args,
        ok: false,
        summary: outcome.summary,
        result: outcome.data,
        durationMs: 0,
        permissionStatus,
      });
      emitStepProgress(ctx.onProgress, ctx.stepTrace);
      return outcome;
    }

    if (decision === 'allow_session') {
      permissionStatus = 'allowed-session';
      ctx.sessionApprovedCategories?.add(perm.category);
      permStep.ok = true;
      permStep.status = 'done';
      permStep.detail = `${perm.detail} — Allowed for this session.`;
    } else {
      permissionStatus = 'allowed-once';
      permStep.ok = true;
      permStep.status = 'done';
      permStep.detail = `${perm.detail} — Allowed once.`;
    }
    emitStepProgress(ctx.onProgress, ctx.stepTrace);
  }

  const started = Date.now();
  const toolStep: AgentStepTrace = {
    round: ctx.round,
    phase: 'tool',
    title: `${toolName} · running`,
    toolName,
    args,
    status: 'running',
    startedAtMs: started,
  };
  ctx.stepTrace.push(toolStep);
  emitStepProgress(ctx.onProgress, ctx.stepTrace);

  let outcome: { ok: boolean; summary: string; data: unknown };
  try {
    outcome = await ctx.executeTool(toolName, args);
  } catch (err) {
    outcome = {
      ok: false,
      summary: err instanceof Error ? err.message : String(err),
      data: { error: err instanceof Error ? err.message : String(err) },
    };
  }
  const durationMs = Math.max(1, Date.now() - started);

  ctx.executedTools.push({
    name: toolName,
    args,
    ok: outcome.ok,
    summary: outcome.summary,
    result: outcome.data,
    durationMs,
    permissionStatus,
  });
  toolStep.phase = outcome.ok ? 'tool' : 'error';
  toolStep.title = `${toolName} · ${outcome.ok ? 'ok' : 'failed'}`;
  toolStep.detail = outcome.summary;
  toolStep.durationMs = durationMs;
  toolStep.ok = outcome.ok;
  toolStep.status = outcome.ok ? 'done' : 'error';
  emitStepProgress(ctx.onProgress, ctx.stepTrace);
  return outcome;
}

export function getActiveToolDeclarations(enableWebSearch = true): GeminiFunctionDeclaration[] {
  return enableWebSearch
    ? STUDIO_TOOL_DECLARATIONS
    : STUDIO_TOOL_DECLARATIONS.filter((t) => t.name !== 'search_scientific_web');
}

export async function runGeminiAgentTurn(
  opts: RunGeminiTurnOptions,
): Promise<AgentChatMessage> {
  const now = new Date().toISOString();
  const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const apiKey = (opts.apiKey ?? '').trim();
  const model: GeminiModelId = opts.model ?? DEFAULT_GEMINI_MODEL;
  const fetchFn = opts.fetchImpl ?? globalThis.fetch;
  const transport = opts.transport;
  const liveMode = transport ? 'synlexa-cloud' : 'gemini-api';
  const toolDeclarations = getActiveToolDeclarations(opts.enableWebSearch !== false);

  const fallback = (errorNote?: string): AgentChatMessage => {
    const res = executeCopilotCommand(opts.prompt, opts.workspace);
    if (opts.onFallbackAction) {
      for (const act of res.actions) opts.onFallbackAction(act);
    }
    const prefix = errorNote
      ? `[${transport ? 'Synlexa Cloud' : 'Gemini API'} unavailable: ${errorNote} — using local deterministic Copilot]\n`
      : '';
    const executedTools: ExecutedToolRecord[] = res.reply.actionTaken
      ? [{ name: res.reply.command ?? 'copilot', args: {}, ok: true, summary: res.reply.actionTaken, result: null, permissionStatus: 'auto' }]
      : [];
    const stepTrace: AgentStepTrace[] = executedTools.map((t, i) => ({
      round: i + 1,
      phase: 'tool',
      title: `${t.name} · ok`,
      detail: t.summary,
      toolName: String(t.name),
      ok: true,
    }));
    return {
      id,
      role: 'assistant',
      mode: 'local-deterministic-fallback',
      model: 'deterministic-copilot',
      providerLabel: 'Local Deterministic Copilot',
      text: `${prefix}${res.reply.text}`,
      citations: res.reply.citations,
      thinkingTrace: res.reply.actionTaken ? [`Matched local deterministic command: ${res.reply.actionTaken}`] : [],
      stepTrace,
      executedTools,
      timestampUtc: now,
      error: errorNote,
    };
  };

  if ((!apiKey && !transport) || typeof fetchFn !== 'function') {
    return fallback();
  }

  const contents: GeminiContent[] = [];
  for (const m of opts.history.slice(-8)) {
    contents.push({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.text }],
    });
  }
  contents.push({
    role: 'user',
    parts: [
      {
        text: `[LIVE WORKSPACE STATE]\n${buildWorkspaceSummaryText(opts.workspace)}\n\n[USER REQUEST]\n${opts.prompt}`,
      },
    ],
  });

  const executedTools: ExecutedToolRecord[] = [];
  const stepTrace: AgentStepTrace[] = [];
  const thinkingTrace: string[] = [];
  const maxRounds = Math.max(1, opts.maxToolRounds ?? 10);
  const endpoint = transport ? transport.endpoint : buildGeminiEndpoint(model);
  const headers: Record<string, string> = transport
    ? { 'Content-Type': 'application/json', ...transport.headers }
    : { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey };
  const usage = { inputTokens: 0, outputTokens: 0 };
  const turnStarted = Date.now();
  let useThinkingConfig = true;

  try {
    for (let round = 0; round < maxRounds; round++) {
      const providerTitle = transport ? 'Synlexa Cloud' : 'Gemini BYOK';
      const { step: planningStep, startedAtMs } = beginRoundPlanningStep(
        stepTrace,
        round + 1,
        providerTitle,
        opts.onProgress,
      );

      const postRound = async (includeThinking: boolean) => {
        const response = await fetchFn(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            ...(transport ? { model } : {}),
            systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
            contents,
            tools: [{ functionDeclarations: toolDeclarations }],
            generationConfig: {
              temperature: 0.2,
              ...(includeThinking ? { thinkingConfig: { includeThoughts: true } } : {}),
            },
          }),
        });
        const payload = ((await response.json().catch(() => ({}))) ?? {}) as GeminiApiResponse;
        return { response, payload };
      };

      let { response, payload } = await postRound(useThinkingConfig);
      if (
        !response.ok &&
        response.status === 400 &&
        useThinkingConfig &&
        /thinkingConfig|includeThoughts|thinking/i.test(payload.error?.message ?? '')
      ) {
        useThinkingConfig = false;
        ({ response, payload } = await postRound(false));
      }

      usage.inputTokens += payload.usageMetadata?.promptTokenCount ?? 0;
      usage.outputTokens +=
        (payload.usageMetadata?.candidatesTokenCount ?? 0) + (payload.usageMetadata?.thoughtsTokenCount ?? 0);
      if (!response.ok || payload.error) {
        resolveRoundPlanningStep(stepTrace, planningStep);
        const msg = payload.error?.message ?? `HTTP ${response.status}`;
        return fallback(msg);
      }

      const roundDurationMs = Math.max(1, Date.now() - startedAtMs);
      resolveRoundPlanningStep(stepTrace, planningStep);

      const parts = payload.candidates?.[0]?.content?.parts ?? [];
      const thoughtParts = parts
        .filter((p) => p.thought && typeof p.text === 'string' && p.text.trim().length > 0)
        .map((p) => p.text!.trim());
      const functionCalls = parts.filter((p) => p.functionCall);
      const textParts = parts
        .filter((p) => !p.thought)
        .map((p) => p.text)
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 0);

      pushRoundReasoningSteps({
        stepTrace,
        thinkingTrace,
        round: round + 1,
        thoughts: thoughtParts,
        preToolRationale: functionCalls.length > 0 ? textParts.join('\n').trim() : undefined,
        roundDurationMs,
      });

      if (functionCalls.length === 0) {
        emitStepProgress(opts.onProgress, stepTrace);
        const rawText =
          textParts.join('\n').trim() ||
          'Completed requested tools. Check the workspace panels for updated deterministic metrics.';
        const hasRuo = /research[- ]use[- ]only|\(ruo\)/i.test(rawText);
        const text = hasRuo ? rawText : `${rawText}\n\n_${RUO_DISCLAIMER}_`;
        const citations: string[] = [];
        if (opts.workspace.comparison) {
          citations.push(`resultId:${opts.workspace.comparison.resultId}`);
        }
        return {
          id,
          role: 'assistant',
          mode: liveMode,
          model,
          providerLabel: transport ? `Synlexa Cloud (${model})` : `Gemini BYOK (${model})`,
          text,
          thinkingTrace,
          stepTrace,
          executedTools,
          citations,
          timestampUtc: now,
          durationMs: Math.max(1, Date.now() - turnStarted),
          usage,
        };
      }

      emitStepProgress(opts.onProgress, stepTrace);

      contents.push({
        role: 'model',
        parts,
      });

      const responseParts: GeminiPart[] = [];
      for (const part of functionCalls) {
        const fc = part.functionCall!;
        const toolName = fc.name as GeminiToolName;
        const args = fc.args ?? {};
        const execOutcome = await executeAgentToolWithTrace(
          {
            round: round + 1,
            executeTool: opts.executeTool,
            requestToolPermission: opts.requestToolPermission,
            sessionApprovedCategories: opts.sessionApprovedCategories,
            permissionPolicies: opts.permissionPolicies,
            onProgress: opts.onProgress,
            stepTrace,
            executedTools,
          },
          toolName,
          args,
        );
        responseParts.push({
          functionResponse: {
            name: toolName,
            response: { result: execOutcome.data },
          },
        });
      }

      contents.push({
        role: 'user',
        parts: responseParts,
      });
    }

    return {
      id,
      role: 'assistant',
      mode: liveMode,
      model,
      providerLabel: transport ? `Synlexa Cloud (${model})` : `Gemini BYOK (${model})`,
      text: `Executed ${executedTools.length} tool step(s). ${RUO_DISCLAIMER}`,
      thinkingTrace,
      stepTrace,
      executedTools,
      timestampUtc: now,
      durationMs: Math.max(1, Date.now() - turnStarted),
      usage,
    };
  } catch (err) {
    return fallback(err instanceof Error ? err.message : String(err));
  }
}
