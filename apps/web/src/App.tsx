import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Activity,
  Atom,
  Bot,
  Box,
  Cpu,
  Dna,
  GitBranch,
  GitCompareArrows,
  Home,
  Layers,
  Library,
  Maximize2,
  Puzzle,
  Scissors,
  Server,
} from 'lucide-react';
import type {
  AnalyzeGeneCrisprResult,
  AnalyzeMoleculeSmilesResult,
  AnalyzePeptideResult,
  AnalyzeRamachandranResult,
  CompareStructuresResult,
  InspectStructureResult,
  StructureInputMeta,
} from '@synlexa/wasm-bridge';
import {
  BioEngineClient,
  BioEngineOperationError,
  CancelledRunError,
  loadPinnedFixtureFile,
  loadPinnedFixtures,
  loadPinnedManifest,
  type FixtureManifestEntry,
} from './lib/bioEngineClient';
import type { ColorMode } from './lib/colorPalettes';
import type { CopilotAction } from './lib/copilotEngine';
import {
  importCompoundRecord,
  importStructureRecord,
  searchDatabase,
  type DbSource,
  type ImportedCompound,
  type ImportedStructure,
} from './lib/databaseConnector';
import type {
  AgentChatMessage,
  AgentStepTrace,
  GeminiToolName,
  GeminiWorkspaceContext,
} from './lib/geminiAgent';
import {
  AI_PROVIDERS,
  loadAiConfig,
  resolveActiveAiRoute,
  runAssistantTurn,
  saveAiConfig,
  type AiConfig,
  type AiProviderId,
} from './lib/aiProviders';
import { initSecureVault } from './lib/secureKeyVault';
import {
  getComputeSnapshot,
  loadComputeNodes,
  submitComputeJob,
  subscribeComputeState,
  waitForComputeJob,
} from './lib/computeBridge';
import { computeDockingBox } from './lib/dockingBox';
import { listAllPlugins, loadPlugins, togglePlugin } from './lib/pluginRegistry';
import {
  addMoleculeToActiveProject,
  addStructureToActiveProject,
  createProject,
  deleteProject,
  getProjectsSnapshot,
  loadProjects,
  removeProjectAsset,
  splitStructureIntoParts,
  subscribeProjects,
  switchProject,
  addPeptideToActiveProject,
  addCrisprToActiveProject,
  type ProjectMoleculeItem,
  type ProjectStructureItem,
  type ProjectTemplateKind,
} from './lib/projectsStore';
import {
  loadPermissionPolicies,
  type PermissionDecision,
  type ToolPermissionCategory,
  type ToolPermissionPolicyMap,
  type ToolPermissionRequest,
} from './lib/toolPermissions';
import { getSharedRdkitClient } from './lib/rdkitClient';
import {
  exportWorkflowToNextflow,
  exportWorkflowToSnakemake,
  topologicalSortWorkflow,
  WORKFLOW_TEMPLATES,
  type WorkflowNodeKind,
} from './lib/workflowEngine';
import type { MolStarExtraOverlay } from './components/MolStarViewport';
import {
  buildWorkspaceTelemetrySnapshot,
  invokeMcpTool,
  type McpServerRuntime,
} from './lib/mcpServer';
import { searchScientificWeb, type WebSearchScope } from './lib/webSearchConnector';
import { applyUiScale, stepUiScale, useAppSettings } from './lib/appSettings';
import {
  addToLibrary,
  listLibrary,
  subscribeLibrary,
  updateLibraryItem,
  type LibraryItem,
  type NewLibraryItem,
} from './lib/moleculeLibrary';
import { createProjectBundle, parseAndValidateProjectBundle } from './lib/projectBundle';
import { buildRuoJsonManifest, generateRuoHtmlReport } from './lib/reportGenerator';
import { clearRunHistory, loadRunHistory, saveRunHistoryEntry, type RunHistoryEntry } from './lib/runHistory';
import { findStarter, type StarterPreset } from './lib/starterPresets';
import {
  beginStudioAuth,
  clearPendingStudioAuth,
  clearPopupActiveMarker,
  completeStudioAuth,
  consumeWebCallbackFromLocation,
  isDesktopShell,
  loadStudioSession,
  openSignInPopup,
  openStudioConnectUrl,
  STUDIO_AUTH_SESSION_KEY,
  subscribeDesktopDeepLink,
  subscribePopupCallback,
  type StudioAuthMode,
  type StudioSession,
} from './lib/studioAuth';
import {
  chemistryReducer,
  crisprReducer,
  peptideReducer,
  SMILES_PRESETS,
  type RenderStyle,
  type ViewportLayout,
} from './lib/workbenchReducers';
import { layoutReducer, loadLayout, saveLayout, type ToolTabId } from './lib/workspaceLayout';
import { installZoomLock } from './lib/zoomLock';
import { AssistantView } from './components/AssistantView';
import { ChemistryWorkbench } from './components/ChemistryWorkbench';
import { CommandPalette, type PaletteCommand } from './components/CommandPalette';
import { ComputeNodesView } from './components/ComputeNodesView';
import { CrisprWorkbench } from './components/CrisprWorkbench';
import { DatabaseExplorerModal } from './components/DatabaseExplorerModal';
import { HomeView } from './components/HomeView';
import { LibraryView, type LibraryOpenTarget } from './components/LibraryView';
import { McpServerView } from './components/McpServerView';
import { MolecularViewport, type MolecularViewportHandle } from './components/MolecularViewport';
import { PeptideWorkbench } from './components/PeptideWorkbench';
import { PluginsView } from './components/PluginsView';
import { RamachandranPanel } from './components/RamachandranPanel';
import { ResultsView } from './components/ResultsView';
import { SequenceDeviationTrack } from './components/SequenceDeviationTrack';
import { SettingsDialog, type SettingsSection } from './components/SettingsView';
import { TutorialGuideModal, type TutorialStep } from './components/TutorialGuideModal';
import { WorkflowCanvas } from './components/WorkflowCanvas';

const MolStarViewportLazy = lazy(() =>
  import('./components/MolStarViewport').then((m) => ({ default: m.MolStarViewport })),
);
import { EditorArea, type TabMeta } from './components/workspace/EditorArea';
import {
  ActivityRail,
  ExplorerPanel,
  HistoryPanel,
  SidebarFrame,
  StatusBar,
  TitleBar,
  ToolsPanel,
  type SidebarView,
} from './components/workspace/Shell';
import { IconButton, useFeedback } from './components/ui';

const P00918_DEFAULT_SEQ =
  'MSHHWGYGKHNGPEHWHKDFPIAKGERQSPVDIDTHTAKYDPSLKPLSVSYDQATSLRILNNGHAFNVEFDDSQDKAVLKGGPLDGTYRLIQFHFHWGSLDGQGSEHTVDKKKYAAELHLVHWNTKYGDFGKAVQQPDGLAVLGIFLKVGSAKPGLQKVVDVLDSIKTKGKSADFTNFDPRGLLPESLDYWTYPGSLTTPPLLECVTWIVLKEPISVSSEQVLKFRKLNFNGEGEPEELMVDNWRPAQPLKNRQIKASFK';

const KEEP_ALIVE: ReadonlySet<ToolTabId> = new Set(['viewer']);

function triggerDownload(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function metaFromManifest(entry?: FixtureManifestEntry): StructureInputMeta {
  if (!entry) return { sourceTypeHint: 'auto' };
  return {
    sourceTypeHint:
      entry.confidenceKind === 'experimental_b_factor'
        ? 'experimental'
        : entry.confidenceKind === 'prediction_plddt'
          ? 'prediction'
          : 'auto',
    sourceUrl: entry.sourceUrl,
    dataRevision: entry.dataRevision,
    retrievedAtUtc: entry.retrievedAtUtc,
    license: entry.license,
  };
}

function databaseFromUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).host;
    if (host.includes('rcsb')) return 'RCSB PDB';
    if (host.includes('alphafold')) return 'AlphaFold DB';
    if (host.includes('uniprot')) return 'UniProtKB';
    if (host.includes('pubchem') || host.includes('ncbi')) return 'PubChem';
    return host;
  } catch {
    return null;
  }
}

function stripExt(name: string): string {
  return name.replace(/\.(cif|mmcif|pdb|ent)$/i, '');
}

type CompareParams = {
  rLabel: string;
  rContent: string;
  rChain: string;
  rMeta: StructureInputMeta;
  mLabel: string;
  mContent: string;
  mChain: string;
  mMeta: StructureInputMeta;
  pae: string | null;
};

export function App() {
  const { toast } = useFeedback();
  const [settings, updateSettings] = useAppSettings();

  const clientRef = useRef<BioEngineClient | null>(null);
  if (!clientRef.current) clientRef.current = new BioEngineClient();
  const viewportRef = useRef<MolecularViewportHandle | null>(null);
  const openFileRef = useRef<HTMLInputElement | null>(null);

  const [wasmReady, setWasmReady] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [chainError, setChainError] = useState<string | null>(null);
  const [rendererMode, setRendererMode] = useState<'webgl2' | 'canvas2d-fallback'>('webgl2');

  // Shell
  const [layout, dispatchLayout] = useReducer(layoutReducer, settings.restoreTabs, loadLayout);
  const [sidebarView, setSidebarView] = useState<SidebarView>('explorer');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('account');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [dbExplorerOpen, setDbExplorerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [signInPending, setSignInPending] = useState(false);
  const signInPopupRef = useRef<Window | null>(null);
  const [authSession, setAuthSession] = useState<StudioSession | null>(() => loadStudioSession());
  const [activeStarterId, setActiveStarterId] = useState<string | null>(null);
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);

  // Viewport controls
  const [viewportEngine, setViewportEngine] = useState<'webgl2' | 'molstar'>('webgl2');
  const [extraViewerOverlay, setExtraViewerOverlay] = useState<MolStarExtraOverlay | null>(null);
  const [stagedComputeTarget, setStagedComputeTarget] = useState<{ tool: 'vina' | 'pyscf'; nonce: number } | null>(null);
  const [computeSnapshot, setComputeSnapshot] = useState(() => getComputeSnapshot());
  const [viewportLayout, setViewportLayout] = useState<ViewportLayout>(settings.viewer.defaultLayout);
  const [renderStyle, setRenderStyle] = useState<RenderStyle>(settings.viewer.defaultStyle);
  const [colorMode, setColorMode] = useState<ColorMode>(settings.viewer.defaultColorMode);

  // Loaded artifacts
  const [refLabel, setRefLabel] = useState('');
  const [refContent, setRefContent] = useState('');
  const [refMeta, setRefMeta] = useState<StructureInputMeta>({ sourceTypeHint: 'auto' });
  const [refInspect, setRefInspect] = useState<InspectStructureResult | null>(null);
  const [refChain, setRefChain] = useState('');

  const [mobLabel, setMobLabel] = useState('');
  const [mobContent, setMobContent] = useState('');
  const [mobMeta, setMobMeta] = useState<StructureInputMeta>({ sourceTypeHint: 'auto' });
  const [mobInspect, setMobInspect] = useState<InspectStructureResult | null>(null);
  const [mobChain, setMobChain] = useState('');

  const [paeJson, setPaeJson] = useState<string | null>(null);
  const [comparison, setComparison] = useState<CompareStructuresResult | null>(null);

  const [focusedSeqId, setFocusedSeqId] = useState<number | null>(null);
  const [selectedPaePair, setSelectedPaePair] = useState<[number, number] | null>(null);

  // Workbenches
  const [peptideState, peptideDispatch] = useReducer(peptideReducer, {
    sequence: P00918_DEFAULT_SEQ,
    mutationsInput: 'H94A',
    mutations: ['H94A'],
    sliceStart: 1,
    sliceEnd: P00918_DEFAULT_SEQ.length,
    focusSeqId: 94,
  });
  const [peptideResult, setPeptideResult] = useState<AnalyzePeptideResult | null>(null);
  const [peptideError, setPeptideError] = useState<string | null>(null);

  const [crisprState, crisprDispatch] = useReducer(crisprReducer, {
    transcriptId: 'NM_000067.3',
    customDna: '',
    useCustomDna: false,
    targetCodonIndex: 94,
    baseEditOffset: 0,
    newBase: 'G',
    nuclease: 'SpCas9',
  });
  const [crisprResult, setCrisprResult] = useState<AnalyzeGeneCrisprResult | null>(null);
  const [crisprError, setCrisprError] = useState<string | null>(null);

  const [chemState, chemDispatch] = useReducer(chemistryReducer, {
    selectedPresetId: SMILES_PRESETS[0].id,
    name: SMILES_PRESETS[0].name,
    smiles: SMILES_PRESETS[0].smiles,
  });
  const [smilesResult, setSmilesResult] = useState<AnalyzeMoleculeSmilesResult | null>(null);
  const [smilesError, setSmilesError] = useState<string | null>(null);

  const [ramachandranSource, setRamachandranSource] = useState<'reference' | 'mobile'>('reference');
  const [ramachandranResult, setRamachandranResult] = useState<AnalyzeRamachandranResult | null>(null);
  const [ramachandranError, setRamachandranError] = useState<string | null>(null);

  const [runHistory, setRunHistory] = useState<RunHistoryEntry[]>([]);

  // AI assistant & agent permissions
  const [aiConfig, setAiConfig] = useState<AiConfig>(() => loadAiConfig());
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentMessages, setAgentMessages] = useState<AgentChatMessage[]>([]);
  const [liveAgentSteps, setLiveAgentSteps] = useState<AgentStepTrace[]>([]);
  const [pendingPermission, setPendingPermission] = useState<ToolPermissionRequest | null>(null);
  const [permissionPolicies, setPermissionPolicies] = useState<ToolPermissionPolicyMap>(() => loadPermissionPolicies());
  const permissionResolverRef = useRef<((d: PermissionDecision) => void) | null>(null);
  const sessionApprovedCategoriesRef = useRef<Set<ToolPermissionCategory>>(new Set());

  // Projects & Guided Tutorial
  const [projectsSnap, setProjectsSnap] = useState(() => getProjectsSnapshot());
  const [tutorialOpen, setTutorialOpen] = useState(false);

  // ---------------------------------------------------------------- effects

  useEffect(() => {
    applyUiScale(settings.uiScale);
    return installZoomLock(stepUiScale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (settings.restoreTabs) saveLayout(layout);
  }, [layout, settings.restoreTabs]);

  useEffect(() => {
    const load = () => listLibrary().then(setLibraryItems);
    void load();
    return subscribeLibrary(() => void load());
  }, []);

  useEffect(() => {
    if (!globalError) return;
    toast(globalError, 'error');
    setGlobalError(null);
  }, [globalError, toast]);

  const openTab = useCallback((tab: ToolTabId, toSide = false) => {
    dispatchLayout({ type: 'open', tab, toSide });
  }, []);

  const openSettings = useCallback((section?: SettingsSection) => {
    if (section) setSettingsSection(section);
    setSettingsOpen(true);
  }, []);

  const requestToolPermission = useCallback(
    (req: ToolPermissionRequest) =>
      new Promise<PermissionDecision>((resolve) => {
        openTab('assistant');
        setPendingPermission(req);
        permissionResolverRef.current = resolve;
      }),
    [openTab],
  );

  const resolveToolPermission = useCallback((decision: PermissionDecision) => {
    const resolve = permissionResolverRef.current;
    permissionResolverRef.current = null;
    setPendingPermission(null);
    resolve?.(decision);
  }, []);

  const handleCreateProject = useCallback(
    (input: { name: string; description?: string; template: ProjectTemplateKind }) => {
      const proj = createProject(input);
      if (input.template === 'ligand-docking') openTab('chemistry');
      else if (input.template === 'peptide-crispr') openTab('peptide');
      else if (input.template === 'structure-compare') openTab('viewer');
      toast(`Created project "${proj.name}"`, 'success');
      return proj;
    },
    [openTab, toast],
  );

  const handleDockMolecule = useCallback(
    (mol: ProjectMoleculeItem) => {
      chemDispatch({ type: 'set_custom_smiles', smiles: mol.smiles, name: mol.name });
      setStagedComputeTarget({ tool: 'vina', nonce: Date.now() });
      openTab('compute');
      toast(`Staged ${mol.name} for receptor binding / Vina`, 'info');
    },
    [openTab, toast],
  );

  const highlightedSeqIds = useMemo(() => {
    const s = new Set<number>();
    if (peptideResult?.local3dContacts) for (const c of peptideResult.local3dContacts) s.add(c.seqId);
    return s;
  }, [peptideResult]);

  // ---------------------------------------------------------------- library

  const saveToLibrary = useCallback(
    async (input: NewLibraryItem, opts: { silent?: boolean } = {}) => {
      try {
        const { item, duplicate } = await addToLibrary(input);
        if (!opts.silent) {
          toast(
            duplicate ? `${item.name} is already in your library` : `Saved ${item.name} to library`,
            duplicate ? 'info' : 'success',
          );
        }
        return item;
      } catch (err) {
        toast(`Could not save to library: ${err instanceof Error ? err.message : String(err)}`, 'error');
        return null;
      }
    },
    [toast],
  );

  const autoSave = useCallback(
    (input: NewLibraryItem) => {
      if (settings.autoSaveImports) void saveToLibrary(input, { silent: true });
    },
    [saveToLibrary, settings.autoSaveImports],
  );

  // ---------------------------------------------------------------- compare

  const runComparison = useCallback(async (p: CompareParams): Promise<CompareStructuresResult | null> => {
    if (!p.rContent || !p.mContent) return null;
    if (!p.rChain || !p.mChain) {
      setChainError('Select a chain for both the reference and the comparison structure.');
      return null;
    }
    setBusyLabel('Superposing structures…');
    setChainError(null);
    try {
      const res = await clientRef.current!.compareStructures({
        refLabel: p.rLabel,
        refContent: p.rContent,
        refChain: p.rChain,
        refMeta: p.rMeta,
        mobLabel: p.mLabel,
        mobContent: p.mContent,
        mobChain: p.mChain,
        mobMeta: p.mMeta,
        paeJson: p.pae ?? undefined,
      });
      setComparison(res);
      setWasmReady(true);
      const nextHist = await saveRunHistoryEntry({
        id: `${res.reference.sha256.slice(0, 8)}-${res.mobile.sha256.slice(0, 8)}-${res.reference.chainId}-${res.mobile.chainId}`,
        createdAtUtc: res.createdAtUtc,
        refLabel: res.reference.label,
        refChain: res.reference.chainId,
        refSha256: res.reference.sha256,
        mobLabel: res.mobile.label,
        mobChain: res.mobile.chainId,
        mobSha256: res.mobile.sha256,
        rmsdAngstrom: res.metrics.rmsdAngstrom,
        matchedCaCount: res.metrics.matchedCaCount,
        paeStatus: res.metrics.paeStatus,
      });
      setRunHistory(nextHist);
      return res;
    } catch (err) {
      if (err instanceof CancelledRunError) return null;
      if (err instanceof BioEngineOperationError && err.code === 'ERR_AMBIGUOUS_CHAIN') setChainError(err.message);
      else setGlobalError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setBusyLabel(null);
    }
  }, []);

  const currentPair = (): CompareParams => ({
    rLabel: refLabel,
    rContent: refContent,
    rChain: refChain,
    rMeta: refMeta,
    mLabel: mobLabel,
    mContent: mobContent,
    mChain: mobChain,
    mMeta: mobMeta,
    pae: paeJson,
  });

  /** Loads structure text into one slot, inspects it, and re-runs the comparison when possible. */
  const loadStructure = useCallback(
    async (args: {
      role: 'reference' | 'mobile';
      label: string;
      content: string;
      meta: StructureInputMeta;
      pae?: string | null;
    }) => {
      setChainError(null);
      setActiveStarterId(null);
      setBusyLabel(`Reading ${args.label}…`);
      try {
        const insp = await clientRef.current!.inspectStructure(
          args.role === 'reference' ? 'inspect-ref' : 'inspect-mob',
          { label: args.label, content: args.content, ...args.meta },
        );
        setWasmReady(true);
        const chain = insp.chains.length === 1 ? insp.chains[0].chainId : '';
        if (!chain && insp.chains.length > 1) {
          setSidebarView('explorer');
          setSidebarOpen(true);
          setChainError(
            `${args.label} has ${insp.chains.length} chains (${insp.chains.map((c) => c.chainId).join(', ')}). Pick one in the Workspace panel.`,
          );
        }
        if (args.role === 'reference') {
          setRefLabel(args.label);
          setRefContent(args.content);
          setRefMeta(args.meta);
          setRefInspect(insp);
          setRefChain(chain);
          addStructureToActiveProject({
            label: args.label,
            role: 'reference',
            content: args.content,
            paeJson: args.pae,
            sourceUrl: args.meta.sourceUrl ?? null,
            license: args.meta.license ?? null,
          });
          if (chain && mobContent && mobChain) {
            await runComparison({
              rLabel: args.label, rContent: args.content, rChain: chain, rMeta: args.meta,
              mLabel: mobLabel, mContent: mobContent, mChain: mobChain, mMeta: mobMeta, pae: paeJson,
            });
          }
        } else {
          const nextPae = args.pae !== undefined ? args.pae : paeJson;
          setMobLabel(args.label);
          setMobContent(args.content);
          setMobMeta(args.meta);
          setMobInspect(insp);
          setMobChain(chain);
          setPaeJson(nextPae);
          addStructureToActiveProject({
            label: args.label,
            role: 'mobile',
            content: args.content,
            paeJson: nextPae,
            sourceUrl: args.meta.sourceUrl ?? null,
            license: args.meta.license ?? null,
          });
          const seq = (insp.chains.find((c) => c.chainId === chain) ?? insp.chains[0])?.sequence1Letter;
          if (seq) {
            peptideDispatch({ type: 'set_sequence', sequence: seq });
            peptideDispatch({ type: 'set_mutations_input', raw: '' });
          }
          if (chain && refContent && refChain) {
            await runComparison({
              rLabel: refLabel, rContent: refContent, rChain: refChain, rMeta: refMeta,
              mLabel: args.label, mContent: args.content, mChain: chain, mMeta: args.meta, pae: nextPae,
            });
          }
        }
        dispatchLayout({ type: 'activate', tab: 'viewer' });
        return insp;
      } catch (err) {
        if (!(err instanceof CancelledRunError)) setGlobalError(err instanceof Error ? err.message : String(err));
        return null;
      } finally {
        setBusyLabel(null);
      }
    },
    [mobContent, mobChain, mobLabel, mobMeta, refContent, refChain, refLabel, refMeta, paeJson, runComparison],
  );

  const handleSplitStructure = useCallback(
    (role: 'reference' | 'mobile') => {
      const content = role === 'reference' ? refContent : mobContent;
      const label = role === 'reference' ? refLabel : mobLabel;
      if (!content) {
        toast(`No ${role} structure loaded to split`, 'error');
        return [];
      }
      const parts = splitStructureIntoParts(content, label || role);
      for (const part of parts) {
        addStructureToActiveProject({
          label: part.label,
          role: 'extra',
          content: part.pdbContent,
        });
      }
      setSidebarView('explorer');
      setSidebarOpen(true);
      toast(`Split ${label || role} into ${parts.length} chain/ligand part(s)`, 'success');
      return parts;
    },
    [refContent, refLabel, mobContent, mobLabel, toast],
  );

  const handleLoadProjectStructure = useCallback(
    (item: ProjectStructureItem, role: 'reference' | 'mobile') => {
      void loadStructure({
        role,
        label: item.label,
        content: item.content,
        meta: {
          sourceTypeHint: 'auto',
          sourceUrl: item.sourceUrl ?? undefined,
          license: item.license ?? undefined,
        },
        pae: item.paeJson ?? undefined,
      });
    },
    [loadStructure],
  );

  const executeWorkflowNodeRef = useRef<
    ((kind: WorkflowNodeKind, params: Record<string, unknown>) => Promise<{ summary: string; metrics?: Record<string, unknown> }>) | null
  >(null);

  // ---------------------------------------------------------------- demo / starters

  const seedPinnedDemo = useCallback(async () => {
    setBusyLabel('Loading example…');
    setChainError(null);
    setActiveStarterId('ca2-azm');
    try {
      const seeded = await loadPinnedFixtures();
      const rMeta = metaFromManifest(seeded.manifest.fixtures.find((f) => f.fileName === '3HS4.cif'));
      const mMeta = metaFromManifest(seeded.manifest.fixtures.find((f) => f.fileName === 'AF-P00918-F1-model_v6.cif'));
      setRefLabel('3HS4.cif');
      setRefContent(seeded.refCif);
      setRefMeta(rMeta);
      setMobLabel('AF-P00918-F1-model_v6.cif');
      setMobContent(seeded.mobCif);
      setMobMeta(mMeta);
      setPaeJson(seeded.paeJson);
      const [rInsp, mInsp] = await Promise.all([
        clientRef.current!.inspectStructure('inspect-ref', { label: '3HS4.cif', content: seeded.refCif, ...rMeta }),
        clientRef.current!.inspectStructure('inspect-mob', { label: 'AF-P00918-F1-model_v6.cif', content: seeded.mobCif, ...mMeta }),
      ]);
      setWasmReady(true);
      setRefInspect(rInsp);
      setMobInspect(mInsp);
      const rChain = rInsp.chains.length === 1 ? rInsp.chains[0].chainId : '';
      const mChain = mInsp.chains.length === 1 ? mInsp.chains[0].chainId : '';
      setRefChain(rChain);
      setMobChain(mChain);
      setFocusedSeqId(94);
      if (mInsp.chains[0]?.sequence1Letter) {
        peptideDispatch({ type: 'set_sequence', sequence: mInsp.chains[0].sequence1Letter });
        peptideDispatch({ type: 'add_mutation', notation: 'H94A' });
      }
      if (rChain && mChain) {
        await runComparison({
          rLabel: '3HS4.cif', rContent: seeded.refCif, rChain, rMeta,
          mLabel: 'AF-P00918-F1-model_v6.cif', mContent: seeded.mobCif, mChain, mMeta, pae: seeded.paeJson,
        });
      }
    } catch (err) {
      if (err instanceof CancelledRunError) return;
      setGlobalError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyLabel(null);
    }
  }, [runComparison]);

  useEffect(() => {
    void initSecureVault().then(() => setAiConfig(loadAiConfig()));
    loadComputeNodes();
    loadPlugins();
    loadProjects();
    const offProjects = subscribeProjects(() => setProjectsSnap(getProjectsSnapshot()));
    const offCompute = subscribeComputeState(() => setComputeSnapshot(getComputeSnapshot()));
    loadRunHistory().then(setRunHistory).catch(() => {});
    if (settings.loadDemoOnStart) void seedPinnedDemo();
    return () => {
      offProjects();
      offCompute();
      clientRef.current?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auth callbacks: popup relay (web), full-page redirect fallback (web), deep link (desktop)
  useEffect(() => {
    const closePopup = () => {
      clearPopupActiveMarker();
      try {
        signInPopupRef.current?.close();
      } catch {
        /* ignore */
      }
      signInPopupRef.current = null;
    };
    const finish = (uri: string, fromRedirect: boolean) => {
      if (!fromRedirect) closePopup();
      void completeStudioAuth(uri)
        .then((sess) => {
          setAuthSession(sess);
          setAiConfig(loadAiConfig());
          if (fromRedirect) {
            window.history.replaceState({}, '', `${window.location.pathname}${window.location.hash}` || '/');
          }
          const who = sess.displayName ?? sess.email;
          toast(
            sess.serverVerified
              ? `Signed in${who ? ` as ${who}` : ''}`
              : 'Signed in, but synlexa.com could not confirm the session. Synlexa Cloud stays off until you reconnect.',
            sess.serverVerified ? 'success' : 'warn',
          );
        })
        .catch((err) => toast(err instanceof Error ? err.message : String(err), 'error'))
        .finally(() => {
          setSignInPending(false);
          closePopup();
        });
    };
    const cbUri = consumeWebCallbackFromLocation(window.location.href);
    if (cbUri) finish(cbUri, true);
    const offPopup = subscribePopupCallback((href) => finish(href, false));
    const offDeepLink = subscribeDesktopDeepLink((uri) => finish(uri, false));
    // Another Studio window (or a popup that lost its opener) signed in or out.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STUDIO_AUTH_SESSION_KEY) return;
      setAuthSession(loadStudioSession());
      setAiConfig(loadAiConfig());
      setSignInPending(false);
    };
    window.addEventListener('storage', onStorage);
    return () => {
      offPopup();
      offDeepLink();
      window.removeEventListener('storage', onStorage);
    };
  }, [toast]);

  // Stop waiting if the user closes the sign-in popup without finishing.
  useEffect(() => {
    if (!signInPending || !signInPopupRef.current) return;
    const timer = window.setInterval(() => {
      const popup = signInPopupRef.current;
      if (popup && popup.closed) {
        window.clearInterval(timer);
        // Give a relayed callback a moment to arrive before giving up.
        window.setTimeout(() => {
          if (signInPopupRef.current === popup) {
            signInPopupRef.current = null;
            setSignInPending(false);
          }
        }, 1500);
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [signInPending]);

  /** Opens synlexa.com: a popup on the web (opened synchronously so it is not blocked), the system browser on desktop. */
  const startSignIn = useCallback(
    (mode: StudioAuthMode) => {
      const desktop = isDesktopShell();
      const popup = desktop ? null : openSignInPopup('about:blank');
      void beginStudioAuth(mode, { platform: desktop ? 'desktop' : 'web' })
        .then(async ({ url }) => {
          if (desktop) {
            if (!(await openStudioConnectUrl(url))) throw new Error('Could not open your browser.');
            setSignInPending(true);
            return;
          }
          if (popup && !popup.closed) {
            popup.location.href = url;
            popup.focus();
            signInPopupRef.current = popup;
            setSignInPending(true);
          } else {
            // Popup blocked: continue in this tab; the redirect back completes sign-in.
            window.location.assign(url);
          }
        })
        .catch((err) => {
          popup?.close();
          toast(err instanceof Error ? err.message : String(err), 'error');
        });
    },
    [toast],
  );

  const cancelSignIn = useCallback(() => {
    clearPopupActiveMarker();
    try {
      signInPopupRef.current?.close();
    } catch {
      /* ignore */
    }
    signInPopupRef.current = null;
    clearPendingStudioAuth();
    setSignInPending(false);
  }, []);

  // ---------------------------------------------------------------- engine effects

  useEffect(() => {
    if (!peptideState.sequence) return;
    let active = true;
    setPeptideError(null);
    clientRef.current
      ?.analyzePeptide({
        sequence: peptideState.sequence,
        mutations: peptideState.mutations,
        sliceStart: peptideState.sliceStart,
        sliceEnd: peptideState.sliceEnd,
        structureContent: refContent || undefined,
        chainId: refChain || undefined,
        focusSeqId: peptideState.focusSeqId ?? undefined,
      })
      .then((res) => {
        if (!active) return;
        setWasmReady(true);
        setPeptideResult(res);
      })
      .catch((err) => {
        if (err instanceof CancelledRunError || !active) return;
        setPeptideError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
  }, [peptideState.sequence, peptideState.mutations, peptideState.sliceStart, peptideState.sliceEnd, peptideState.focusSeqId, refContent, refChain]);

  useEffect(() => {
    let active = true;
    setCrisprError(null);
    clientRef.current
      ?.analyzeGeneCrispr({
        transcriptId: crisprState.useCustomDna ? undefined : crisprState.transcriptId,
        codingDna: crisprState.useCustomDna ? crisprState.customDna : undefined,
        targetCodonIndex: crisprState.targetCodonIndex,
        baseEditIndex: (crisprState.targetCodonIndex - 1) * 3 + crisprState.baseEditOffset + 1,
        newBase: crisprState.newBase,
        nuclease: crisprState.nuclease,
      })
      .then((res) => {
        if (!active) return;
        setWasmReady(true);
        setCrisprResult(res);
      })
      .catch((err) => {
        if (err instanceof CancelledRunError || !active) return;
        setCrisprError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
  }, [crisprState]);

  useEffect(() => {
    if (!chemState.smiles) return;
    let active = true;
    setSmilesError(null);
    clientRef.current
      ?.analyzeMoleculeSmiles({ name: chemState.name, smiles: chemState.smiles })
      .then((res) => {
        if (!active) return;
        setWasmReady(true);
        setSmilesResult(res);
      })
      .catch((err) => {
        if (err instanceof CancelledRunError || !active) return;
        setSmilesError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
  }, [chemState]);

  useEffect(() => {
    const content = ramachandranSource === 'reference' ? refContent : mobContent;
    const chainId = ramachandranSource === 'reference' ? refChain : mobChain;
    if (!content) return;
    let active = true;
    setRamachandranError(null);
    clientRef.current
      ?.analyzeRamachandran({ content, chainId: chainId || undefined })
      .then((res) => {
        if (!active) return;
        setWasmReady(true);
        setRamachandranResult(res);
      })
      .catch((err) => {
        if (err instanceof CancelledRunError || !active) return;
        setRamachandranError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
  }, [ramachandranSource, refContent, refChain, mobContent, mobChain]);

  const focusResidueGlobally = useCallback((seqId: number) => {
    setFocusedSeqId(seqId);
    peptideDispatch({ type: 'focus_residue', seqId });
    crisprDispatch({ type: 'set_target_codon', codonIndex: seqId });
  }, []);

  // ---------------------------------------------------------------- starters

  const handleLaunchStarter = useCallback(
    async (preset: StarterPreset) => {
      setActiveStarterId(preset.id);
      setChainError(null);
      if (preset.kind === 'chemistry-panel') {
        if (preset.smilesPresetId) chemDispatch({ type: 'select_preset', presetId: preset.smilesPresetId });
        openTab('chemistry');
        return;
      }
      if (!preset.reference || !preset.mobile) return;
      setBusyLabel(`Loading ${preset.title}…`);
      try {
        const [manifest, rContent, mContent, pae] = await Promise.all([
          loadPinnedManifest(),
          loadPinnedFixtureFile(preset.reference.fileName),
          loadPinnedFixtureFile(preset.mobile.fileName),
          preset.paeFileName ? loadPinnedFixtureFile(preset.paeFileName).catch(() => null) : Promise.resolve(null),
        ]);
        const rMeta = metaFromManifest(manifest.fixtures.find((f) => f.fileName === preset.reference!.fileName));
        const mMeta = metaFromManifest(manifest.fixtures.find((f) => f.fileName === preset.mobile!.fileName));
        setRefLabel(preset.reference.label);
        setRefContent(rContent);
        setRefMeta(rMeta);
        setMobLabel(preset.mobile.label);
        setMobContent(mContent);
        setMobMeta(mMeta);
        setPaeJson(pae);
        const [rInsp, mInsp] = await Promise.all([
          clientRef.current!.inspectStructure('inspect-ref', { label: preset.reference.label, content: rContent, ...rMeta }),
          clientRef.current!.inspectStructure('inspect-mob', { label: preset.mobile.label, content: mContent, ...mMeta }),
        ]);
        setWasmReady(true);
        setRefInspect(rInsp);
        setMobInspect(mInsp);
        setRefChain(preset.reference.chainId);
        setMobChain(preset.mobile.chainId);
        const target = mInsp.chains.find((c) => c.chainId === preset.mobile!.chainId) ?? mInsp.chains[0];
        if (target?.sequence1Letter) {
          peptideDispatch({ type: 'set_sequence', sequence: target.sequence1Letter });
          peptideDispatch({ type: 'set_mutations_input', raw: (preset.peptideMutations ?? []).join(', ') });
        }
        if (preset.crispr) {
          crisprDispatch({ type: 'select_transcript', transcriptId: preset.crispr.transcriptId });
          crisprDispatch({ type: 'set_target_codon', codonIndex: preset.crispr.targetCodonIndex });
          crisprDispatch({ type: 'set_base_edit', offset: preset.crispr.baseEditOffset, newBase: preset.crispr.newBase });
          crisprDispatch({ type: 'set_nuclease', nuclease: preset.crispr.nuclease });
        }
        if (preset.smilesPresetId) chemDispatch({ type: 'select_preset', presetId: preset.smilesPresetId });
        if (preset.focusSeqId) {
          setFocusedSeqId(preset.focusSeqId);
          peptideDispatch({ type: 'focus_residue', seqId: preset.focusSeqId });
        }
        await runComparison({
          rLabel: preset.reference.label, rContent, rChain: preset.reference.chainId, rMeta,
          mLabel: preset.mobile.label, mContent, mChain: preset.mobile.chainId, mMeta, pae,
        });
        dispatchLayout({ type: 'activate', tab: 'viewer' });
        if (preset.openTab && preset.openTab !== 'sequence') openTab(preset.openTab);
      } catch (err) {
        if (!(err instanceof CancelledRunError)) setGlobalError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyLabel(null);
      }
    },
    [runComparison, openTab],
  );

  // ---------------------------------------------------------------- imports

  const handleImportStructureFromDb = useCallback(
    async (imported: ImportedStructure, role: 'reference' | 'mobile') => {
      const meta: StructureInputMeta = {
        sourceTypeHint: imported.sourceTypeHint,
        sourceUrl: imported.sourceUrl,
        dataRevision: imported.dataRevision ?? undefined,
        retrievedAtUtc: imported.retrievedAtUtc,
        license: imported.license,
      };
      await loadStructure({
        role,
        label: imported.label,
        content: imported.content,
        meta,
        pae: role === 'mobile' ? imported.paeJson ?? null : undefined,
      });
      autoSave({
        kind: 'structure',
        format: /\.pdb$/i.test(imported.label) ? 'pdb' : 'cif',
        name: stripExt(imported.label),
        content: imported.content,
        paeJson: imported.paeJson,
        source: {
          database: databaseFromUrl(imported.sourceUrl),
          accession: imported.uniprotAccession ?? stripExt(imported.label),
          sourceUrl: imported.sourceUrl,
          license: imported.license,
          retrievedAtUtc: imported.retrievedAtUtc,
          origin: imported.origin,
          sourceTypeHint: imported.sourceTypeHint,
          dataRevision: imported.dataRevision,
        },
      });
    },
    [loadStructure, autoSave],
  );

  const handleImportCompoundFromDb = useCallback(
    (compound: ImportedCompound) => {
      chemDispatch({ type: 'set_custom_smiles', smiles: compound.smiles, name: compound.name });
      openTab('chemistry');
      autoSave({
        kind: 'compound',
        format: 'smiles',
        name: compound.name,
        content: compound.smiles,
        source: {
          database: 'PubChem',
          accession: compound.cid !== null ? `CID ${compound.cid}` : null,
          sourceUrl: compound.sourceUrl,
          license: compound.license,
          retrievedAtUtc: compound.retrievedAtUtc,
          origin: compound.origin,
        },
      });
    },
    [openTab, autoSave],
  );

  const handleUploadFiles = useCallback(
    async (files: FileList | File[], targetRole: 'reference' | 'mobile' | 'auto' = 'auto') => {
      setActiveStarterId(null);
      const localSource = (): NewLibraryItem['source'] => ({
        database: null,
        accession: null,
        sourceUrl: null,
        license: null,
        retrievedAtUtc: null,
        origin: 'local-file',
      });
      let hasRef = Boolean(refContent);
      let hasMob = Boolean(mobContent);
      for (const file of Array.from(files)) {
        const lower = file.name.toLowerCase();
        const text = await file.text();

        if (lower.endsWith('.synlexa.bundle.json')) {
          try {
            const bundle = await parseAndValidateProjectBundle(text);
            const refF = bundle.files.find((f) => f.role === 'reference');
            const mobF = bundle.files.find((f) => f.role === 'mobile');
            const paeF = bundle.files.find((f) => f.role === 'pae');
            if (refF && mobF) {
              setRefLabel(refF.label);
              setRefContent(refF.content);
              setMobLabel(mobF.label);
              setMobContent(mobF.content);
              setPaeJson(paeF?.content ?? null);
              const [ri, mi] = await Promise.all([
                clientRef.current!.inspectStructure('inspect-ref', { label: refF.label, content: refF.content }),
                clientRef.current!.inspectStructure('inspect-mob', { label: mobF.label, content: mobF.content }),
              ]);
              setRefInspect(ri);
              setMobInspect(mi);
              setRefChain(bundle.state.refChain);
              setMobChain(bundle.state.mobChain);
              if (bundle.comparisonResult) setComparison(bundle.comparisonResult);
              toast(`Opened project ${file.name}`, 'success');
            }
          } catch (err) {
            setGlobalError(err instanceof Error ? err.message : String(err));
          }
          continue;
        }

        if (/\.(fasta|fa|faa)$/.test(lower)) {
          const seq = text.split(/\r?\n/).filter((l) => !l.startsWith('>')).join('').trim().toUpperCase();
          if (/^[ACGTU\s]+$/i.test(seq) && seq.length >= 9) {
            crisprDispatch({ type: 'set_custom_dna', dna: seq.replace(/U/g, 'T') });
            openTab('crispr');
          } else {
            peptideDispatch({ type: 'set_sequence', sequence: seq });
            openTab('peptide');
          }
          autoSave({ kind: 'sequence', format: 'fasta', name: file.name.replace(/\.[^.]+$/, ''), content: seq, source: localSource() });
          continue;
        }

        if (lower.endsWith('.smi')) {
          const firstLine = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
          const [smi, ...nameParts] = firstLine.trim().split(/\s+/);
          if (smi) {
            const name = nameParts.join(' ') || file.name.replace(/\.[^.]+$/, '');
            chemDispatch({ type: 'set_custom_smiles', smiles: smi, name });
            openTab('chemistry');
            autoSave({ kind: 'compound', format: 'smiles', name, content: smi, source: localSource() });
          }
          continue;
        }

        if (lower.endsWith('.json')) {
          setPaeJson(text);
          toast('PAE matrix loaded', 'success');
          if (refContent && mobContent && refChain && mobChain) await runComparison({ ...currentPair(), pae: text });
          continue;
        }

        if (!/\.(cif|mmcif|pdb|ent)$/.test(lower)) {
          toast(`${file.name}: unsupported file type`, 'warn');
          continue;
        }
        const role: 'reference' | 'mobile' =
          targetRole !== 'auto'
            ? targetRole
            : !hasRef
              ? 'reference'
              : lower.includes('af-') || lower.includes('model') || !hasMob
                ? 'mobile'
                : 'reference';
        if (role === 'reference') hasRef = true;
        else hasMob = true;
        await loadStructure({ role, label: file.name, content: text, meta: { sourceTypeHint: 'auto' } });
        autoSave({
          kind: 'structure',
          format: /\.(pdb|ent)$/.test(lower) ? 'pdb' : 'cif',
          name: stripExt(file.name),
          content: text,
          source: localSource(),
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refLabel, refContent, refChain, refMeta, mobLabel, mobContent, mobChain, mobMeta, paeJson, runComparison, loadStructure, openTab, autoSave, toast],
  );

  const openLibraryItem = useCallback(
    async (item: LibraryItem, target: LibraryOpenTarget) => {
      void updateLibraryItem(item.id, { lastOpenedAtUtc: new Date().toISOString() });
      if (item.kind === 'compound') {
        chemDispatch({ type: 'set_custom_smiles', smiles: item.content, name: item.name });
        openTab('chemistry');
        return;
      }
      if (item.kind === 'sequence') {
        if (/^[ACGT]+$/.test(item.content) && item.content.length >= 9) {
          crisprDispatch({ type: 'set_custom_dna', dna: item.content });
          openTab('crispr');
        } else {
          peptideDispatch({ type: 'set_sequence', sequence: item.content });
          openTab('peptide');
        }
        return;
      }
      const role: 'reference' | 'mobile' =
        target !== 'auto'
          ? target
          : !refContent
            ? 'reference'
            : item.source.sourceTypeHint === 'prediction' || !mobContent
              ? 'mobile'
              : 'reference';
      await loadStructure({
        role,
        label: `${item.name}.${item.format === 'pdb' ? 'pdb' : 'cif'}`,
        content: item.content,
        meta: {
          sourceTypeHint: item.source.sourceTypeHint ?? 'auto',
          sourceUrl: item.source.sourceUrl ?? undefined,
          license: item.source.license ?? undefined,
          retrievedAtUtc: item.source.retrievedAtUtc ?? undefined,
          dataRevision: item.source.dataRevision ?? undefined,
        },
        pae: role === 'mobile' ? item.paeJson ?? null : undefined,
      });
      toast(`${item.name} loaded as ${role === 'reference' ? 'reference' : 'comparison'}`, 'success');
    },
    [refContent, mobContent, loadStructure, openTab, toast],
  );

  const saveSlotToLibrary = useCallback(
    (role: 'reference' | 'mobile') => {
      const label = role === 'reference' ? refLabel : mobLabel;
      const content = role === 'reference' ? refContent : mobContent;
      const meta = role === 'reference' ? refMeta : mobMeta;
      if (!content) return;
      void saveToLibrary({
        kind: 'structure',
        format: /\.(pdb|ent)$/i.test(label) ? 'pdb' : 'cif',
        name: stripExt(label),
        content,
        paeJson: role === 'mobile' ? paeJson : null,
        source: {
          database: databaseFromUrl(meta.sourceUrl),
          accession: null,
          sourceUrl: meta.sourceUrl ?? null,
          license: meta.license ?? null,
          retrievedAtUtc: meta.retrievedAtUtc ?? null,
          origin: meta.sourceUrl ? 'pinned-local-cache' : 'local-file',
          sourceTypeHint: meta.sourceTypeHint,
          dataRevision: meta.dataRevision ?? null,
        },
      });
    },
    [refLabel, mobLabel, refContent, mobContent, refMeta, mobMeta, paeJson, saveToLibrary],
  );

  // ---------------------------------------------------------------- exports

  const embedPng = settings.viewer.embedPngInReports;

  const handleExportHtmlReport = useCallback(() => {
    if (!comparison) {
      toast('Run a comparison first', 'warn');
      return;
    }
    const html = generateRuoHtmlReport({
      comparison,
      peptide: peptideResult,
      crispr: crisprResult,
      smiles: smilesResult,
      viewportPngDataUrl: embedPng ? viewportRef.current?.capturePngDataUrl() ?? null : null,
    });
    triggerDownload(`synlexa-ruo-report-${comparison.resultId.slice(0, 12)}.html`, html, 'text/html;charset=utf-8');
  }, [comparison, peptideResult, crisprResult, smilesResult, embedPng, toast]);

  const handleExportJsonManifest = useCallback(() => {
    if (!comparison) {
      toast('Run a comparison first', 'warn');
      return;
    }
    const json = buildRuoJsonManifest({
      comparison,
      peptide: peptideResult,
      crispr: crisprResult,
      smiles: smilesResult,
      viewportPngDataUrl: embedPng ? viewportRef.current?.capturePngDataUrl() ?? null : null,
    });
    triggerDownload(`synlexa-ruo-manifest-${comparison.resultId.slice(0, 12)}.json`, json, 'application/json;charset=utf-8');
  }, [comparison, peptideResult, crisprResult, smilesResult, embedPng, toast]);

  const handleExportBundle = useCallback(async () => {
    if (!refContent || !mobContent) {
      toast('Load a reference and a comparison structure first', 'warn');
      return;
    }
    const bundle = await createProjectBundle({
      refLabel,
      refContent,
      mobLabel,
      mobContent,
      paeJson,
      comparisonResult: comparison,
      state: {
        refChain,
        mobChain,
        focusedSeqId,
        peptide: {
          sequence: peptideState.sequence,
          mutations: peptideState.mutations,
          sliceStart: peptideState.sliceStart,
          sliceEnd: peptideState.sliceEnd,
        },
        crispr: {
          transcriptId: crisprState.transcriptId,
          customDna: crisprState.customDna,
          targetCodonIndex: crisprState.targetCodonIndex,
          baseEditIndex: crisprState.baseEditOffset,
          newBase: crisprState.newBase,
          nuclease: crisprState.nuclease,
        },
        smiles: { name: chemState.name, smiles: chemState.smiles },
      },
    });
    triggerDownload(`synlexa-project-${Date.now()}.synlexa.bundle.json`, JSON.stringify(bundle, null, 2), 'application/json;charset=utf-8');
  }, [refLabel, refContent, mobLabel, mobContent, paeJson, comparison, refChain, mobChain, focusedSeqId, peptideState, crisprState, chemState, toast]);

  // ---------------------------------------------------------------- assistant

  const applyCopilotAction = useCallback(
    (act: CopilotAction) => {
      if (act.type === 'focus_residues' && act.seqIds.length > 0) focusResidueGlobally(act.seqIds[0]);
      else if (act.type === 'compare_structures') void runComparison(currentPair());
      else if (act.type === 'request_report') {
        if (act.format === 'json') handleExportJsonManifest();
        else handleExportHtmlReport();
      } else if (act.type === 'switch_tab') openTab(act.tab);
      else if (act.type === 'apply_peptide_mutation') peptideDispatch({ type: 'add_mutation', notation: act.notation });
      else if (act.type === 'analyze_smiles') chemDispatch({ type: 'set_custom_smiles', smiles: act.smiles, name: act.name });
      else if (act.type === 'focus_crispr_codon') focusResidueGlobally(act.codonIndex);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focusResidueGlobally, runComparison, refLabel, refContent, refChain, refMeta, mobLabel, mobContent, mobChain, mobMeta, paeJson, handleExportJsonManifest, handleExportHtmlReport, openTab],
  );

  const executeTool = useCallback(
    async (name: GeminiToolName, args: Record<string, unknown>): Promise<{ ok: boolean; summary: string; data: unknown }> => {
      switch (name) {
        case 'fetch_from_database': {
          const source = String(args.source || 'rcsb') as DbSource;
          const query = String(args.query || '');
          const res = await searchDatabase(source, query);
          if (res.records.length === 0) {
            return { ok: false, summary: `No matches in ${source} for "${query}"`, data: { origin: res.origin, records: [] } };
          }
          const top = res.records[0];
          if (args.autoImport !== false) {
            if (top.source === 'pubchem') {
              const comp = importCompoundRecord(top);
              handleImportCompoundFromDb(comp);
              return { ok: true, summary: `Imported ${comp.name} (${comp.origin})`, data: comp };
            }
            const role =
              args.role === 'reference' ? 'reference' : args.role === 'mobile' ? 'mobile' : top.source === 'rcsb' ? 'reference' : 'mobile';
            const imported = await importStructureRecord(top);
            await handleImportStructureFromDb(imported, role);
            return {
              ok: true,
              summary: `Imported ${imported.label} as ${role}`,
              data: { label: imported.label, role, sha256: imported.sha256, origin: imported.origin, sourceUrl: imported.sourceUrl, license: imported.license },
            };
          }
          return { ok: true, summary: `Found ${res.records.length} record(s) in ${source}`, data: { origin: res.origin, records: res.records.slice(0, 5) } };
        }
        case 'run_structure_superposition': {
          const rc = typeof args.refChain === 'string' && args.refChain ? args.refChain : refChain;
          const mc = typeof args.mobChain === 'string' && args.mobChain ? args.mobChain : mobChain;
          if (rc !== refChain) setRefChain(rc);
          if (mc !== mobChain) setMobChain(mc);
          const cmp = await runComparison({ ...currentPair(), rChain: rc, mChain: mc });
          if (!cmp) return { ok: false, summary: 'Superposition did not complete (check chains)', data: null };
          openTab('results');
          return {
            ok: true,
            summary: `RMSD ${cmp.metrics.rmsdAngstrom.toFixed(4)} Å (${cmp.metrics.matchedCaCount} Cα)`,
            data: { resultId: cmp.resultId, metrics: cmp.metrics, refSha256: cmp.reference.sha256, mobSha256: cmp.mobile.sha256 },
          };
        }
        case 'focus_3d_residues': {
          const ids = (Array.isArray(args.seqIds) ? args.seqIds : []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
          if (ids.length === 0) return { ok: false, summary: 'No positive residue IDs supplied', data: null };
          focusResidueGlobally(ids[0]);
          const matched = ids.map(
            (id) => comparison?.matchedResidues.find((r) => r.refSeqId === id) ?? { refSeqId: id, note: 'not in matched Cα set' },
          );
          return { ok: true, summary: `Focused residue(s) ${ids.join(', ')}`, data: { seqIds: ids, matched } };
        }
        case 'engineer_peptide_mutation': {
          const muts = Array.isArray(args.mutations) ? args.mutations.map((m) => String(m).trim().toUpperCase()).filter(Boolean) : [];
          const focusId =
            typeof args.focusSeqId === 'number' && Number.isFinite(args.focusSeqId) ? args.focusSeqId : peptideState.focusSeqId ?? undefined;
          openTab('peptide');
          for (const m of muts) peptideDispatch({ type: 'add_mutation', notation: m });
          if (focusId) focusResidueGlobally(focusId);
          const res = await clientRef.current!.analyzePeptide({
            sequence: peptideState.sequence,
            mutations: Array.from(new Set([...peptideState.mutations, ...muts])),
            sliceStart: peptideState.sliceStart,
            sliceEnd: peptideState.sliceEnd,
            structureContent: refContent || undefined,
            chainId: refChain || undefined,
            focusSeqId: focusId,
          });
          setPeptideResult(res);
          addPeptideToActiveProject({
            name: muts.join(', ') || `Peptide (${res.engineered.length} aa)`,
            sequence: peptideState.sequence,
            mutations: Array.from(new Set([...peptideState.mutations, ...muts])),
          });
          return {
            ok: true,
            summary: `Applied ${muts.join(', ') || 'peptide analysis'} (ΔMW ${res.deltas.mwAverageDa.toFixed(1)} Da, pI ${res.engineered.pi.toFixed(2)})`,
            data: res,
          };
        }
        case 'design_crispr_edit': {
          const transcriptId = typeof args.transcriptId === 'string' && args.transcriptId ? args.transcriptId : crisprState.transcriptId;
          const targetCodonIndex = Math.max(1, Number(args.targetCodonIndex) || crisprState.targetCodonIndex);
          const offset = ([0, 1, 2].includes(Number(args.baseEditOffset)) ? Number(args.baseEditOffset) : crisprState.baseEditOffset) as 0 | 1 | 2;
          const newBase = (['A', 'C', 'G', 'T'].includes(String(args.newBase).toUpperCase())
            ? String(args.newBase).toUpperCase()
            : crisprState.newBase) as 'A' | 'C' | 'G' | 'T';
          const nuclease = (['SpCas9', 'SaCas9', 'Cas12a'].includes(String(args.nuclease))
            ? String(args.nuclease)
            : crisprState.nuclease) as 'SpCas9' | 'SaCas9' | 'Cas12a';
          openTab('crispr');
          crisprDispatch({ type: 'select_transcript', transcriptId });
          crisprDispatch({ type: 'set_target_codon', codonIndex: targetCodonIndex });
          crisprDispatch({ type: 'set_base_edit', offset, newBase });
          crisprDispatch({ type: 'set_nuclease', nuclease });
          const res = await clientRef.current!.analyzeGeneCrispr({
            transcriptId,
            targetCodonIndex,
            baseEditIndex: (targetCodonIndex - 1) * 3 + offset + 1,
            newBase,
            nuclease,
          });
          setCrisprResult(res);
          addCrisprToActiveProject({
            name: `${res.geneSymbol} codon ${targetCodonIndex} (${res.targetCodon.wtCodon}→${res.targetCodon.editedCodon})`,
            transcriptId,
            targetCodonIndex,
            baseEditOffset: offset,
            newBase,
            nuclease,
          });
          return {
            ok: true,
            summary: `${res.geneSymbol} codon ${targetCodonIndex}: ${res.targetCodon.wtCodon}→${res.targetCodon.editedCodon} (${res.targetCodon.consequence}), ${res.pamSites.length} PAMs`,
            data: { ...res, pamSites: res.pamSites.slice(0, 8) },
          };
        }
        case 'inspect_chemical_smiles': {
          const smiles = String(args.smiles || '').trim();
          const label = typeof args.name === 'string' && args.name.trim() ? args.name.trim() : 'Assistant SMILES';
          openTab('chemistry');
          chemDispatch({ type: 'set_custom_smiles', smiles, name: label });
          const res = await clientRef.current!.analyzeMoleculeSmiles({ name: label, smiles });
          setSmilesResult(res);
          return { ok: true, summary: `${res.formula}, MW ${res.molecularWeight.toFixed(2)} Da, TPSA ${res.tpsa.toFixed(1)} Å²`, data: res };
        }
        case 'analyze_ramachandran': {
          const target = args.target === 'mobile' ? 'mobile' : 'reference';
          const content = target === 'reference' ? refContent : mobContent;
          const chainId =
            typeof args.chainId === 'string' && args.chainId ? args.chainId : target === 'reference' ? refChain : mobChain;
          setRamachandranSource(target);
          openTab('ramachandran');
          const res = await clientRef.current!.analyzeRamachandran({ content, chainId: chainId || undefined });
          setRamachandranResult(res);
          return {
            ok: true,
            summary: `${target} (${res.chainId}): ${res.regionCounts.favored}/${res.residueCount} favored, ${res.contactPairs.length} contacts`,
            data: {
              chainId: res.chainId,
              residueCount: res.residueCount,
              secondaryCounts: res.secondaryCounts,
              regionCounts: res.regionCounts,
              contactCount: res.contactPairs.length,
              outliers: res.residues.filter((r) => r.region === 'outlier').slice(0, 10),
            },
          };
        }
        case 'export_ruo_report': {
          const format = String(args.format || 'html');
          if (format === 'json') handleExportJsonManifest();
          else if (format === 'bundle') await handleExportBundle();
          else handleExportHtmlReport();
          return { ok: true, summary: `Started ${format.toUpperCase()} download`, data: { exported: format } };
        }
        case 'get_workspace_state': {
          const section = typeof args.section === 'string' ? args.section : 'all';
          const topN = typeof args.topN === 'number' && Number.isFinite(args.topN) ? args.topN : 10;
          const ws: GeminiWorkspaceContext = {
            refLabel,
            mobLabel,
            refChain,
            mobChain,
            refInspect,
            mobInspect,
            comparison,
            peptide: peptideResult,
            crispr: crisprResult,
            smiles: smilesResult,
            ramachandran: ramachandranResult,
          };
          const snapshot = buildWorkspaceTelemetrySnapshot(ws, libraryItems, section, topN);
          return {
            ok: true,
            summary: `Inspected workspace (${section}, ${comparison ? `RMSD ${comparison.metrics.rmsdAngstrom.toFixed(3)} Å` : 'no comparison'})`,
            data: snapshot,
          };
        }
        case 'search_scientific_web': {
          const query = String(args.query || '').trim();
          const scope = (['all', 'literature', 'trials'].includes(String(args.scope))
            ? String(args.scope)
            : 'all') as WebSearchScope;
          const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? args.limit : 5;
          const res = await searchScientificWeb(query, { scope, limit });
          return {
            ok: true,
            summary: `Web search "${query}": ${res.hits.length} record(s) (${res.origin})`,
            data: res,
          };
        }
        case 'query_local_library': {
          const kind = typeof args.kind === 'string' ? args.kind : 'all';
          const q = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
          const filtered = libraryItems
            .filter((it) => (kind === 'all' ? true : it.kind === kind))
            .filter((it) => (!q ? true : `${it.name} ${it.source.accession ?? ''} ${it.tags.join(' ')}`.toLowerCase().includes(q)))
            .slice(0, 20)
            .map((it) => ({
              id: it.id,
              kind: it.kind,
              name: it.name,
              format: it.format,
              sha256: it.sha256,
              source: it.source,
            }));
          return {
            ok: true,
            summary: `Found ${filtered.length} local library item(s)`,
            data: { count: filtered.length, items: filtered },
          };
        }
        case 'list_compute_nodes': {
          const snap = getComputeSnapshot();
          return {
            ok: true,
            summary: `${snap.nodes.length} paired node(s); active=${snap.activeNode?.label ?? 'none'}`,
            data: {
              activeNodeId: snap.activeNodeId,
              nodes: snap.nodes.map((n) => ({
                id: n.id,
                label: n.label,
                kind: n.kind,
                online: n.online,
                gpus: n.capabilities?.gpus ?? [],
                installedTools: n.capabilities?.tools.filter((t) => t.installed).map((t) => t.id) ?? [],
              })),
            },
          };
        }
        case 'run_compute_job': {
          const snap = getComputeSnapshot();
          const activeNode = snap.activeNode;
          if (!activeNode || !activeNode.online) {
            return {
              ok: false,
              summary: 'No online Compute Node connected. Open Compute Nodes tab to pair Colab or a local GPU daemon.',
              data: null,
            };
          }
          const toolId = String(args.toolId || 'vina_docking');
          const smilesArg = typeof args.smiles === 'string' && args.smiles.trim() ? args.smiles.trim() : chemState.smiles;
          const pBox = computeDockingBox(comparison, focusedSeqId);
          const params: Record<string, unknown> =
            toolId === 'vina_docking'
              ? {
                  ligandSmiles: smilesArg,
                  receptorPdb: refContent,
                  center: pBox?.center ?? [0, 0, 0],
                  size: pBox?.size ?? [22, 22, 22],
                }
              : toolId === 'openmm_md'
                ? { pdbContent: refContent, steps: Number(args.steps ?? 1000) }
                : toolId === 'pyscf_qm'
                  ? { smiles: smilesArg }
                  : toolId === 'boltz_predict'
                    ? { sequences: [{ id: 'A', sequence: peptideState.sequence }] }
                    : { ...args };
          openTab('compute');
          const submitted = await submitComputeJob(activeNode.id, toolId, params);
          void waitForComputeJob(activeNode.id, submitted.job_id);
          return {
            ok: true,
            summary: `Dispatched ${toolId} (${submitted.job_id}) to ${activeNode.label}`,
            data: submitted,
          };
        }
        case 'control_app_ui': {
          const validTabs: ToolTabId[] = [
            'home', 'viewer', 'results', 'sequence', 'ramachandran', 'peptide',
            'crispr', 'chemistry', 'workflow', 'compute', 'plugins', 'assistant', 'mcp', 'library',
          ];
          const requestedTab = typeof args.tab === 'string' && validTabs.includes(args.tab as ToolTabId)
            ? (args.tab as ToolTabId)
            : null;
          if (requestedTab) openTab(requestedTab, Boolean(args.toSide));
          if (typeof args.sidebarView === 'string' && ['explorer', 'library', 'tools', 'history'].includes(args.sidebarView)) {
            setSidebarView(args.sidebarView as SidebarView);
          }
          if (typeof args.sidebarOpen === 'boolean') setSidebarOpen(args.sidebarOpen);
          if (args.viewportEngine === 'webgl2' || args.viewportEngine === 'molstar') setViewportEngine(args.viewportEngine);
          if (args.viewportLayout === 'overlay' || args.viewportLayout === 'split' || args.viewportLayout === 'reference' || args.viewportLayout === 'mobile') {
            setViewportLayout(args.viewportLayout);
          }
          if (args.renderStyle === 'ribbon' || args.renderStyle === 'trace' || args.renderStyle === 'pocket') {
            setRenderStyle(args.renderStyle);
          }
          if (args.colorMode === 'plddt' || args.colorMode === 'bfactor' || args.colorMode === 'deviation' || args.colorMode === 'identity') {
            setColorMode(args.colorMode);
          }
          const cam = args.cameraPreset ?? args.applyPreset;
          if (cam === 'overview' || cam === 'active-site' || cam === 'n-terminus' || cam === 'reset') {
            viewportRef.current?.applyPreset(cam);
          }
          if (args.openTutorial === true || args.openModal === 'tutorial') setTutorialOpen(true);
          else if (args.openModal === 'databases') setDbExplorerOpen(true);
          else if (args.openModal === 'settings') openSettings('ai');
          else if (args.openModal === 'palette') setPaletteOpen(true);
          else if (args.openModal === 'close') {
            setTutorialOpen(false);
            setDbExplorerOpen(false);
            setSettingsOpen(false);
            setPaletteOpen(false);
          }
          if (args.resetLayout === true) dispatchLayout({ type: 'reset' });
          return {
            ok: true,
            summary: `Updated UI (${[requestedTab ? `tab=${requestedTab}` : null, args.sidebarView ? `sidebar=${String(args.sidebarView)}` : null, args.openModal ? `modal=${String(args.openModal)}` : null].filter(Boolean).join(', ') || 'applied state'})`,
            data: { tab: requestedTab, sidebarView: args.sidebarView ?? null, viewportEngine: args.viewportEngine ?? null },
          };
        }
        case 'manage_project': {
          const action = String(args.action || 'list');
          if (action === 'list') {
            const snap = getProjectsSnapshot();
            return {
              ok: true,
              summary: `${snap.projects.length} project(s); active="${snap.activeProject?.name ?? 'none'}"`,
              data: {
                activeProjectId: snap.activeProject?.id ?? null,
                projects: snap.projects.map((p) => ({
                  id: p.id,
                  name: p.name,
                  template: p.template,
                  structures: p.structures.map((s) => s.label),
                  molecules: p.molecules.map((m) => ({ name: m.name, smiles: m.smiles })),
                  peptides: p.peptides.length,
                  crisprs: p.crisprs.length,
                })),
              },
            };
          }
          if (action === 'create') {
            const tpl = (['blank', 'structure-compare', 'ligand-docking', 'peptide-crispr'].includes(String(args.template))
              ? String(args.template)
              : 'ligand-docking') as ProjectTemplateKind;
            const proj = handleCreateProject({
              name: String(args.name || 'AI Research Project'),
              description: typeof args.description === 'string' ? args.description : undefined,
              template: tpl,
            });
            return { ok: true, summary: `Created project "${proj.name}" (${proj.id})`, data: proj };
          }
          if (action === 'switch') {
            const found = switchProject(String(args.projectId || ''));
            if (!found) return { ok: false, summary: `Project "${String(args.projectId)}" not found`, data: null };
            return { ok: true, summary: `Switched active project to "${found.name}"`, data: found };
          }
          if (action === 'add_molecule') {
            const smiles = String(args.smiles || chemState.smiles).trim();
            const name = String(args.name || 'Designed Ligand').trim();
            const item = addMoleculeToActiveProject({ name, smiles, note: typeof args.note === 'string' ? args.note : undefined });
            chemDispatch({ type: 'set_custom_smiles', smiles, name });
            openTab('chemistry');
            return { ok: true, summary: `Saved "${name}" (${smiles}) into active project`, data: item };
          }
          if (action === 'split_chains') {
            const role = (args.target ?? args.role) === 'mobile' ? 'mobile' : 'reference';
            const parts = handleSplitStructure(role);
            if (parts.length === 0) return { ok: false, summary: `No ${role} structure loaded or no chains found`, data: [] };
            return {
              ok: true,
              summary: `Split ${role} into ${parts.length} chain/ligand assets`,
              data: parts.map((p) => ({ label: p.label, kind: p.kind, chainId: p.chainId, atomCount: p.atomCount })),
            };
          }
          if (action === 'stage_binding') {
            const smiles = typeof args.smiles === 'string' && args.smiles.trim() ? args.smiles.trim() : chemState.smiles;
            const name = typeof args.name === 'string' && args.name.trim() ? args.name.trim() : chemState.name;
            chemDispatch({ type: 'set_custom_smiles', smiles, name });
            setStagedComputeTarget({ tool: 'vina', nonce: Date.now() });
            openTab('compute');
            return { ok: true, summary: `Staged "${name}" + "${refLabel || 'active receptor'}" for binding`, data: { smiles, name, receptor: refLabel } };
          }
          return { ok: false, summary: `Unknown project action: ${action}`, data: null };
        }
        case 'design_molecule_rdkit': {
          let smiles = String(args.smiles || chemState.smiles).trim();
          const name = String(args.name || 'Designed Analog').trim();
          const mod = typeof args.modifyAction === 'string' ? args.modifyAction : '';
          if (mod === 'add_fluoro' && !smiles.includes('F')) smiles = `${smiles}F`;
          else if (mod === 'add_methyl') smiles = `${smiles}C`;
          else if (mod === 'add_hydroxyl') smiles = `${smiles}O`;

          openTab('chemistry');
          chemDispatch({ type: 'set_custom_smiles', smiles, name });
          const wasmRes = await clientRef.current!.analyzeMoleculeSmiles({ name, smiles });
          setSmilesResult(wasmRes);

          let rdkitAlerts: string[] = [];
          let canonical = smiles;
          let smartsMatched: boolean | null = null;
          if (typeof Worker !== 'undefined') {
            try {
              const rd = await getSharedRdkitClient().analyzeMolecule(smiles);
              canonical = rd.canonicalSmiles || smiles;
              rdkitAlerts = rd.alerts.map((a) => `${a.family}: ${a.label}`);
              if (typeof args.smartsQuery === 'string' && args.smartsQuery.trim()) {
                const hits = await getSharedRdkitClient().searchLibrary(
                  args.smartsQuery.trim(),
                  [{ id: name, name, smiles: canonical }],
                );
                smartsMatched = Boolean(hits[0]?.substructureMatch);
              }
            } catch {
              /* fallback cleanly to WASM descriptors when RDKit worker isn't initialized in headless test */
            }
          }
          const savedItem = args.saveToProject === false
            ? null
            : addMoleculeToActiveProject({ name, smiles: canonical, note: rdkitAlerts.length ? `Alerts: ${rdkitAlerts.join('; ')}` : 'Clean PAINS/Brenk' });
          return {
            ok: true,
            summary: `Designed "${name}" (${wasmRes.formula}, MW ${wasmRes.molecularWeight.toFixed(1)}, cLogP ${wasmRes.crippenLogP.toFixed(2)}, TPSA ${wasmRes.tpsa.toFixed(1)})`,
            data: { name, canonicalSmiles: canonical, descriptors: wasmRes, alerts: rdkitAlerts, smartsMatched, savedProjectAssetId: savedItem?.id ?? null },
          };
        }
        case 'run_workflow_pipeline': {
          const tpl = WORKFLOW_TEMPLATES.find((t) => t.id === args.templateId) ?? WORKFLOW_TEMPLATES[0];
          const wfAction = String(args.action || 'run');
          openTab('workflow');
          if (wfAction === 'export_nextflow') {
            const nf = exportWorkflowToNextflow(tpl);
            return { ok: true, summary: `Exported Nextflow DSL2 for "${tpl.name}"`, data: { templateId: tpl.id, nextflow: nf } };
          }
          if (wfAction === 'export_snakemake') {
            const sm = exportWorkflowToSnakemake(tpl);
            return { ok: true, summary: `Exported Snakemake Snakefile for "${tpl.name}"`, data: { templateId: tpl.id, snakefile: sm } };
          }
          const ordered = topologicalSortWorkflow(tpl);
          openTab('workflow');
          const stepResults: Array<{ id: string; kind: WorkflowNodeKind; ok: boolean; summary: string }> = [];
          for (const node of ordered) {
            if (!executeWorkflowNodeRef.current) break;
            try {
              const out = await executeWorkflowNodeRef.current(node.kind, node.params);
              stepResults.push({ id: node.id, kind: node.kind, ok: true, summary: out.summary });
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              stepResults.push({ id: node.id, kind: node.kind, ok: false, summary: msg });
              break;
            }
          }
          const okAll = stepResults.length === ordered.length && stepResults.every((r) => r.ok);
          return {
            ok: okAll,
            summary: `${tpl.name}: completed ${stepResults.filter((r) => r.ok).length}/${ordered.length} workflow step(s)`,
            data: { templateId: tpl.id, templateName: tpl.name, steps: stepResults },
          };
        }
        case 'manage_plugins': {
          const action = String(args.action || 'list');
          if (action === 'list') {
            const plugins = listAllPlugins();
            return {
              ok: true,
              summary: `${plugins.filter((p) => p.enabled).length}/${plugins.length} plugin(s) enabled`,
              data: plugins.map((p) => ({
                id: p.id,
                name: p.name,
                category: p.category,
                tier: p.tier,
                license: p.license,
                commercialSafe: p.commercialSafe,
                enabled: p.enabled,
              })),
            };
          }
          const pluginId = String(args.pluginId || '').trim();
          if (!pluginId) return { ok: false, summary: 'pluginId required', data: null };
          const nextEnabled = action === 'enable';
          togglePlugin(pluginId, nextEnabled);
          openTab('plugins');
          return {
            ok: true,
            summary: `${nextEnabled ? 'Enabled' : 'Disabled'} plugin ${pluginId}`,
            data: { pluginId, enabled: nextEnabled },
          };
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refLabel, refContent, refChain, refMeta, refInspect, mobLabel, mobContent, mobChain, mobMeta, mobInspect, paeJson, comparison, peptideState, peptideResult, crisprState, crisprResult, chemState.smiles, chemState.name, smilesResult, ramachandranResult, libraryItems, focusedSeqId, runComparison, focusResidueGlobally, handleImportStructureFromDb, handleImportCompoundFromDb, handleExportHtmlReport, handleExportJsonManifest, handleExportBundle, openTab, openSettings, handleCreateProject, handleSplitStructure],
  );

  const activePocketBox = useMemo(
    () => computeDockingBox(comparison, focusedSeqId),
    [comparison, focusedSeqId],
  );

  const executeWorkflowNode = useCallback(
    async (kind: WorkflowNodeKind, params: Record<string, unknown>) => {
      switch (kind) {
        case 'load_structures':
          if (!refContent && !chemState.smiles) {
            throw new Error('Load a structure or SMILES first.');
          }
          return {
            summary: `${refLabel || 'No structure'} · ${chemState.name}`,
          };
        case 'kabsch_compare': {
          const cmp = await runComparison({
            rLabel: refLabel,
            rContent: refContent,
            rChain: refChain,
            rMeta: refMeta,
            mLabel: mobLabel,
            mContent: mobContent,
            mChain: mobChain,
            mMeta: mobMeta,
            pae: paeJson,
          });
          if (!cmp) throw new Error('Superposition failed; verify reference & mobile chains.');
          return {
            summary: `RMSD ${cmp.metrics.rmsdAngstrom.toFixed(3)} Å (${cmp.metrics.matchedCaCount} Cα)`,
            metrics: cmp.metrics as unknown as Record<string, unknown>,
          };
        }
        case 'rdkit_prep': {
          if (typeof Worker === 'undefined') {
            return { summary: `Wasm SMILES (${chemState.smiles})` };
          }
          const res = await getSharedRdkitClient().analyzeMolecule(chemState.smiles);
          return {
            summary: `${res.canonicalSmiles} · ${res.alerts.length} alerts`,
            metrics: res.descriptors as unknown as Record<string, unknown>,
          };
        }
        case 'export_report': {
          handleExportJsonManifest();
          return { summary: 'Exported RUO JSON provenance manifest' };
        }
        default: {
          const snap = getComputeSnapshot();
          const node = snap.activeNode;
          if (!node || !node.online) {
            throw new Error(`Node "${kind}" requires an online Tier-2 GPU/Compute Node (pair Colab or local worker).`);
          }
          const jobParams: Record<string, unknown> = {
            ...params,
            smiles: chemState.smiles,
            ligandSmiles: chemState.smiles,
            pdbContent: refContent,
            receptorPdb: refContent,
            targetPdb: refContent,
            center: activePocketBox?.center ?? [0, 0, 0],
            size: activePocketBox?.size ?? [22, 22, 22],
            sequences: [{ id: 'A', sequence: peptideState.sequence }],
          };
          const submitted = await submitComputeJob(node.id, kind, jobParams);
          const done = await waitForComputeJob(node.id, submitted.job_id);
          if (done.status !== 'completed') {
            throw new Error(done.error_message || `Remote job ${done.status}`);
          }
          return {
            summary: `${kind} complete on ${node.label}`,
            metrics: done.metrics,
          };
        }
      }
    },
    [refLabel, refContent, refChain, refMeta, mobLabel, mobContent, mobChain, mobMeta, paeJson, chemState.name, chemState.smiles, peptideState.sequence, activePocketBox, runComparison, handleExportJsonManifest],
  );
  executeWorkflowNodeRef.current = executeWorkflowNode;

  const liveWorkspaceContext = useMemo<GeminiWorkspaceContext>(
    () => ({
      refLabel,
      mobLabel,
      refChain,
      mobChain,
      refInspect,
      mobInspect,
      comparison,
      peptide: peptideResult,
      crispr: crisprResult,
      smiles: smilesResult,
      ramachandran: ramachandranResult,
    }),
    [refLabel, mobLabel, refChain, mobChain, refInspect, mobInspect, comparison, peptideResult, crisprResult, smilesResult, ramachandranResult],
  );

  const mcpRuntime = useMemo<McpServerRuntime>(
    () => ({
      workspace: liveWorkspaceContext,
      libraryItems,
      executeTool,
    }),
    [liveWorkspaceContext, libraryItems, executeTool],
  );

  const handleSendAgentPrompt = useCallback(
    async (prompt: string) => {
      const trimmed = prompt.trim();
      if (!trimmed || agentBusy) return;
      const userMsg: AgentChatMessage = { id: `u-${Date.now()}`, role: 'user', text: trimmed, timestampUtc: new Date().toISOString() };
      const history = agentMessages;
      setAgentMessages((prev) => [...prev, userMsg]);
      setLiveAgentSteps([]);
      setAgentBusy(true);
      try {
        const reply = await runAssistantTurn({
          prompt: trimmed,
          history,
          workspace: liveWorkspaceContext,
          executeTool: (name, args) => invokeMcpTool(mcpRuntime, name, args, 'internal-ai-agent'),
          onFallbackAction: applyCopilotAction,
          onProgress: setLiveAgentSteps,
          requestToolPermission,
          sessionApprovedCategories: sessionApprovedCategoriesRef.current,
          permissionPolicies,
          config: aiConfig,
        });
        setAgentMessages((prev) => [...prev, reply]);
      } finally {
        setLiveAgentSteps([]);
        permissionResolverRef.current = null;
        setPendingPermission(null);
        setAgentBusy(false);
      }
    },
    [agentBusy, agentMessages, liveWorkspaceContext, mcpRuntime, applyCopilotAction, requestToolPermission, permissionPolicies, aiConfig],
  );

  const updateAiConfig = useCallback((update: Parameters<typeof saveAiConfig>[0]) => setAiConfig(saveAiConfig(update)), []);
  // Signing in/out changes the Synlexa Cloud credential, so the AI config is reloaded with the session.
  const handleSessionChange = useCallback((s: StudioSession | null) => {
    setAuthSession(s);
    setAiConfig(loadAiConfig());
  }, []);

  // ---------------------------------------------------------------- shortcuts

  const activeTab = layout.groups[layout.focused]?.active ?? null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (mod && k === 'o') {
        e.preventDefault();
        openFileRef.current?.click();
      } else if (mod && e.shiftKey && k === 'f') {
        e.preventDefault();
        setDbExplorerOpen(true);
      } else if (mod && k === 'b') {
        e.preventDefault();
        setSidebarOpen((v) => !v);
      } else if (mod && e.key === ',') {
        e.preventDefault();
        openSettings();
      } else if (e.altKey && e.code === 'KeyW' && activeTab) {
        e.preventDefault();
        dispatchLayout({ type: 'close', tab: activeTab });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTab, openSettings]);

  // ---------------------------------------------------------------- palette

  const paletteCommands = useMemo<PaletteCommand[]>(
    () => [
      { id: 'tutorial', category: 'Help', label: 'Open Interactive Studio Tutorial & Guide', run: () => setTutorialOpen(true) },
      { id: 'new-project', category: 'Project', label: 'Create New Research Project', run: () => { handleCreateProject({ name: `Project ${(projectsSnap.projects.length || 0) + 1}`, template: 'ligand-docking' }); } },
      { id: 'split-ref', category: 'Project', label: 'Split Reference Chains & HETATM Ligands', run: () => { handleSplitStructure('reference'); } },
      { id: 'open-file', category: 'File', label: 'Open file…', shortcut: '⌘O', run: () => openFileRef.current?.click() },
      { id: 'db', category: 'File', label: 'Search public databases', shortcut: '⌘⇧F', run: () => setDbExplorerOpen(true) },
      { id: 'example', category: 'File', label: 'Load example comparison (carbonic anhydrase II)', run: () => void seedPinnedDemo() },
      { id: 'tab-viewer', category: 'Open tab', label: '3D Viewer', run: () => openTab('viewer') },
      { id: 'tab-results', category: 'Open tab', label: 'Results', run: () => openTab('results') },
      { id: 'tab-seq', category: 'Open tab', label: 'Sequence deviation', run: () => openTab('sequence') },
      { id: 'tab-rama', category: 'Open tab', label: 'Ramachandran plot', run: () => openTab('ramachandran') },
      { id: 'tab-pep', category: 'Open tab', label: 'Peptide engineering', run: () => openTab('peptide') },
      { id: 'tab-crispr', category: 'Open tab', label: 'Gene & CRISPR', run: () => openTab('crispr') },
      { id: 'tab-chem', category: 'Open tab', label: 'Ligands & 2D Sketcher', run: () => openTab('chemistry') },
      { id: 'tab-workflow', category: 'Open tab', label: 'Workflow Canvas', run: () => openTab('workflow') },
      { id: 'tab-compute', category: 'Open tab', label: 'GPU & Compute Nodes', run: () => openTab('compute') },
      { id: 'tab-plugins', category: 'Open tab', label: 'Plugins & Add-ons', run: () => openTab('plugins') },
      { id: 'toggle-molstar', category: '3D view', label: `Switch 3D Engine (${viewportEngine === 'molstar' ? 'Fast WebGL2' : 'Mol* Pro'})`, run: () => setViewportEngine((v) => (v === 'molstar' ? 'webgl2' : 'molstar')) },
      { id: 'tab-ai', category: 'Open tab', label: 'AI Assistant', run: () => openTab('assistant') },
      { id: 'tab-mcp', category: 'Open tab', label: 'MCP Server', run: () => openTab('mcp') },
      { id: 'tab-lib', category: 'Open tab', label: 'Library', run: () => openTab('library') },
      { id: 'tab-home', category: 'Open tab', label: 'Start page', run: () => openTab('home') },
      { id: 'cam-site', category: '3D view', label: 'Focus active site', run: () => viewportRef.current?.applyPreset('active-site') },
      { id: 'cam-reset', category: '3D view', label: 'Reset camera', run: () => viewportRef.current?.applyPreset('overview') },
      { id: 'color-plddt', category: '3D view', label: 'Color by pLDDT', run: () => setColorMode('plddt') },
      { id: 'color-b', category: '3D view', label: 'Color by B-factor', run: () => setColorMode('bfactor') },
      { id: 'color-dev', category: '3D view', label: 'Color by deviation Δd', run: () => setColorMode('deviation') },
      { id: 'color-id', category: '3D view', label: 'Color by structure', run: () => setColorMode('identity') },
      { id: 'export-html', category: 'Export', label: 'HTML report', run: handleExportHtmlReport },
      { id: 'export-json', category: 'Export', label: 'JSON manifest', run: handleExportJsonManifest },
      { id: 'export-bundle', category: 'Export', label: 'Project bundle', run: () => void handleExportBundle() },
      { id: 'settings', category: 'Settings', label: 'Open settings', shortcut: '⌘,', run: () => openSettings() },
      { id: 'settings-ai', category: 'Settings', label: 'AI & API keys', run: () => openSettings('ai') },
      { id: 'settings-usage', category: 'Settings', label: 'Usage', run: () => openSettings('usage') },
      {
        id: 'settings-account',
        category: 'Settings',
        label: authSession ? 'Account' : 'Sign in',
        run: () => (authSession ? openSettings('account') : startSignIn('signin')),
      },
      { id: 'ui-bigger', category: 'View', label: 'Increase interface size', shortcut: '⌘+', run: () => stepUiScale(1) },
      { id: 'ui-smaller', category: 'View', label: 'Decrease interface size', shortcut: '⌘−', run: () => stepUiScale(-1) },
      { id: 'sidebar', category: 'View', label: 'Toggle sidebar', shortcut: '⌘B', run: () => setSidebarOpen((v) => !v) },
      { id: 'layout-reset', category: 'View', label: 'Reset tab layout', run: () => dispatchLayout({ type: 'reset' }) },
    ],
    [seedPinnedDemo, openTab, handleExportHtmlReport, handleExportJsonManifest, handleExportBundle, openSettings, authSession, startSignIn],
  );

  // ---------------------------------------------------------------- tabs

  const openTabs = useMemo(() => new Set(layout.groups.flatMap((g) => g.tabs)), [layout]);
  const loadedShas = useMemo(() => {
    const s = new Set<string>();
    if (refInspect) s.add(refInspect.sha256);
    if (mobInspect) s.add(mobInspect.sha256);
    return s;
  }, [refInspect, mobInspect]);

  const ic = 'h-4 w-4';
  const tabMeta: Record<ToolTabId, TabMeta> = {
    home: { title: 'Start', icon: <Home className={ic} /> },
    viewer: { title: '3D Viewer', icon: <Box className={ic} /> },
    results: { title: 'Results', icon: <Layers className={ic} /> },
    sequence: { title: 'Sequence', icon: <GitCompareArrows className={ic} /> },
    ramachandran: { title: 'Ramachandran', icon: <Activity className={ic} /> },
    peptide: { title: 'Peptide', icon: <Scissors className={ic} /> },
    crispr: { title: 'CRISPR', icon: <Dna className={ic} /> },
    chemistry: { title: 'Ligands', icon: <Atom className={ic} /> },
    workflow: { title: 'Workflows', icon: <GitBranch className={ic} /> },
    compute: {
      title: 'GPU Nodes',
      icon: <Cpu className={ic} />,
      badge: computeSnapshot.activeNode?.online ? (
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
      ) : undefined,
    },
    plugins: { title: 'Plugins', icon: <Puzzle className={ic} /> },
    assistant: {
      title: 'Assistant',
      icon: <Bot className={ic} />,
      badge: agentBusy ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" /> : undefined,
    },
    mcp: { title: 'MCP Server', icon: <Server className={ic} /> },
    library: { title: 'Library', icon: <Library className={ic} /> },
  };

  const guided = settings.guidedMode;
  const wrap = (node: ReactNode) => <div className="h-full overflow-auto">{node}</div>;

  const renderTab = (id: ToolTabId): ReactNode => {
    switch (id) {
      case 'home':
        return (
          <HomeView
            activeStarterId={activeStarterId}
            runHistory={runHistory}
            projects={projectsSnap.projects}
            activeProject={projectsSnap.activeProject}
            onCreateProject={handleCreateProject}
            onSwitchProject={(pid) => {
              switchProject(pid);
              toast('Switched active project', 'info');
            }}
            onDeleteProject={(pid) => {
              deleteProject(pid);
              toast('Deleted project', 'info');
            }}
            onOpenTutorial={() => setTutorialOpen(true)}
            onImportFile={() => openFileRef.current?.click()}
            onSearchDatabases={() => setDbExplorerOpen(true)}
            onOpenLibrary={() => openTab('library')}
            onOpenAssistant={() => openTab('assistant')}
            onOpenChemistry={() => openTab('chemistry')}
            onOpenPeptide={() => openTab('peptide')}
            onOpenCrispr={() => openTab('crispr')}
            onOpenWorkflows={() => openTab('workflow')}
            onOpenComputeNodes={() => openTab('compute')}
            onOpenPlugins={() => openTab('plugins')}
            onLaunchStarter={(p) => void handleLaunchStarter(p)}
            onOpenLibraryItem={(it) => void openLibraryItem(it, 'auto')}
          />
        );
      case 'viewer':
        return (
          <div className="flex h-full flex-col">
            <div className="flex h-8 shrink-0 items-center justify-between border-b border-white/[0.06] bg-[#0a0d13] px-2.5 text-[0.75rem]">
              <div className="flex items-center gap-1">
                <span className="mr-1 text-slate-500">3D Engine:</span>
                <button
                  type="button"
                  onClick={() => setViewportEngine('webgl2')}
                  className={`rounded-md px-2 py-0.5 font-medium transition ${
                    viewportEngine === 'webgl2'
                      ? 'bg-sky-500/20 text-sky-200'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Fast WebGL2
                </button>
                <button
                  type="button"
                  onClick={() => setViewportEngine('molstar')}
                  className={`rounded-md px-2 py-0.5 font-medium transition ${
                    viewportEngine === 'molstar'
                      ? 'bg-sky-500/20 text-sky-200'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Mol* Pro
                </button>
              </div>
              {extraViewerOverlay && (
                <div className="flex items-center gap-2 font-mono text-[0.6875rem] text-emerald-300">
                  <span>Overlay: {extraViewerOverlay.label}</span>
                  <button
                    type="button"
                    onClick={() => setExtraViewerOverlay(null)}
                    className="text-slate-400 hover:text-slate-200"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
            <div className="relative min-h-0 flex-1">
              {viewportEngine === 'molstar' ? (
                <Suspense
                  fallback={
                    <div className="flex h-full items-center justify-center bg-[#070b12] text-xs text-slate-400">
                      Loading Mol* Pro 3D engine…
                    </div>
                  }
                >
                  <MolStarViewportLazy
                    ref={viewportRef}
                    refLabel={refLabel}
                    refContent={refContent}
                    mobLabel={mobLabel}
                    mobContent={mobContent}
                    comparison={comparison}
                    layout={viewportLayout}
                    style={renderStyle}
                    colorMode={colorMode}
                    focusedSeqId={focusedSeqId}
                    extraOverlay={extraViewerOverlay}
                    onPickResidue={focusResidueGlobally}
                    onSendPocketToDocking={() => {
                      setStagedComputeTarget({ tool: 'vina', nonce: Date.now() });
                      openTab('compute');
                    }}
                  />
                </Suspense>
              ) : (
                <MolecularViewport
                  ref={viewportRef}
                  comparison={comparison}
                  refInspect={refInspect}
                  mobInspect={mobInspect}
                  refChainId={refChain}
                  mobChainId={mobChain}
                  layout={viewportLayout}
                  onChangeLayout={setViewportLayout}
                  style={renderStyle}
                  onChangeStyle={setRenderStyle}
                  colorMode={colorMode}
                  onChangeColorMode={setColorMode}
                  focusedSeqId={focusedSeqId}
                  highlightedSeqIds={highlightedSeqIds}
                  paePair={selectedPaePair}
                  onPickResidue={focusResidueGlobally}
                  onRendererModeDetected={setRendererMode}
                  simpleMode={false}
                />
              )}
              {!refContent && !mobContent && !busyLabel && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
                  <div className="pointer-events-auto max-w-sm rounded-2xl border border-white/10 bg-[#121722]/95 p-6 text-center shadow-2xl backdrop-blur">
                    <Box className="mx-auto h-8 w-8 text-slate-500" />
                    <div className="mt-3 text-base font-medium text-slate-100">No structure loaded</div>
                    <p className="mt-1 text-sm text-slate-400">Open a file, pick one from your library, or search a public database.</p>
                    <div className="mt-4 flex flex-wrap justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => openFileRef.current?.click()}
                        className="rounded-lg bg-sky-500 px-3.5 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400"
                      >
                        Open file
                      </button>
                      <button
                        type="button"
                        onClick={() => setDbExplorerOpen(true)}
                        className="rounded-lg border border-white/10 px-3.5 py-2 text-sm text-slate-200 hover:bg-white/[0.06]"
                      >
                        Search databases
                      </button>
                    </div>
                    <button type="button" onClick={() => void seedPinnedDemo()} className="mt-3 text-xs text-slate-500 hover:text-sky-300">
                      or load the example comparison
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      case 'results':
        return (
          <ResultsView
            comparison={comparison}
            paeJson={paeJson}
            busy={Boolean(busyLabel)}
            guided={guided}
            selectedPaePair={selectedPaePair}
            onSelectPaePair={(i, j) => {
              setSelectedPaePair([i, j]);
              focusResidueGlobally(i);
            }}
            includePng={embedPng}
            onToggleIncludePng={(v) => updateSettings((s) => ({ ...s, viewer: { ...s.viewer, embedPngInReports: v } }))}
            onExportHtml={handleExportHtmlReport}
            onExportJson={handleExportJsonManifest}
            onExportBundle={() => void handleExportBundle()}
          />
        );
      case 'sequence':
        return wrap(
          <SequenceDeviationTrack
            comparison={comparison}
            refInspect={refInspect}
            mobInspect={mobInspect}
            refChainId={refChain}
            mobChainId={mobChain}
            focusedSeqId={focusedSeqId}
            onFocusResidue={focusResidueGlobally}
          />,
        );
      case 'ramachandran':
        return wrap(
          <RamachandranPanel
            refLabel={refLabel}
            refChain={refChain}
            mobLabel={mobLabel}
            mobChain={mobChain}
            activeSource={ramachandranSource}
            onChangeSource={setRamachandranSource}
            result={ramachandranResult}
            error={ramachandranError}
            focusedSeqId={focusedSeqId}
            onFocusResidue={focusResidueGlobally}
            simpleMode={guided}
          />,
        );
      case 'peptide':
        return wrap(
          <PeptideWorkbench
            state={peptideState}
            dispatch={peptideDispatch}
            result={peptideResult}
            error={peptideError}
            onFocusResidue={focusResidueGlobally}
            simpleMode={guided}
          />,
        );
      case 'crispr':
        return wrap(
          <CrisprWorkbench
            state={crisprState}
            dispatch={crisprDispatch}
            result={crisprResult}
            error={crisprError}
            onFocusResidue={focusResidueGlobally}
            simpleMode={guided}
          />,
        );
      case 'chemistry':
        return wrap(
          <ChemistryWorkbench
            state={chemState}
            dispatch={chemDispatch}
            result={smilesResult}
            comparison={comparison}
            error={smilesError}
            onFocusResidue={focusResidueGlobally}
            onStageForCompute={(tool, payload) => {
              chemDispatch({ type: 'set_custom_smiles', smiles: payload.smiles, name: payload.name });
              setStagedComputeTarget({ tool, nonce: Date.now() });
              openTab('compute');
            }}
            libraryCompounds={libraryItems
              .filter((i) => i.kind === 'compound')
              .map((i) => ({ id: i.id, name: i.name, smiles: i.content }))}
            simpleMode={guided}
          />,
        );
      case 'workflow':
        return (
          <WorkflowCanvas
            onExecuteNode={executeWorkflowNode}
            activeComputeLabel={
              computeSnapshot.activeNode?.online ? computeSnapshot.activeNode.label : null
            }
            onOpenComputeNodes={() => openTab('compute')}
          />
        );
      case 'compute':
        return (
          <ComputeNodesView
            activeSmiles={chemState.smiles}
            activeSmilesName={chemState.name}
            activeRefPdbOrCif={refContent}
            activeRefLabel={refLabel}
            pocketBox={activePocketBox}
            stagedComputeTarget={stagedComputeTarget}
            onImportArtifactToViewer={(payload) => {
              setExtraViewerOverlay({ id: `art-${Date.now()}`, ...payload });
              setViewportEngine('molstar');
              openTab('viewer');
            }}
          />
        );
      case 'plugins':
        return (
          <PluginsView
            onOpenComputeNodes={() => openTab('compute')}
            onOpenMcpServer={() => openTab('mcp')}
          />
        );
      case 'assistant':
        return (
          <AssistantView
            messages={agentMessages}
            busy={agentBusy}
            config={aiConfig}
            liveSteps={liveAgentSteps}
            pendingPermission={pendingPermission}
            onResolvePermission={resolveToolPermission}
            onSelectProvider={(p: AiProviderId, model?: string) =>
              updateAiConfig({
                provider: p,
                ...(p === 'synlexa' && resolveActiveAiRoute(aiConfig).hasByok ? { routingPreference: 'manual' } : {}),
                ...(model ? { [p]: { model } } : {}),
              })
            }
            onToggleWebSearch={(enabled) => updateAiConfig({ enableWebSearch: enabled })}
            onSend={(t) => void handleSendAgentPrompt(t)}
            onClear={() => setAgentMessages([])}
            onOpenKeySettings={() => openSettings('ai')}
            onOpenMcpServer={() => openTab('mcp')}
          />
        );
      case 'mcp':
        return (
          <McpServerView
            runtime={mcpRuntime}
            onOpenAiAssistant={() => openTab('assistant')}
            onOpenVaultSettings={() => openSettings('ai')}
          />
        );
      case 'library':
        return <LibraryView onOpenItem={(it, t) => void openLibraryItem(it, t)} loadedShas={loadedShas} />;
    }
  };

  const activeRoute = resolveActiveAiRoute(aiConfig);
  const activeAi = aiConfig[activeRoute.provider] ?? { apiKey: '', model: '' };
  const activeModelShort = AI_PROVIDERS[activeRoute.provider].models.find((m) => m.id === activeAi.model)?.label ?? activeAi.model;
  const aiLabel = activeAi.apiKey
    ? `${activeRoute.isByok ? 'BYOK' : 'Cloud'}: ${activeModelShort}`
    : activeRoute.provider === 'synlexa'
      ? 'AI: sign in or add BYOK'
      : 'AI: no key';

  const projectTitle =
    projectsSnap.activeProject?.name ??
    (activeStarterId ? findStarter(activeStarterId)?.title : null) ??
    (refLabel || mobLabel ? [refLabel, mobLabel].filter(Boolean).join(' vs ') : 'Untitled workspace');

  const handleTutorialAction = (key: TutorialStep['tryActionKey']) => {
    if (key === 'settings') openSettings('ai');
    else openTab(key);
  };

  const sidebarTitles: Record<SidebarView, string> = {
    explorer: 'Workspace',
    library: 'Library',
    tools: 'Tools',
    history: 'History',
  };

  return (
    <div className="flex h-dvh w-screen flex-col overflow-hidden bg-[#0b0e14] text-slate-100">
      <input
        ref={openFileRef}
        type="file"
        multiple
        accept=".cif,.mmcif,.pdb,.ent,.json,.fasta,.fa,.faa,.smi"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void handleUploadFiles(e.target.files, 'auto');
          e.target.value = '';
        }}
      />

      <TitleBar
        projectTitle={projectTitle}
        session={authSession}
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenFile={() => openFileRef.current?.click()}
        onSearchDatabases={() => setDbExplorerOpen(true)}
        onOpenMcp={() => openTab('mcp')}
        onOpenTutorial={() => setTutorialOpen(true)}
        onExportHtml={handleExportHtmlReport}
        onExportJson={handleExportJsonManifest}
        onExportBundle={() => void handleExportBundle()}
        canExport={Boolean(comparison)}
        onOpenAccount={() => openSettings('account')}
      />

      <div className="flex min-h-0 flex-1">
        <ActivityRail
          view={sidebarView}
          sidebarOpen={sidebarOpen}
          onSelect={(v) => {
            if (sidebarOpen && v === sidebarView) setSidebarOpen(false);
            else {
              setSidebarView(v);
              setSidebarOpen(true);
            }
          }}
          onOpenSettings={() => openSettings()}
          onOpenAssistant={() => openTab('assistant')}
          onOpenMcp={() => openTab('mcp')}
          libraryCount={libraryItems.length}
        />

        {sidebarOpen && (
          <SidebarFrame
            title={sidebarTitles[sidebarView]}
            width={sidebarView === 'library' ? 304 : 276}
            actions={
              sidebarView === 'library' ? (
                <IconButton label="Open full library manager" onClick={() => openTab('library')}>
                  <Maximize2 className="h-3.5 w-3.5" />
                </IconButton>
              ) : undefined
            }
          >
            {sidebarView === 'explorer' && (
              <ExplorerPanel
                refLabel={refLabel}
                mobLabel={mobLabel}
                refInspect={refInspect}
                mobInspect={mobInspect}
                refChain={refChain}
                mobChain={mobChain}
                hasRef={Boolean(refContent)}
                hasMob={Boolean(mobContent)}
                paePresent={Boolean(paeJson)}
                chainError={chainError}
                onChangeRefChain={(c) => {
                  setRefChain(c);
                  void runComparison({ ...currentPair(), rChain: c });
                }}
                onChangeMobChain={(c) => {
                  setMobChain(c);
                  const seq = mobInspect?.chains.find((x) => x.chainId === c)?.sequence1Letter;
                  if (seq) peptideDispatch({ type: 'set_sequence', sequence: seq });
                  void runComparison({ ...currentPair(), mChain: c });
                }}
                onUploadFiles={(files, role) => void handleUploadFiles(files, role)}
                onSaveToLibrary={saveSlotToLibrary}
                onSearchDatabases={() => setDbExplorerOpen(true)}
                onLoadExample={() => void seedPinnedDemo()}
                projects={projectsSnap.projects}
                activeProject={projectsSnap.activeProject}
                onCreateProject={handleCreateProject}
                onSwitchProject={(pid) => switchProject(pid)}
                onSplitStructure={(role) => handleSplitStructure(role)}
                onLoadProjectStructure={handleLoadProjectStructure}
                onOpenProjectMolecule={(mol) => {
                  chemDispatch({ type: 'set_custom_smiles', smiles: mol.smiles, name: mol.name });
                  openTab('chemistry');
                }}
                onDockMolecule={handleDockMolecule}
                onRemoveProjectAsset={(kind, id) => removeProjectAsset(kind, id)}
                onOpenChemistry={() => openTab('chemistry')}
                onOpenPeptide={() => openTab('peptide')}
                onOpenCrispr={() => openTab('crispr')}
              />
            )}
            {sidebarView === 'library' && (
              <LibraryView compact onOpenItem={(it, t) => void openLibraryItem(it, t)} loadedShas={loadedShas} />
            )}
            {sidebarView === 'tools' && <ToolsPanel openTabs={openTabs} onOpen={(id, side) => openTab(id, side)} />}
            {sidebarView === 'history' && (
              <HistoryPanel runs={runHistory} onClear={() => void clearRunHistory().then(() => setRunHistory([]))} />
            )}
          </SidebarFrame>
        )}

        <main className="flex min-w-0 flex-1 flex-col">
          <EditorArea layout={layout} dispatch={dispatchLayout} meta={tabMeta} renderTab={renderTab} keepAlive={KEEP_ALIVE} />
        </main>
      </div>

      <StatusBar
        busyLabel={busyLabel}
        wasmReady={wasmReady}
        rendererMode={rendererMode}
        rmsd={comparison?.metrics.rmsdAngstrom ?? null}
        focusedSeqId={focusedSeqId}
        computeNodeLabel={computeSnapshot.activeNode?.label ?? null}
        computeOnline={Boolean(computeSnapshot.activeNode?.online)}
        onOpenComputeNodes={() => openTab('compute')}
        aiLabel={aiLabel}
        aiReady={Boolean(activeAi.apiKey)}
        onOpenAiSettings={() => openSettings('ai')}
      />

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={paletteCommands} />
      <DatabaseExplorerModal
        open={dbExplorerOpen}
        onClose={() => setDbExplorerOpen(false)}
        onImportStructure={handleImportStructureFromDb}
        onImportCompound={handleImportCompoundFromDb}
      />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        section={settingsSection}
        onSectionChange={setSettingsSection}
        aiConfig={aiConfig}
        onUpdateAiConfig={updateAiConfig}
        onPermissionsChange={setPermissionPolicies}
        session={authSession}
        onSessionChange={handleSessionChange}
        onSignIn={startSignIn}
        onCancelSignIn={cancelSignIn}
        signInPending={signInPending}
        onResetLayout={() => dispatchLayout({ type: 'reset' })}
        onClearedHistory={() => setRunHistory([])}
      />
      <TutorialGuideModal
        open={tutorialOpen}
        onClose={() => setTutorialOpen(false)}
        onExecuteStepAction={handleTutorialAction}
      />
    </div>
  );
}

export default App;
