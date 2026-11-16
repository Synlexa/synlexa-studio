export type WorkbenchTab = 'sequence' | 'peptide' | 'crispr' | 'chemistry' | 'ramachandran';
export type UiMode = 'simple' | 'pro';
export type ActivityMode = 'structures' | 'peptides' | 'genomics' | 'chemistry' | 'history';
export type ViewportLayout = 'overlay' | 'split' | 'reference' | 'mobile';
export type RenderStyle = 'ribbon' | 'trace' | 'pocket';
export type CameraPreset = 'overview' | 'active-site' | 'n-terminus' | 'reset';

export interface PeptideWorkbenchState {
  sequence: string;
  mutationsInput: string;
  mutations: string[];
  sliceStart: number;
  sliceEnd: number;
  focusSeqId: number | null;
}

export type PeptideAction =
  | { type: 'set_sequence'; sequence: string }
  | { type: 'set_mutations_input'; raw: string }
  | { type: 'add_mutation'; notation: string }
  | { type: 'remove_mutation'; notation: string }
  | { type: 'set_slice'; start: number; end: number }
  | { type: 'focus_residue'; seqId: number | null };

export function parseMutationList(raw: string): string[] {
  return raw
    .split(/[,\s;]+/)
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[ACDEFGHIKLMNPQRSTVWY]\d+[ACDEFGHIKLMNPQRSTVWY]$/.test(s));
}

export function peptideReducer(
  state: PeptideWorkbenchState,
  action: PeptideAction,
): PeptideWorkbenchState {
  switch (action.type) {
    case 'set_sequence': {
      const clean = action.sequence.toUpperCase().replace(/[^ACDEFGHIKLMNPQRSTVWY]/g, '');
      return {
        ...state,
        sequence: clean,
        sliceStart: 1,
        sliceEnd: Math.max(1, clean.length),
      };
    }
    case 'set_mutations_input':
      return {
        ...state,
        mutationsInput: action.raw,
        mutations: parseMutationList(action.raw),
      };
    case 'add_mutation': {
      const clean = action.notation.trim().toUpperCase();
      if (!/^[ACDEFGHIKLMNPQRSTVWY]\d+[ACDEFGHIKLMNPQRSTVWY]$/.test(clean)) {
        return state;
      }
      if (state.mutations.includes(clean)) return state;
      const next = [...state.mutations, clean];
      return {
        ...state,
        mutations: next,
        mutationsInput: next.join(', '),
      };
    }
    case 'remove_mutation': {
      const next = state.mutations.filter((m) => m !== action.notation);
      return {
        ...state,
        mutations: next,
        mutationsInput: next.join(', '),
      };
    }
    case 'set_slice': {
      const maxLen = Math.max(1, state.sequence.length);
      const start = Math.max(1, Math.min(maxLen, Math.floor(action.start)));
      const end = Math.max(start, Math.min(maxLen, Math.floor(action.end)));
      return { ...state, sliceStart: start, sliceEnd: end };
    }
    case 'focus_residue':
      return { ...state, focusSeqId: action.seqId };
    default:
      return state;
  }
}

export interface CrisprWorkbenchState {
  transcriptId: string;
  customDna: string;
  useCustomDna: boolean;
  targetCodonIndex: number;
  baseEditOffset: 0 | 1 | 2;
  newBase: 'A' | 'C' | 'G' | 'T';
  nuclease: 'SpCas9' | 'SaCas9' | 'Cas12a';
}

export type CrisprAction =
  | { type: 'select_transcript'; transcriptId: string }
  | { type: 'set_custom_dna'; dna: string }
  | { type: 'toggle_custom_dna'; enabled: boolean }
  | { type: 'set_target_codon'; codonIndex: number }
  | { type: 'set_base_edit'; offset: 0 | 1 | 2; newBase: 'A' | 'C' | 'G' | 'T' }
  | { type: 'set_nuclease'; nuclease: 'SpCas9' | 'SaCas9' | 'Cas12a' };

export function crisprReducer(
  state: CrisprWorkbenchState,
  action: CrisprAction,
): CrisprWorkbenchState {
  switch (action.type) {
    case 'select_transcript':
      return {
        ...state,
        transcriptId: action.transcriptId,
        useCustomDna: false,
        targetCodonIndex: Math.max(1, state.targetCodonIndex),
      };
    case 'set_custom_dna':
      return {
        ...state,
        customDna: action.dna.toUpperCase().replace(/[^ACGT]/g, ''),
        useCustomDna: true,
      };
    case 'toggle_custom_dna':
      return { ...state, useCustomDna: action.enabled };
    case 'set_target_codon':
      return {
        ...state,
        targetCodonIndex: Math.max(1, Math.floor(action.codonIndex)),
      };
    case 'set_base_edit':
      return {
        ...state,
        baseEditOffset: action.offset,
        newBase: action.newBase,
      };
    case 'set_nuclease':
      return { ...state, nuclease: action.nuclease };
    default:
      return state;
  }
}

export interface SmilesPreset {
  id: string;
  name: string;
  smiles: string;
  note: string;
}

export const SMILES_PRESETS: SmilesPreset[] = [
  {
    id: 'azm',
    name: 'Acetazolamide (AZM · 3HS4 ligand)',
    smiles: 'CC(=O)Nc1nnc(S(N)(=O)=O)s1',
    note: 'Co-crystallized carbonic anhydrase II inhibitor in PDB 3HS4',
  },
  {
    id: 'dorzolamide',
    name: 'Dorzolamide',
    smiles: 'CCN[C@H]1C[C@@H](C)S(=O)(=O)c2sc(S(N)(=O)=O)cc12',
    note: 'Thienothiopyran sulfonamide scaffold',
  },
  {
    id: 'bsa',
    name: 'Benzene sulfonamide',
    smiles: 'NS(=O)(=O)c1ccccc1',
    note: 'Minimal arylsulfonamide zinc-binding headgroup',
  },
  {
    id: 'aspirin',
    name: 'Aspirin',
    smiles: 'CC(=O)Oc1ccccc1C(=O)O',
    note: 'Reference small-molecule carboxylate ester',
  },
  {
    id: 'caffeine',
    name: 'Caffeine',
    smiles: 'Cn1cnc2c1c(=O)n(C)c(=O)n2C',
    note: 'Purine xanthine benchmark',
  },
  {
    id: 'imatinib',
    name: 'Imatinib',
    smiles: 'CC1=C(C=C(C=C1)NC(=O)C2=CC=C(C=C2)CN3CCN(CC3)C)NC4=NC=CC(=N4)C5=CN=CC=C5',
    note: 'Phenylaminopyrimidine kinase-inhibitor scaffold (PubChem CID 5291)',
  },
];

export interface ChemistryWorkbenchState {
  selectedPresetId: string | 'custom';
  name: string;
  smiles: string;
}

export type ChemistryAction =
  | { type: 'select_preset'; presetId: string }
  | { type: 'set_custom_smiles'; smiles: string; name?: string };

export function chemistryReducer(
  state: ChemistryWorkbenchState,
  action: ChemistryAction,
): ChemistryWorkbenchState {
  switch (action.type) {
    case 'select_preset': {
      const preset = SMILES_PRESETS.find((p) => p.id === action.presetId);
      if (!preset) return state;
      return {
        selectedPresetId: preset.id,
        name: preset.name,
        smiles: preset.smiles,
      };
    }
    case 'set_custom_smiles':
      return {
        selectedPresetId: 'custom',
        name: action.name?.trim() || 'Custom SMILES',
        smiles: action.smiles.trim(),
      };
    default:
      return state;
  }
}
