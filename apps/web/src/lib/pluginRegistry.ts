export type PluginCategory =
  | 'Molecular visualization'
  | 'Molecular modeling'
  | 'Protein structure prediction'
  | 'Protein design'
  | 'Molecular docking'
  | 'Molecular dynamics'
  | 'Quantum chemistry'
  | 'Genomics'
  | 'Structural bioinformatics'
  | 'Cheminformatics ML'
  | 'Drug discovery workflows'
  | 'Scientific workflow orchestration'
  | 'Public databases';

export type PluginTier = 'tier0-core' | 'tier1-wasm' | 'tier2-compute' | 'database';

export interface PluginMcpToolSpec {
  name: string;
  description: string;
  computeToolId?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

export interface SynlexaPluginManifest {
  schemaVersion: '1.0.0';
  id: string;
  name: string;
  version: string;
  category: PluginCategory;
  tier: PluginTier;
  license: string;
  commercialSafe: boolean;
  ruoRequired: true;
  topPick?: boolean;
  description: string;
  homepage?: string;
  computeAdapterId?: string;
  requiresGpu?: boolean;
  installHint?: string;
  mcpTools?: PluginMcpToolSpec[];
  builtin?: boolean;
}

export interface PluginStateRecord {
  enabledIds: string[];
  customPlugins: SynlexaPluginManifest[];
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const LS_PLUGINS_KEY = 'synlexa.studio.plugins.v1';

export const BUILTIN_PLUGINS: SynlexaPluginManifest[] = [
  {
    schemaVersion: '1.0.0',
    id: 'org.synlexa.molstar',
    name: 'Mol* 3D Viewer',
    version: '5.13.1',
    category: 'Molecular visualization',
    tier: 'tier1-wasm',
    license: 'MIT',
    commercialSafe: true,
    ruoRequired: true,
    topPick: true,
    builtin: true,
    description: 'Browser-native WebGL 3D macromolecular viewer for cartoon, surface, ligand, and docking box inspection.',
    homepage: 'https://github.com/molstar/molstar',
  },
  {
    schemaVersion: '1.0.0',
    id: 'org.synlexa.rdkit-wasm',
    name: 'RDKit Engine (WASM + Python 3D)',
    version: '2026.9.2',
    category: 'Molecular modeling',
    tier: 'tier1-wasm',
    license: 'BSD-3-Clause',
    commercialSafe: true,
    ruoRequired: true,
    topPick: true,
    builtin: true,
    computeAdapterId: 'rdkit_3d',
    installHint: 'Built-in WASM in browser; optional `pip install rdkit` on Compute Node for 3D ETKDGv3',
    description: 'Canonical SMILES, InChIKey, Morgan fingerprints, PAINS/Brenk alerts, 2D SVG, and ETKDGv3 conformers.',
    homepage: 'https://github.com/rdkit/rdkit',
  },
  {
    schemaVersion: '1.0.0',
    id: 'org.synlexa.openmm',
    name: 'OpenMM Molecular Dynamics',
    version: '8.1',
    category: 'Molecular dynamics',
    tier: 'tier2-compute',
    license: 'MIT / LGPL',
    commercialSafe: true,
    ruoRequired: true,
    topPick: true,
    builtin: true,
    computeAdapterId: 'openmm_md',
    installHint: 'conda install -c conda-forge openmm pdbfixer',
    description: 'GPU-accelerated programmable MD (CUDA, OpenCL, Apple Metal, CPU) and energy minimization.',
    homepage: 'https://github.com/openmm/openmm',
    mcpTools: [
      {
        name: 'run_openmm_relaxation',
        description: 'Run energy minimization / short MD relaxation on a PDB structure via connected Compute Node.',
        computeToolId: 'openmm_md',
        inputSchema: {
          type: 'object',
          properties: {
            steps: { type: 'integer', description: 'MD integration steps (0 for minimization only).' },
            temperatureK: { type: 'number', description: 'Simulation temperature in Kelvin (default 300).' },
          },
          required: [],
        },
      },
    ],
  },
  {
    schemaVersion: '1.0.0',
    id: 'org.synlexa.autodock-vina',
    name: 'AutoDock Vina / Smina',
    version: '1.2.5',
    category: 'Molecular docking',
    tier: 'tier2-compute',
    license: 'Apache-2.0',
    commercialSafe: true,
    ruoRequired: true,
    topPick: true,
    builtin: true,
    computeAdapterId: 'vina_docking',
    installHint: 'pip install vina meeko rdkit',
    description: 'Classical protein-ligand docking and binding affinity pose prediction inside a defined 3D box.',
    homepage: 'https://github.com/forlilab/AutoDock-Vina',
    mcpTools: [
      {
        name: 'run_autodock_vina',
        description: 'Dock the active SMILES ligand into the active reference protein on the connected Compute Node.',
        computeToolId: 'vina_docking',
        inputSchema: {
          type: 'object',
          properties: {
            ligandSmiles: { type: 'string', description: 'SMILES string of ligand to dock.' },
            exhaustiveness: { type: 'integer', description: 'Search exhaustiveness (default 8).' },
          },
          required: ['ligandSmiles'],
        },
      },
    ],
  },
  {
    schemaVersion: '1.0.0',
    id: 'org.synlexa.rfdiffusion',
    name: 'RFdiffusion + ProteinMPNN',
    version: '1.1',
    category: 'Protein design',
    tier: 'tier2-compute',
    license: 'BSD / MIT (check weights)',
    commercialSafe: true,
    ruoRequired: true,
    topPick: true,
    builtin: true,
    requiresGpu: true,
    computeAdapterId: 'rfdiffusion_design',
    installHint: 'Install RFdiffusion + ProteinMPNN on Colab/Docker GPU Compute Node',
    description: 'Generative de novo protein backbone scaffolds and binder design paired with inverse folding.',
    homepage: 'https://github.com/RosettaCommons/RFdiffusion',
  },
  {
    schemaVersion: '1.0.0',
    id: 'org.synlexa.gromacs',
    name: 'GROMACS HPC MD',
    version: '2024',
    category: 'Molecular dynamics',
    tier: 'tier2-compute',
    license: 'LGPL-2.1+ (external CLI)',
    commercialSafe: true,
    ruoRequired: true,
    topPick: true,
    builtin: true,
    computeAdapterId: 'gromacs_md',
    installHint: 'conda install -c conda-forge gromacs  # external user-installed CLI',
    description: 'High-throughput protein and membrane molecular dynamics executed via external `gmx` subprocess.',
    homepage: 'https://github.com/gromacs/gromacs',
  },
  {
    schemaVersion: '1.0.0',
    id: 'org.synlexa.boltz2',
    name: 'Boltz-2 Structure & Complex AI',
    version: '2.0',
    category: 'Protein structure prediction',
    tier: 'tier2-compute',
    license: 'MIT (code & weights)',
    commercialSafe: true,
    ruoRequired: true,
    topPick: true,
    builtin: true,
    requiresGpu: true,
    computeAdapterId: 'boltz_predict',
    installHint: 'pip install boltz',
    description: 'MIT-licensed biomolecular structure & protein-ligand complex prediction with confidence metrics.',
    homepage: 'https://github.com/jwohlwend/boltz',
    mcpTools: [
      {
        name: 'run_boltz2_prediction',
        description: 'Predict a protein or protein-ligand complex structure using Boltz-2 on a connected GPU node.',
        computeToolId: 'boltz_predict',
        inputSchema: {
          type: 'object',
          properties: {
            sequence: { type: 'string', description: 'Amino acid sequence for chain A.' },
            ligandSmiles: { type: 'string', description: 'Optional co-folded ligand SMILES.' },
          },
          required: ['sequence'],
        },
      },
    ],
  },
  {
    schemaVersion: '1.0.0',
    id: 'org.synlexa.pyscf',
    name: 'PySCF Quantum Chemistry',
    version: '2.6',
    category: 'Quantum chemistry',
    tier: 'tier2-compute',
    license: 'Apache-2.0',
    commercialSafe: true,
    ruoRequired: true,
    topPick: true,
    builtin: true,
    computeAdapterId: 'pyscf_qm',
    installHint: 'pip install pyscf',
    description: 'DFT/HF electronic structure, HOMO-LUMO frontier energies, and dipole analysis for small ligands.',
    homepage: 'https://github.com/pyscf/pyscf',
  },
  {
    schemaVersion: '1.0.0',
    id: 'org.synlexa.gemmi-core',
    name: 'Synlexa Bio-Core (Rust/Wasm)',
    version: '0.4.0',
    category: 'Structural bioinformatics',
    tier: 'tier0-core',
    license: 'Apache-2.0',
    commercialSafe: true,
    ruoRequired: true,
    builtin: true,
    description: 'Deterministic PDB/mmCIF parsing, Kabsch float64 superposition, Ramachandran, peptide & CRISPR engine.',
  },
  {
    schemaVersion: '1.0.0',
    id: 'org.synlexa.chemprop',
    name: 'Chemprop & DeepChem ML',
    version: '2.0',
    category: 'Cheminformatics ML',
    tier: 'tier2-compute',
    license: 'MIT',
    commercialSafe: true,
    ruoRequired: true,
    builtin: true,
    computeAdapterId: 'ml_property',
    installHint: 'pip install chemprop deepchem',
    description: 'Message-passing neural network ADMET & molecular property inference on GPU/CPU nodes.',
  },
  {
    schemaVersion: '1.0.0',
    id: 'org.synlexa.workflows',
    name: 'Nextflow & Snakemake Runner',
    version: '1.0',
    category: 'Scientific workflow orchestration',
    tier: 'tier2-compute',
    license: 'Apache-2.0 / MIT',
    commercialSafe: true,
    ruoRequired: true,
    builtin: true,
    computeAdapterId: 'workflow_runner',
    installHint: 'pip install snakemake  # or install Nextflow CLI',
    description: 'Export visual DAG pipelines as reproducible Nextflow/Snakemake scripts or execute on Compute Nodes.',
  },
  {
    schemaVersion: '1.0.0',
    id: 'org.synlexa.genomics-bio',
    name: 'Biopython / HTSlib / SeqAn3',
    version: '1.83',
    category: 'Genomics',
    tier: 'tier2-compute',
    license: 'BSD-3 / MIT',
    commercialSafe: true,
    ruoRequired: true,
    builtin: true,
    installHint: 'pip install biopython && conda install -c bioconda samtools',
    description: 'Sequence, BAM/VCF/CRAM indexing and genomic alignment utilities.',
  },
  {
    schemaVersion: '1.0.0',
    id: 'org.synlexa.chembl-opentargets',
    name: 'ChEMBL & Open Targets Connectors',
    version: '1.0',
    category: 'Public databases',
    tier: 'database',
    license: 'CC-BY-SA-3.0 / Apache-2.0',
    commercialSafe: true,
    ruoRequired: true,
    builtin: true,
    description: 'Query ChEMBL bioactive molecules/IC50s and Open Targets target-disease evidence with provenance.',
  },
  {
    schemaVersion: '1.0.0',
    id: 'org.synlexa.openbabel-external',
    name: 'Open Babel (User-Installed External)',
    version: '3.1',
    category: 'Molecular modeling',
    tier: 'tier2-compute',
    license: 'GPL-2.0-external',
    commercialSafe: false,
    ruoRequired: true,
    builtin: true,
    installHint: 'External GPL-2.0 user binary only (never bundled): conda install -c conda-forge openbabel',
    description: 'Optional external format converter when already installed by the user on a Compute Node.',
  },
];

const DEFAULT_ENABLED = BUILTIN_PLUGINS.filter((p) => p.commercialSafe).map((p) => p.id);

let enabledSet = new Set<string>(DEFAULT_ENABLED);
let customPlugins: SynlexaPluginManifest[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

export function subscribePlugins(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function getStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadPlugins(storage?: StorageLike): void {
  const s = getStorage(storage);
  if (!s) return;
  try {
    const raw = s.getItem(LS_PLUGINS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as PluginStateRecord;
    if (Array.isArray(parsed.enabledIds)) {
      enabledSet = new Set(parsed.enabledIds);
    }
    if (Array.isArray(parsed.customPlugins)) {
      customPlugins = parsed.customPlugins;
    }
  } catch {
    /* ignore corrupt store */
  }
  emit();
}

function savePlugins(storage?: StorageLike) {
  const s = getStorage(storage);
  if (!s) return;
  try {
    const payload: PluginStateRecord = {
      enabledIds: Array.from(enabledSet),
      customPlugins,
    };
    s.setItem(LS_PLUGINS_KEY, JSON.stringify(payload));
  } catch {
    /* ignore quota */
  }
}

export function listAllPlugins(): Array<SynlexaPluginManifest & { enabled: boolean }> {
  return [...BUILTIN_PLUGINS, ...customPlugins].map((p) => ({
    ...p,
    enabled: enabledSet.has(p.id),
  }));
}

export function isPluginEnabled(id: string): boolean {
  return enabledSet.has(id);
}

export function togglePlugin(id: string, enabled?: boolean, storage?: StorageLike): boolean {
  const next = enabled ?? !enabledSet.has(id);
  if (next) enabledSet.add(id);
  else enabledSet.delete(id);
  savePlugins(storage);
  emit();
  return next;
}

export function validatePluginManifest(raw: unknown): SynlexaPluginManifest {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Plugin manifest must be a JSON object.');
  }
  const obj = raw as Record<string, unknown>;
  if (obj.schemaVersion !== '1.0.0') {
    throw new Error('Plugin manifest schemaVersion must be "1.0.0".');
  }
  const id = String(obj.id ?? '').trim();
  if (!/^[a-z0-9][a-z0-9.-]{2,64}$/.test(id)) {
    throw new Error('Invalid plugin id (must be reverse-DNS lowercase, e.g. org.lab.my-tool).');
  }
  const name = String(obj.name ?? '').trim();
  const version = String(obj.version ?? '').trim();
  const license = String(obj.license ?? '').trim();
  const description = String(obj.description ?? '').trim();
  if (!name || !version || !license || !description) {
    throw new Error('Plugin manifest requires name, version, license, and description.');
  }
  if (obj.ruoRequired !== true) {
    throw new Error('All Synlexa Studio plugins must declare "ruoRequired": true.');
  }
  if (obj.homepage && !/^https?:\/\//i.test(String(obj.homepage))) {
    throw new Error('Plugin homepage must use http:// or https://');
  }

  return {
    schemaVersion: '1.0.0',
    id,
    name,
    version,
    category: (obj.category as PluginCategory) || 'Drug discovery workflows',
    tier: (obj.tier as PluginTier) || 'tier2-compute',
    license,
    commercialSafe: Boolean(obj.commercialSafe),
    ruoRequired: true,
    description,
    homepage: obj.homepage ? String(obj.homepage) : undefined,
    computeAdapterId: obj.computeAdapterId ? String(obj.computeAdapterId) : undefined,
    requiresGpu: Boolean(obj.requiresGpu),
    installHint: obj.installHint ? String(obj.installHint) : undefined,
    mcpTools: Array.isArray(obj.mcpTools) ? (obj.mcpTools as PluginMcpToolSpec[]) : undefined,
    builtin: false,
  };
}

export function installCustomPlugin(manifestJsonOrObj: string | unknown, storage?: StorageLike): SynlexaPluginManifest {
  const parsed = typeof manifestJsonOrObj === 'string' ? JSON.parse(manifestJsonOrObj) : manifestJsonOrObj;
  const manifest = validatePluginManifest(parsed);
  if (BUILTIN_PLUGINS.some((p) => p.id === manifest.id)) {
    throw new Error(`Cannot overwrite built-in plugin "${manifest.id}".`);
  }
  customPlugins = [...customPlugins.filter((p) => p.id !== manifest.id), manifest];
  enabledSet.add(manifest.id);
  savePlugins(storage);
  emit();
  return manifest;
}

export function removeCustomPlugin(id: string, storage?: StorageLike): void {
  customPlugins = customPlugins.filter((p) => p.id !== id);
  enabledSet.delete(id);
  savePlugins(storage);
  emit();
}

/** Returns MCP tool definitions contributed by currently enabled plugins when any dynamic plugin tools are installed. */
export function getEnabledPluginMcpTools(): Array<PluginMcpToolSpec & { pluginId: string }> {
  const out: Array<PluginMcpToolSpec & { pluginId: string }> = [];
  for (const p of [...BUILTIN_PLUGINS, ...customPlugins]) {
    if (!enabledSet.has(p.id) || !p.mcpTools) continue;
    for (const t of p.mcpTools) {
      out.push({ ...t, pluginId: p.id });
    }
  }
  return out;
}

export function resetPluginsForTesting(): void {
  enabledSet = new Set(DEFAULT_ENABLED);
  customPlugins = [];
}
