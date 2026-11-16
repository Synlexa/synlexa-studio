export type WorkflowNodeTier = 'tier0-wasm' | 'tier1-wasm' | 'tier2-gpu';

export type WorkflowNodeKind =
  | 'load_structures'
  | 'kabsch_compare'
  | 'rdkit_prep'
  | 'vina_docking'
  | 'openmm_md'
  | 'boltz_predict'
  | 'rfdiffusion_design'
  | 'pyscf_qm'
  | 'export_report';

export interface WorkflowNodeSpec {
  kind: WorkflowNodeKind;
  label: string;
  tier: WorkflowNodeTier;
  toolName: string;
  computeAdapterId?: string;
  inputPort: string;
  outputPort: string;
  defaultParams: Record<string, unknown>;
}

export const WORKFLOW_NODE_CATALOG: Record<WorkflowNodeKind, WorkflowNodeSpec> = {
  load_structures: {
    kind: 'load_structures',
    label: 'Workspace Inputs',
    tier: 'tier0-wasm',
    toolName: 'synlexa-bio-core',
    inputPort: 'files',
    outputPort: 'Structure + SMILES',
    defaultParams: { useActiveWorkspace: true },
  },
  kabsch_compare: {
    kind: 'kabsch_compare',
    label: 'Kabsch 3D Superpose',
    tier: 'tier0-wasm',
    toolName: 'synlexa_bio_core.wasm',
    inputPort: 'Ref + Mob CIF/PDB',
    outputPort: 'ComparisonResultV1',
    defaultParams: {},
  },
  rdkit_prep: {
    kind: 'rdkit_prep',
    label: 'RDKit Prep & PAINS',
    tier: 'tier1-wasm',
    toolName: '@rdkit/rdkit WASM',
    inputPort: 'SMILES / MOL',
    outputPort: 'Canonical Ligand + Alerts',
    defaultParams: {},
  },
  vina_docking: {
    kind: 'vina_docking',
    label: 'AutoDock Vina Docking',
    tier: 'tier2-gpu',
    toolName: 'AutoDock Vina (Apache-2.0)',
    computeAdapterId: 'vina_docking',
    inputPort: 'Receptor + Ligand',
    outputPort: 'Docked Poses (.pdbqt)',
    defaultParams: { exhaustiveness: 8, numModes: 9 },
  },
  openmm_md: {
    kind: 'openmm_md',
    label: 'OpenMM Relaxation / MD',
    tier: 'tier2-gpu',
    toolName: 'OpenMM (MIT/LGPL)',
    computeAdapterId: 'openmm_md',
    inputPort: 'PDB Complex',
    outputPort: 'Minimized PDB + Trajectory',
    defaultParams: { steps: 1000, temperatureK: 300 },
  },
  boltz_predict: {
    kind: 'boltz_predict',
    label: 'Boltz-2 Complex AI',
    tier: 'tier2-gpu',
    toolName: 'Boltz-2 (MIT)',
    computeAdapterId: 'boltz_predict',
    inputPort: 'Sequence + Ligand',
    outputPort: 'Predicted CIF + pLDDT',
    defaultParams: { useMsaServer: true },
  },
  rfdiffusion_design: {
    kind: 'rfdiffusion_design',
    label: 'RFdiffusion + ProteinMPNN',
    tier: 'tier2-gpu',
    toolName: 'RFdiffusion (BSD/MIT)',
    computeAdapterId: 'rfdiffusion_design',
    inputPort: 'Target PDB + Hotspots',
    outputPort: 'Designed Backbones (.pdb)',
    defaultParams: { contigs: '[A1-60/0 50-70]', numDesigns: 2 },
  },
  pyscf_qm: {
    kind: 'pyscf_qm',
    label: 'PySCF DFT Orbitals',
    tier: 'tier2-gpu',
    toolName: 'PySCF (Apache-2.0)',
    computeAdapterId: 'pyscf_qm',
    inputPort: 'Ligand SMILES / XYZ',
    outputPort: 'HOMO/LUMO & Dipole',
    defaultParams: { functional: 'B3LYP', basis: 'sto-3g' },
  },
  export_report: {
    kind: 'export_report',
    label: 'RUO Provenance Report',
    tier: 'tier0-wasm',
    toolName: 'reportGenerator',
    inputPort: 'Verified Metrics',
    outputPort: 'HTML + JSON Manifest',
    defaultParams: { format: 'json' },
  },
};

export interface WorkflowNode {
  id: string;
  kind: WorkflowNodeKind;
  x: number;
  y: number;
  params: Record<string, unknown>;
}

export interface WorkflowEdge {
  id: string;
  from: string;
  to: string;
}

export interface WorkflowGraph {
  schemaVersion: '1.0.0';
  id: string;
  name: string;
  ruoNotice: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface WorkflowNodeRunStatus {
  status: 'idle' | 'running' | 'completed' | 'failed';
  summary?: string;
  error?: string;
  metrics?: Record<string, unknown>;
}

const RUO_HEADER =
  'Research-Use-Only (RUO). Computational estimates only; not for diagnostic or clinical decisions.';

export const WORKFLOW_TEMPLATES: WorkflowGraph[] = [
  {
    schemaVersion: '1.0.0',
    id: 'tpl-hit-to-lead',
    name: 'Hit-to-Lead Docking + OpenMM MD',
    ruoNotice: RUO_HEADER,
    nodes: [
      { id: 'n1', kind: 'load_structures', x: 30, y: 110, params: { useActiveWorkspace: true } },
      { id: 'n2', kind: 'rdkit_prep', x: 255, y: 40, params: {} },
      { id: 'n3', kind: 'kabsch_compare', x: 255, y: 185, params: {} },
      { id: 'n4', kind: 'vina_docking', x: 485, y: 110, params: { exhaustiveness: 8, numModes: 9 } },
      { id: 'n5', kind: 'openmm_md', x: 715, y: 110, params: { steps: 1000, temperatureK: 300 } },
      { id: 'n6', kind: 'export_report', x: 945, y: 110, params: { format: 'json' } },
    ],
    edges: [
      { id: 'e1', from: 'n1', to: 'n2' },
      { id: 'e2', from: 'n1', to: 'n3' },
      { id: 'e3', from: 'n2', to: 'n4' },
      { id: 'e4', from: 'n3', to: 'n4' },
      { id: 'e5', from: 'n4', to: 'n5' },
      { id: 'e6', from: 'n5', to: 'n6' },
    ],
  },
  {
    schemaVersion: '1.0.0',
    id: 'tpl-binder-design',
    name: 'De Novo Binder: RFdiffusion → Boltz-2',
    ruoNotice: RUO_HEADER,
    nodes: [
      { id: 'n1', kind: 'load_structures', x: 40, y: 110, params: { useActiveWorkspace: true } },
      { id: 'n2', kind: 'rfdiffusion_design', x: 290, y: 110, params: { contigs: '[A1-60/0 50-70]', numDesigns: 2 } },
      { id: 'n3', kind: 'boltz_predict', x: 550, y: 110, params: { useMsaServer: true } },
      { id: 'n4', kind: 'export_report', x: 810, y: 110, params: { format: 'json' } },
    ],
    edges: [
      { id: 'e1', from: 'n1', to: 'n2' },
      { id: 'e2', from: 'n2', to: 'n3' },
      { id: 'e3', from: 'n3', to: 'n4' },
    ],
  },
  {
    schemaVersion: '1.0.0',
    id: 'tpl-quantum-ligand',
    name: 'Quantum Ligand Audit: RDKit → PySCF',
    ruoNotice: RUO_HEADER,
    nodes: [
      { id: 'n1', kind: 'load_structures', x: 40, y: 110, params: { useActiveWorkspace: true } },
      { id: 'n2', kind: 'rdkit_prep', x: 290, y: 110, params: {} },
      { id: 'n3', kind: 'pyscf_qm', x: 550, y: 110, params: { functional: 'B3LYP', basis: 'sto-3g' } },
      { id: 'n4', kind: 'export_report', x: 810, y: 110, params: { format: 'json' } },
    ],
    edges: [
      { id: 'e1', from: 'n1', to: 'n2' },
      { id: 'e2', from: 'n2', to: 'n3' },
      { id: 'e3', from: 'n3', to: 'n4' },
    ],
  },
  {
    schemaVersion: '1.0.0',
    id: 'tpl-structure-audit',
    name: 'Offline Structure Audit (Wasm Only)',
    ruoNotice: RUO_HEADER,
    nodes: [
      { id: 'n1', kind: 'load_structures', x: 40, y: 110, params: { useActiveWorkspace: true } },
      { id: 'n2', kind: 'kabsch_compare', x: 300, y: 110, params: {} },
      { id: 'n3', kind: 'rdkit_prep', x: 560, y: 110, params: {} },
      { id: 'n4', kind: 'export_report', x: 820, y: 110, params: { format: 'json' } },
    ],
    edges: [
      { id: 'e1', from: 'n1', to: 'n2' },
      { id: 'e2', from: 'n2', to: 'n3' },
      { id: 'e3', from: 'n3', to: 'n4' },
    ],
  },
];

export function topologicalSortWorkflow(graph: WorkflowGraph): WorkflowNode[] {
  const nodeMap = new Map<string, WorkflowNode>();
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const n of graph.nodes) {
    nodeMap.set(n.id, n);
    inDegree.set(n.id, 0);
    adj.set(n.id, []);
  }

  for (const e of graph.edges) {
    if (!nodeMap.has(e.from) || !nodeMap.has(e.to)) {
      throw new Error(`Edge ${e.id} references unknown node.`);
    }
    if (e.from === e.to) {
      throw new Error(`Self-loop detected on node ${e.from}.`);
    }
    adj.get(e.from)!.push(e.to);
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) queue.push(id);
  }

  const ordered: WorkflowNode[] = [];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    ordered.push(nodeMap.get(cur)!);
    for (const nxt of adj.get(cur) ?? []) {
      const d = (inDegree.get(nxt) ?? 0) - 1;
      inDegree.set(nxt, d);
      if (d === 0) queue.push(nxt);
    }
  }

  if (ordered.length !== graph.nodes.length) {
    throw new Error('Workflow graph contains a cycle; DAG execution requires acyclic edges.');
  }
  return ordered;
}

export function exportWorkflowToNextflow(graph: WorkflowGraph): string {
  const ordered = topologicalSortWorkflow(graph);
  const procs = ordered.map((n, idx) => {
    const spec = WORKFLOW_NODE_CATALOG[n.kind];
    const safeName = `${n.kind}_${idx + 1}`.toUpperCase();
    return `process ${safeName} {
  tag "${spec.label}"
  input:
    val prev_meta
  output:
    path "${n.id}_output.json"
  script:
  """
  echo '{"node":"${n.id}","kind":"${n.kind}","tool":"${spec.toolName}","ruo":true}' > ${n.id}_output.json
  """
}`;
  });

  const calls = ordered.map((n, idx) => {
    const safeName = `${n.kind}_${idx + 1}`.toUpperCase();
    return idx === 0 ? `  ch_0 = ${safeName}(Channel.of("init"))` : `  ch_${idx} = ${safeName}(ch_${idx - 1})`;
  });

  return `#!/usr/bin/env nextflow
// Synlexa Studio Exported Pipeline: ${graph.name}
// ${RUO_HEADER}
nextflow.enable.dsl=2

${procs.join('\n\n')}

workflow {
${calls.join('\n')}
}
`;
}

export function exportWorkflowToSnakemake(graph: WorkflowGraph): string {
  const ordered = topologicalSortWorkflow(graph);
  const finalOut = ordered.length > 0 ? `${ordered[ordered.length - 1].id}_output.json` : 'pipeline_done.json';
  const rules = ordered.map((n, idx) => {
    const spec = WORKFLOW_NODE_CATALOG[n.kind];
    const inp = idx === 0 ? '' : `\n    input:\n        "${ordered[idx - 1].id}_output.json"`;
    return `rule step_${idx + 1}_${n.kind}:${inp}
    output:
        "${n.id}_output.json"
    message:
        "Running ${spec.label} (${spec.toolName})"
    shell:
        """echo '{{"node": "${n.id}", "kind": "${n.kind}", "ruo": true}}' > {output}"""`;
  });

  return `# Synlexa Studio Exported Snakefile: ${graph.name}
# ${RUO_HEADER}

rule all:
    input:
        "${finalOut}"

${rules.join('\n\n')}
`;
}
