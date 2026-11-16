export interface ProjectStructureItem {
  id: string;
  label: string;
  role: 'reference' | 'mobile' | 'extra';
  content: string;
  paeJson?: string | null;
  sourceUrl?: string | null;
  license?: string | null;
  addedAtUtc: string;
}

export interface ProjectMoleculeItem {
  id: string;
  name: string;
  smiles: string;
  molblock2d?: string;
  note?: string;
  addedAtUtc: string;
}

export interface ProjectPeptideItem {
  id: string;
  name: string;
  sequence: string;
  mutations: string[];
  addedAtUtc: string;
}

export interface ProjectCrisprItem {
  id: string;
  name: string;
  transcriptId: string;
  targetCodonIndex: number;
  baseEditOffset: 0 | 1 | 2;
  newBase: 'A' | 'C' | 'G' | 'T';
  nuclease: 'SpCas9' | 'SaCas9' | 'Cas12a';
  addedAtUtc: string;
}

export type ProjectTemplateKind = 'blank' | 'structure-compare' | 'ligand-docking' | 'peptide-crispr';

export interface StudioProject {
  id: string;
  name: string;
  description: string;
  template: ProjectTemplateKind;
  createdAtUtc: string;
  updatedAtUtc: string;
  structures: ProjectStructureItem[];
  molecules: ProjectMoleculeItem[];
  peptides: ProjectPeptideItem[];
  crisprs: ProjectCrisprItem[];
  notes: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const LS_PROJECTS_KEY = 'synlexa.studio.projects.v1';
const LS_ACTIVE_PROJECT_KEY = 'synlexa.studio.activeProjectId.v1';

let projectsState: StudioProject[] = [];
let activeProjectId: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

export function subscribeProjects(fn: () => void): () => void {
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

function saveProjects(storage?: StorageLike) {
  const s = getStorage(storage);
  if (!s) return;
  try {
    s.setItem(LS_PROJECTS_KEY, JSON.stringify(projectsState));
    if (activeProjectId) s.setItem(LS_ACTIVE_PROJECT_KEY, activeProjectId);
  } catch {
    /* ignore storage quota */
  }
}

export function loadProjects(storage?: StorageLike): StudioProject[] {
  const s = getStorage(storage);
  if (s) {
    try {
      const raw = s.getItem(LS_PROJECTS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as StudioProject[];
        if (Array.isArray(parsed)) projectsState = parsed;
      }
      const active = s.getItem(LS_ACTIVE_PROJECT_KEY);
      if (active && projectsState.some((p) => p.id === active)) {
        activeProjectId = active;
      }
    } catch {
      /* ignore corrupt projects */
    }
  }
  if (projectsState.length === 0) {
    const def = createDefaultProjectRecord();
    projectsState = [def];
    activeProjectId = def.id;
    saveProjects(storage);
  } else if (!activeProjectId) {
    activeProjectId = projectsState[0].id;
  }
  emit();
  return [...projectsState];
}

function createDefaultProjectRecord(): StudioProject {
  const now = new Date().toISOString();
  return {
    id: 'proj-default',
    name: 'Carbonic Anhydrase II Workspace',
    description: 'Default RUO workspace for structure comparison, ligand design, peptide mutations, and CRISPR edits.',
    template: 'structure-compare',
    createdAtUtc: now,
    updatedAtUtc: now,
    structures: [],
    molecules: [
      {
        id: 'mol-azm',
        name: 'Acetazolamide (AZM)',
        smiles: 'CC(=O)Nc1nnc(S(N)(=O)=O)s1',
        note: 'Reference 3HS4 inhibitor',
        addedAtUtc: now,
      },
    ],
    peptides: [],
    crisprs: [],
    notes: '',
  };
}

export function getProjectsSnapshot(): { projects: StudioProject[]; activeProject: StudioProject | null } {
  if (projectsState.length === 0) {
    const def = createDefaultProjectRecord();
    projectsState = [def];
    activeProjectId = def.id;
  }
  const activeProject = projectsState.find((p) => p.id === activeProjectId) ?? projectsState[0] ?? null;
  return { projects: [...projectsState], activeProject };
}

export function createProject(
  input: { name: string; description?: string; template?: ProjectTemplateKind },
  storage?: StorageLike,
): StudioProject {
  const now = new Date().toISOString();
  const cleanName = input.name.trim() || `Project ${projectsState.length + 1}`;
  const proj: StudioProject = {
    id: `proj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: cleanName,
    description: input.description?.trim() || 'Multi-molecule & structural biology RUO research project.',
    template: input.template ?? 'blank',
    createdAtUtc: now,
    updatedAtUtc: now,
    structures: [],
    molecules: [],
    peptides: [],
    crisprs: [],
    notes: '',
  };
  projectsState = [proj, ...projectsState];
  activeProjectId = proj.id;
  saveProjects(storage);
  emit();
  return proj;
}

export function switchProject(projectId: string, storage?: StorageLike): StudioProject | null {
  const found = projectsState.find((p) => p.id === projectId) ?? null;
  if (!found) return null;
  activeProjectId = found.id;
  saveProjects(storage);
  emit();
  return found;
}

export function deleteProject(projectId: string, storage?: StorageLike): void {
  projectsState = projectsState.filter((p) => p.id !== projectId);
  if (projectsState.length === 0) {
    const def = createDefaultProjectRecord();
    projectsState = [def];
  }
  if (activeProjectId === projectId || !projectsState.some((p) => p.id === activeProjectId)) {
    activeProjectId = projectsState[0].id;
  }
  saveProjects(storage);
  emit();
}

function mutateActiveProject(fn: (p: StudioProject) => StudioProject, storage?: StorageLike): StudioProject {
  const snap = getProjectsSnapshot();
  const current = snap.activeProject!;
  const updated = { ...fn(current), updatedAtUtc: new Date().toISOString() };
  projectsState = projectsState.map((p) => (p.id === current.id ? updated : p));
  saveProjects(storage);
  emit();
  return updated;
}

export function addStructureToActiveProject(
  item: Omit<ProjectStructureItem, 'id' | 'addedAtUtc'>,
  storage?: StorageLike,
): ProjectStructureItem {
  const entry: ProjectStructureItem = {
    ...item,
    id: `str-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    addedAtUtc: new Date().toISOString(),
  };
  mutateActiveProject((p) => {
    const deduped = p.structures.filter((s) => !(s.label === entry.label && s.role === entry.role));
    return { ...p, structures: [entry, ...deduped].slice(0, 24) };
  }, storage);
  return entry;
}

export function addMoleculeToActiveProject(
  item: Omit<ProjectMoleculeItem, 'id' | 'addedAtUtc'>,
  storage?: StorageLike,
): ProjectMoleculeItem {
  const entry: ProjectMoleculeItem = {
    ...item,
    id: `mol-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    addedAtUtc: new Date().toISOString(),
  };
  mutateActiveProject((p) => {
    const deduped = p.molecules.filter((m) => m.smiles !== entry.smiles || m.name !== entry.name);
    return { ...p, molecules: [entry, ...deduped].slice(0, 40) };
  }, storage);
  return entry;
}

export function addPeptideToActiveProject(
  item: Omit<ProjectPeptideItem, 'id' | 'addedAtUtc'>,
  storage?: StorageLike,
): ProjectPeptideItem {
  const entry: ProjectPeptideItem = {
    ...item,
    id: `pep-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    addedAtUtc: new Date().toISOString(),
  };
  mutateActiveProject((p) => ({ ...p, peptides: [entry, ...p.peptides].slice(0, 25) }), storage);
  return entry;
}

export function addCrisprToActiveProject(
  item: Omit<ProjectCrisprItem, 'id' | 'addedAtUtc'>,
  storage?: StorageLike,
): ProjectCrisprItem {
  const entry: ProjectCrisprItem = {
    ...item,
    id: `cr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    addedAtUtc: new Date().toISOString(),
  };
  mutateActiveProject((p) => ({ ...p, crisprs: [entry, ...p.crisprs].slice(0, 25) }), storage);
  return entry;
}

export function removeProjectAsset(
  kind: 'structure' | 'molecule' | 'peptide' | 'crispr',
  assetId: string,
  storage?: StorageLike,
): void {
  mutateActiveProject((p) => {
    if (kind === 'structure') return { ...p, structures: p.structures.filter((x) => x.id !== assetId) };
    if (kind === 'molecule') return { ...p, molecules: p.molecules.filter((x) => x.id !== assetId) };
    if (kind === 'peptide') return { ...p, peptides: p.peptides.filter((x) => x.id !== assetId) };
    return { ...p, crisprs: p.crisprs.filter((x) => x.id !== assetId) };
  }, storage);
}

/**
 * Splits a PDB or basic mmCIF structure into per-chain polymer PDB chunks and
 * non-water HETATM ligand chunks so researchers can isolate, re-pair, or dock chains.
 */
export function splitStructureIntoParts(
  content: string,
  baseLabel: string,
): Array<{ label: string; kind: 'chain' | 'ligand'; chainId: string; pdbContent: string; atomCount: number }> {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const isCif = content.trimStart().startsWith('data_') || content.includes('_atom_site.');
  const stem = baseLabel.replace(/\.(cif|mmcif|pdb|ent)$/i, '');

  const chainBuckets = new Map<string, string[]>();
  const ligandBuckets = new Map<string, string[]>();

  if (!isCif) {
    for (const line of lines) {
      if (line.startsWith('ATOM  ')) {
        const chain = (line.slice(21, 22).trim() || 'A').toUpperCase();
        const arr = chainBuckets.get(chain) ?? [];
        arr.push(line);
        chainBuckets.set(chain, arr);
      } else if (line.startsWith('HETATM')) {
        const resName = line.slice(17, 20).trim().toUpperCase();
        if (resName === 'HOH' || resName === 'WAT') continue;
        const chain = (line.slice(21, 22).trim() || 'A').toUpperCase();
        const key = `${resName}_${chain}`;
        const arr = ligandBuckets.get(key) ?? [];
        arr.push(line);
        ligandBuckets.set(key, arr);
      }
    }
  } else {
    // Parse standard _atom_site loop columns into clean PDB-formatted ATOM/HETATM lines
    const cols: string[] = [];
    let inAtomLoop = false;
    let serial = 1;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (t === 'loop_') {
        cols.length = 0;
        inAtomLoop = false;
        continue;
      }
      if (t.startsWith('_atom_site.')) {
        cols.push(t.slice('_atom_site.'.length));
        inAtomLoop = true;
        continue;
      }
      if (!inAtomLoop || cols.length === 0) continue;
      if (!t || t.startsWith('#') || t.startsWith('_') || t === 'loop_') {
        if (t === 'loop_') {
          cols.length = 0;
          inAtomLoop = false;
        }
        continue;
      }
      const tokens = t.match(/(?:'[^']*'|"[^"]*"|\S+)/g);
      if (!tokens || tokens.length < cols.length) continue;
      const getCol = (name: string) => {
        const idx = cols.indexOf(name);
        return idx >= 0 ? tokens[idx].replace(/^['"]|['"]$/g, '') : '';
      };
      const group = getCol('group_PDB') || 'ATOM';
      const atomName = (getCol('auth_atom_id') || getCol('label_atom_id') || 'CA').slice(0, 4);
      const resName = (getCol('auth_comp_id') || getCol('label_comp_id') || 'UNK').slice(0, 3);
      if (resName === 'HOH' || resName === 'WAT') continue;
      const chain = (getCol('auth_asym_id') || getCol('label_asym_id') || 'A').slice(0, 1);
      const seqNum = Number.parseInt(getCol('auth_seq_id') || getCol('label_seq_id') || '1', 10) || 1;
      const x = Number.parseFloat(getCol('Cartn_x') || '0') || 0;
      const y = Number.parseFloat(getCol('Cartn_y') || '0') || 0;
      const z = Number.parseFloat(getCol('Cartn_z') || '0') || 0;
      const occ = Number.parseFloat(getCol('occupancy') || '1') || 1;
      const b = Number.parseFloat(getCol('B_iso_or_equiv') || '0') || 0;
      const elem = (getCol('type_symbol') || 'C').slice(0, 2);

      const pdbLine =
        `${group.padEnd(6, ' ')}` +
        `${String(serial++ % 100000).padStart(5, ' ')} ` +
        `${atomName.padEnd(4, ' ')} ` +
        `${resName.padStart(3, ' ')} ` +
        `${chain}` +
        `${String(seqNum % 10000).padStart(4, ' ')}    ` +
        `${x.toFixed(3).padStart(8, ' ')}` +
        `${y.toFixed(3).padStart(8, ' ')}` +
        `${z.toFixed(3).padStart(8, ' ')}` +
        `${occ.toFixed(2).padStart(6, ' ')}` +
        `${b.toFixed(2).padStart(6, ' ')}          ` +
        `${elem.padStart(2, ' ')}`;

      if (group === 'HETATM') {
        const key = `${resName}_${chain}`;
        const arr = ligandBuckets.get(key) ?? [];
        arr.push(pdbLine);
        ligandBuckets.set(key, arr);
      } else {
        const arr = chainBuckets.get(chain) ?? [];
        arr.push(pdbLine);
        chainBuckets.set(chain, arr);
      }
    }
  }

  const out: Array<{ label: string; kind: 'chain' | 'ligand'; chainId: string; pdbContent: string; atomCount: number }> = [];
  for (const [chain, bucket] of chainBuckets.entries()) {
    out.push({
      label: `${stem}_chain_${chain}.pdb`,
      kind: 'chain',
      chainId: chain,
      pdbContent: `${bucket.join('\n')}\nTER\nEND\n`,
      atomCount: bucket.length,
    });
  }
  for (const [ligKey, bucket] of ligandBuckets.entries()) {
    const chain = ligKey.split('_').pop() ?? 'A';
    out.push({
      label: `${stem}_ligand_${ligKey}.pdb`,
      kind: 'ligand',
      chainId: chain,
      pdbContent: `${bucket.join('\n')}\nEND\n`,
      atomCount: bucket.length,
    });
  }
  return out;
}

export function resetProjectsForTesting(): void {
  projectsState = [];
  activeProjectId = null;
}
