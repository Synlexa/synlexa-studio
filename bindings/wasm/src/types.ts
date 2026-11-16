export type EngineTarget = 'native-rust' | 'wasm-rust' | 'native-cpp';

export type ConfidenceKind = 'experimental_b_factor' | 'prediction_plddt' | 'none';

export type CoverageDenominatorKind = 'declared_polymer_sequence' | 'coordinate_only';

export type PaeStatus = 'valid' | 'missing' | 'incompatible_shape';

export interface CoverageRecord {
  numerator: number;
  denominator: number;
  denominatorKind: CoverageDenominatorKind;
  ratio: number;
}

export interface StructureInputRecord {
  label: string;
  chainId: string;
  authChainId: string | null;
  modelIndex: number;
  sha256: string;
  confidenceKind: ConfidenceKind;
  sourceUrl: string | null;
  dataRevision: string | null;
  retrievedAtUtc: string | null;
  license: string | null;
}

export interface MatchedResidueRecord {
  refSeqId: number;
  refInsCode: string;
  mobSeqId: number;
  mobInsCode: string;
  resName3: string;
  resCode1: string;
  distanceAngstrom: number;
  refBFactor: number | null;
  mobPlddt: number | null;
}

export interface ComparisonResultV1 {
  schemaVersion: '1.0.0';
  ruoNotice: string;
  resultId: string;
  engine: {
    name: string;
    version: string;
    target: EngineTarget;
    floatPrecision: 'float64';
  };
  createdAtUtc: string;
  reference: StructureInputRecord;
  mobile: StructureInputRecord;
  metrics: {
    matchedCaCount: number;
    rmsdAngstrom: number;
    units: 'angstrom';
    refCoverage: CoverageRecord;
    mobCoverage: CoverageRecord;
    paeStatus: PaeStatus;
  };
  transform: {
    direction: 'mobile_to_reference';
    matrixRowMajor4x4: number[];
  };
  matchedResidues: MatchedResidueRecord[];
}

export type BioCoreOp =
  | 'inspect_structure'
  | 'compare_structures'
  | 'analyze_peptide'
  | 'analyze_gene_crispr'
  | 'analyze_molecule_smiles'
  | 'analyze_ramachandran';

export type BioCoreErrorCode =
  | 'ERR_AMBIGUOUS_CHAIN'
  | 'ERR_OVERSIZED_INPUT'
  | 'ERR_MALFORMED_STRUCTURE'
  | 'ERR_NO_COORDINATES'
  | 'ERR_INVALID_SMILES'
  | 'ERR_INVALID_INPUT';

export interface BioCoreError {
  code: BioCoreErrorCode | string;
  message: string;
  details?: Record<string, unknown>;
}

export type BioCoreResponse<T> =
  | {
      ok: true;
      op: BioCoreOp | string;
      data: T;
      error: null;
    }
  | {
      ok: false;
      op: BioCoreOp | string;
      data: null;
      error: BioCoreError;
    };

export interface StructureInputMeta {
  sourceTypeHint?: 'experimental' | 'prediction' | 'auto';
  sourceUrl?: string;
  dataRevision?: string;
  retrievedAtUtc?: string;
  license?: string;
}

export interface InspectStructureRequest extends StructureInputMeta {
  label: string;
  content: string;
}

export interface InspectResidue {
  seqId: number;
  insCode: string;
  resName3: string;
  resCode1: string;
  ca: [number, number, number] | null;
  bOrPlddt: number | null;
}

export interface InspectChain {
  chainId: string;
  authChainId: string;
  observedCaCount: number;
  declaredSeqLength: number | null;
  denominatorKind: CoverageDenominatorKind;
  sequence1Letter: string;
  hasAltLocs: boolean;
  hasInsertionCodes: boolean;
  residues: InspectResidue[];
}

export interface InspectLigandAtom {
  name: string;
  element: string;
  xyz: [number, number, number];
}

export interface InspectLigand {
  resName: string;
  chainId: string;
  seqId: number;
  atoms: InspectLigandAtom[];
}

export interface InspectStructureResult {
  sha256: string;
  format: 'mmcif' | 'pdb';
  modelIndex: number;
  confidenceKind: ConfidenceKind;
  chains: InspectChain[];
  ligands: InspectLigand[];
}

export interface CompareStructuresRequest {
  refLabel: string;
  refContent: string;
  refChain?: string;
  refMeta?: StructureInputMeta;
  mobLabel: string;
  mobContent: string;
  mobChain?: string;
  mobMeta?: StructureInputMeta;
  paeJson?: string;
}

export interface RefDisplayResidue {
  seqId: number;
  insCode: string;
  resName3: string;
  resCode1: string;
  ca: [number, number, number];
  bFactor: number | null;
}

export interface RefPocketAtom {
  seqId: number;
  resName3: string;
  atomName: string;
  element: string;
  xyz: [number, number, number];
}

export interface RefDisplayAtoms {
  ca: Array<[number, number, number]>;
  residues: RefDisplayResidue[];
  ligands: InspectLigand[];
  pocketAtoms: RefPocketAtom[];
}

export interface MobTransformedResidue {
  seqId: number;
  insCode: string;
  resName3: string;
  resCode1: string;
  xyz: [number, number, number];
  plddt: number | null;
}

export interface RefContactRecord {
  ligandResName: string;
  ligandChainId: string;
  ligandSeqId: number;
  ligandAtom: string;
  proteinSeqId: number;
  proteinResName3: string;
  proteinAtom: string;
  distanceAngstrom: number;
}

export interface PaeMatrixSummary {
  status: PaeStatus;
  size: number;
  maxPae: number | null;
}

export interface CompareStructuresResult extends ComparisonResultV1 {
  refDisplayAtoms?: RefDisplayAtoms;
  mobTransformedCa?: Array<[number, number, number]>;
  mobTransformedResidues?: MobTransformedResidue[];
  refContacts?: RefContactRecord[];
  paeMatrixSummary?: PaeMatrixSummary;
}

export interface AnalyzePeptideRequest {
  sequence: string;
  mutations?: string[];
  sliceStart?: number;
  sliceEnd?: number;
  structureContent?: string;
  chainId?: string;
  focusSeqId?: number;
}

export interface PeptideDescriptors {
  sequence: string;
  length: number;
  mwAverageDa: number;
  mwMonoisotopicDa: number;
  pi: number;
  chargeAtPh74: number;
  gravy: number;
  extinctionReduced: number;
  extinctionCystine: number;
  stericVolumeA3: number;
  aromaticFraction: number;
  hydrophobicFraction: number;
}

export interface AnalyzePeptideResult {
  ruoNotice: string;
  wildType: PeptideDescriptors;
  engineered: PeptideDescriptors;
  deltas: {
    mwAverageDa: number;
    mwMonoisotopicDa: number;
    pi: number;
    chargeAtPh74: number;
    gravy: number;
    stericVolumeDeltaA3: number;
  };
  titrationCurve: Array<{
    ph: number;
    wtCharge: number;
    engCharge: number;
  }>;
  gravyProfile: Array<{
    index: number;
    res: string;
    wtScore: number;
    engScore: number;
  }>;
  appliedMutations: Array<{
    notation: string;
    pos: number;
    from: string;
    to: string;
    notes: string[];
  }>;
  local3dContacts: Array<{
    seqId: number;
    resName3: string;
    distanceAngstrom: number;
  }>;
}

export interface AnalyzeGeneCrisprRequest {
  transcriptId?: string;
  codingDna?: string;
  targetCodonIndex: number;
  baseEditIndex?: number;
  newBase?: 'A' | 'C' | 'G' | 'T';
  nuclease?: 'SpCas9' | 'SaCas9' | 'Cas12a';
}

export interface CrisprPamSite {
  nuclease: string;
  pam: string;
  strand: '+' | '-';
  protospacer: string;
  cutBp1: number;
  distanceToTargetCodonBp: number;
  gcPercent: number;
  hasPolyT: boolean;
}

export interface AnalyzeGeneCrisprResult {
  ruoNotice: string;
  transcriptId: string;
  geneSymbol: string;
  assembly: string;
  cdsLengthBp: number;
  proteinLengthAa: number;
  codingDna?: string;
  targetCodon: {
    codonIndex1: number;
    dnaStartBp1: number;
    wtCodon: string;
    wtAa: string;
    editedCodon: string;
    editedAa: string;
    consequence: 'synonymous' | 'missense' | 'nonsense' | 'unchanged';
  };
  pamSites: CrisprPamSite[];
}

export interface AnalyzeMoleculeSmilesRequest {
  name?: string;
  smiles: string;
}

export interface MoleculeLayoutAtom {
  id: number;
  element: string;
  charge: number;
  aromatic: boolean;
  x: number;
  y: number;
}

export interface MoleculeLayoutBond {
  from: number;
  to: number;
  order: 1 | 2 | 3 | 4;
}

export interface AnalyzeMoleculeSmilesResult {
  ruoNotice: string;
  name: string;
  smiles: string;
  formula: string;
  molecularWeight: number;
  exactMass: number;
  heavyAtomCount: number;
  ringCount: number;
  aromaticAtomCount: number;
  hbd: number;
  hba: number;
  rotatableBonds: number;
  tpsa: number;
  crippenLogP: number;
  lipinskiViolations: number;
  veberCompliant: boolean;
  layout2d: {
    atoms: MoleculeLayoutAtom[];
    bonds: MoleculeLayoutBond[];
  };
}

export type RamachandranSecondary = 'helix' | 'sheet' | 'loop';

export type RamachandranRegion = 'favored' | 'allowed' | 'outlier' | 'terminal';

export interface AnalyzeRamachandranRequest {
  content: string;
  chainId?: string;
}

export interface RamachandranResidue {
  seqId: number;
  insCode: string;
  resName3: string;
  resCode1: string;
  phiDeg: number | null;
  psiDeg: number | null;
  secondary: RamachandranSecondary;
  region: RamachandranRegion;
}

export interface AnalyzeRamachandranResult {
  ruoNotice: string;
  chainId: string;
  authChainId: string;
  format: 'mmcif' | 'pdb';
  residueCount: number;
  residues: RamachandranResidue[];
  secondaryCounts: {
    helix: number;
    sheet: number;
    loop: number;
  };
  regionCounts: {
    favored: number;
    allowed: number;
    outlier: number;
  };
  contactPairs: Array<[number, number, number]>;
}

export interface WasmBioCoreExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  dealloc(ptr: number, len: number): void;
  abi_version(): number;
  last_result_len(): number;
  invoke_json(reqPtr: number, reqLen: number): number;
  extract_ca_coords_f64(
    reqPtr: number,
    reqLen: number,
    outPtr: number,
    maxAtoms: number,
  ): number;
}
