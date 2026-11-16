/**
 * One-click Quick-Start starter projects for the Antigravity-style launchpad.
 *
 * Every structure file referenced here is a pinned public fixture under
 * `/fixtures/` whose SHA-256, source URL, revision, retrieval timestamp, and
 * license live in `fixtures-manifest.json`. Nothing here is a clinical claim:
 * mutations and edits are illustrative research exercises (RUO).
 */

import type { CrisprWorkbenchState } from './workbenchReducers';

export type StarterKind = 'protein-pair' | 'chemistry-panel';

export interface StarterCrisprPreset {
  transcriptId: string;
  targetCodonIndex: number;
  baseEditOffset: CrisprWorkbenchState['baseEditOffset'];
  newBase: CrisprWorkbenchState['newBase'];
  nuclease: CrisprWorkbenchState['nuclease'];
  /** Human-readable explanation of the numbering used. */
  note: string;
}

export interface StarterPreset {
  id: string;
  kind: StarterKind;
  title: string;
  subtitle: string;
  /** Plain-English description of what the user will explore. */
  blurb: string;
  tags: string[];
  reference?: { fileName: string; chainId: string; label: string };
  mobile?: { fileName: string; chainId: string; label: string };
  paeFileName?: string;
  /** Residue (reference numbering) to focus after loading. */
  focusSeqId?: number;
  /** Peptide point mutations applied in the engineering workbench (mobile numbering). */
  peptideMutations?: string[];
  crispr?: StarterCrisprPreset;
  /** Preset id from SMILES_PRESETS to select in the chemistry workbench. */
  smilesPresetId?: string;
  /** For the chemistry panel starter. */
  smilesPanelIds?: string[];
  /** Workbench tab to open once the starter is loaded. */
  openTab?: 'sequence' | 'peptide' | 'crispr' | 'chemistry' | 'ramachandran';
}

export const STARTER_PRESETS: StarterPreset[] = [
  {
    id: 'ca2-azm',
    kind: 'protein-pair',
    title: 'Carbonic Anhydrase II',
    subtitle: '3HS4 vs AF-P00918 + Acetazolamide',
    blurb:
      'Compare a 1.1 Å crystal structure with its AlphaFold prediction, inspect the Zn²⁺ active site, and profile the co-crystallised sulfonamide ligand.',
    tags: ['Enzyme', 'Zn²⁺ pocket', 'Ligand', 'PAE'],
    reference: { fileName: '3HS4.cif', chainId: 'A', label: '3HS4.cif' },
    mobile: { fileName: 'AF-P00918-F1-model_v6.cif', chainId: 'A', label: 'AF-P00918-F1-model_v6.cif' },
    paeFileName: 'AF-P00918-F1-predicted_aligned_error_v6.json',
    focusSeqId: 94,
    peptideMutations: ['H94A'],
    crispr: {
      transcriptId: 'NM_000067.3',
      targetCodonIndex: 94,
      baseEditOffset: 0,
      newBase: 'G',
      nuclease: 'SpCas9',
      note: 'CA2 codon 94 (His94, a Zn²⁺-coordinating residue in the pinned structure).',
    },
    smilesPresetId: 'azm',
    openTab: 'sequence',
  },
  {
    id: 'ubiquitin',
    kind: 'protein-pair',
    title: 'Human Ubiquitin',
    subtitle: '1UBQ vs AF-P0CG48 (Polyubiquitin-C)',
    blurb:
      'Compare a 76-aa monomer crystal structure (1UBQ) against the 685-aa 9-repeat polyubiquitin-C AlphaFold precursor (AF-P0CG48), and inspect its β-grasp Ramachandran angles.',
    tags: ['β-grasp', 'Repeat precursor', 'Ramachandran'],
    reference: { fileName: '1UBQ.cif', chainId: 'A', label: '1UBQ.cif' },
    mobile: { fileName: 'AF-P0CG48-F1-model_v6.cif', chainId: 'A', label: 'AF-P0CG48-F1-model_v6.cif' },
    focusSeqId: 48,
    openTab: 'ramachandran',
  },
  {
    id: 'hbb-e6v',
    kind: 'protein-pair',
    title: 'Hemoglobin β',
    subtitle: '1A3N chain B vs AF-P68871 + HBB E6V edit',
    blurb:
      'Select the β subunit from a four-chain assembly, then explore the classic E6V nucleotide change (HGVS c.20A>T, p.Glu7Val with the initiator Met counted) in the CRISPR studio.',
    tags: ['Multi-chain', 'CRISPR', 'Missense'],
    reference: { fileName: '1A3N.cif', chainId: 'B', label: '1A3N.cif' },
    mobile: { fileName: 'AF-P68871-F1-model_v6.cif', chainId: 'A', label: 'AF-P68871-F1-model_v6.cif' },
    focusSeqId: 6,
    // AlphaFold/UniProt numbering includes the initiator Met, so legacy Glu6 is residue 7 here.
    peptideMutations: ['E7V'],
    crispr: {
      transcriptId: 'NM_000518.5',
      targetCodonIndex: 7,
      baseEditOffset: 1,
      newBase: 'T',
      nuclease: 'SpCas9',
      note: 'Legacy "E6V" (mature-protein numbering) = CDS codon 7, c.20A>T (GAG → GTG).',
    },
    openTab: 'crispr',
  },
  {
    id: 'lysozyme',
    kind: 'protein-pair',
    title: 'Human Lysozyme C',
    subtitle: '1LZ1 vs AF-P61626',
    blurb:
      'A mixed α/β enzyme. The prediction includes the signal peptide, so coverage shows how sequence-aware mapping handles extra residues.',
    tags: ['α/β enzyme', 'Coverage', 'Signal peptide'],
    reference: { fileName: '1LZ1.cif', chainId: 'A', label: '1LZ1.cif' },
    mobile: { fileName: 'AF-P61626-F1-model_v6.cif', chainId: 'A', label: 'AF-P61626-F1-model_v6.cif' },
    focusSeqId: 35,
    openTab: 'sequence',
  },
  {
    id: 'chem-panel',
    kind: 'chemistry-panel',
    title: 'Small-Molecule Chemistry Panel',
    subtitle: 'Imatinib · Acetazolamide · Aspirin · Caffeine',
    blurb:
      'Parse SMILES deterministically, depict 2D graphs, and read TPSA, cLogP, H-bond counts, and rule-of-five flags with plain-English badges.',
    tags: ['SMILES', 'TPSA', 'cLogP', 'Lipinski'],
    smilesPresetId: 'imatinib',
    smilesPanelIds: ['imatinib', 'azm', 'aspirin', 'caffeine'],
    openTab: 'chemistry',
  },
];

export function findStarter(id: string): StarterPreset | undefined {
  return STARTER_PRESETS.find((p) => p.id === id);
}

export interface WorkflowStep {
  id: 1 | 2 | 3 | 4;
  title: string;
  hint: string;
}

export const WORKFLOW_STEPS: WorkflowStep[] = [
  { id: 1, title: 'Pick or Fetch Molecule', hint: 'Start from a starter card, a public database, or your own file.' },
  { id: 2, title: 'Inspect 3D & Quality', hint: 'Orbit the overlay and read plain-English quality badges.' },
  { id: 3, title: 'Engineer Peptide / CRISPR / Ligand', hint: 'Try a mutation, a base edit, or a small molecule.' },
  { id: 4, title: 'Ask Gemini & Export', hint: 'Ask questions grounded in engine results, then export an RUO report.' },
];
