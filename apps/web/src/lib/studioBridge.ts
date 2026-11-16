import type { ColorMode } from './colorPalettes';
import type { DockingBoxSpec } from './dockingBox';
import type { ProjectCrisprItem, ProjectMoleculeItem, ProjectStructureItem } from './projectsStore';
import type { RenderStyle } from './workbenchReducers';
import type { ToolTabId } from './workspaceLayout';

export interface Studio3DHighlight {
  source: string;
  seqIds: number[];
}

export interface Studio3DFocusRequest {
  seqId: number;
  nonce: number;
}

export interface CoCrystalLigandInfo {
  resName: string;
  chainId: string;
  seqId: number;
  atomCount: number;
  centroid: [number, number, number];
}

export interface StudioFocus3DOptions {
  centerCamera?: boolean;
  style?: RenderStyle;
  openViewer?: 'none' | 'activate' | 'side';
}

export interface StudioHighlight3DOptions {
  focusSeqId?: number;
  style?: RenderStyle;
  openViewer?: 'none' | 'activate' | 'side';
}

/**
 * Shared connection bridge between any workbench tab and the main 3D structure
 * viewer + active research project. All props accepting `Studio3DBridge` keep
 * it optional so standalone components and tests continue to render cleanly.
 */
export interface Studio3DBridge {
  activeProjectName: string | null;
  refLabel: string;
  refChain: string;
  mobLabel: string;
  mobChain: string;
  hasRef: boolean;
  hasMob: boolean;
  hasComparison: boolean;
  focusedSeqId: number | null;
  activeHighlight: Studio3DHighlight | null;
  projectMolecules: ProjectMoleculeItem[];
  projectStructures: ProjectStructureItem[];
  coCrystalLigands: CoCrystalLigandInfo[];
  dockingBox: DockingBoxSpec | null;
  focusIn3D: (seqId: number, opts?: StudioFocus3DOptions) => void;
  highlightIn3D: (seqIds: number[], source: string, opts?: StudioHighlight3DOptions) => void;
  clearHighlights3D: () => void;
  setStyle3D: (style: RenderStyle) => void;
  setColorMode3D: (mode: ColorMode) => void;
  openTab: (tab: ToolTabId, toSide?: boolean) => void;
  openDatabases: () => void;
  loadExample: () => void;
  saveMoleculeToProject: (payload: { name: string; smiles: string; molblock2d?: string; note?: string }) => void;
  saveMoleculeToLibrary: (payload: { name: string; smiles: string }) => void;
  savePeptideToProject: (payload: { name: string; sequence: string; mutations: string[] }) => void;
  saveCrisprToProject: (
    payload: Omit<ProjectCrisprItem, 'id' | 'addedAtUtc'>,
  ) => void;
  syncPeptideFromChain: (role: 'reference' | 'mobile') => void;
  sendMutationToPeptide: (notation: string, seqId?: number) => void;
  sendResidueToCrispr: (codonIndex: number) => void;
  sendResidueToRamachandran: (seqId: number) => void;
}
