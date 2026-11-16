import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Atom,
  Box,
  BookmarkPlus,
  Check,
  CheckCircle2,
  Copy,
  Cpu,
  Crosshair,
  Download,
  FlaskConical,
  FolderPlus,
  Pencil,
  Play,
  Search,
  ShieldCheck,
} from 'lucide-react';
import type {
  AnalyzeMoleculeSmilesResult,
  CompareStructuresResult,
} from '@synlexa/wasm-bridge';
import { explainClogP, explainLipinski, explainTpsa } from '../lib/metricInsights';
import {
  getSharedRdkitClient,
  type RdkitMoleculeAnalysis,
  type RdkitSearchHit,
} from '../lib/rdkitClient';
import type { Studio3DBridge } from '../lib/studioBridge';
import {
  SMILES_PRESETS,
  type ChemistryAction,
  type ChemistryWorkbenchState,
} from '../lib/workbenchReducers';
import { MetricInsightBadge } from './MetricInsightBadge';
import { MoleculeSketcher2D } from './MoleculeSketcher2D';
import { MetricInfoCell, Project3DContextBanner, ToolGuideCard } from './WorkbenchShared';

interface ChemistryWorkbenchProps {
  state: ChemistryWorkbenchState;
  dispatch: (action: ChemistryAction) => void;
  result: AnalyzeMoleculeSmilesResult | null;
  comparison: CompareStructuresResult | null;
  error: string | null;
  onFocusResidue: (seqId: number) => void;
  onStageForCompute?: (target: 'vina' | 'pyscf', payload: { name: string; smiles: string; molblock2d?: string }) => void;
  libraryCompounds?: Array<{ id: string; name: string; smiles: string }>;
  simpleMode?: boolean;
  bridge?: Studio3DBridge;
}

type ChemSubMode = 'analyze' | 'sketch' | 'search';

const SMARTS_HIGHLIGHT_PRESETS = [
  { label: 'Sulfonamide', smarts: 'S(=O)(=O)N' },
  { label: 'Benzene', smarts: 'c1ccccc1' },
  { label: 'Amide', smarts: 'C(=O)N' },
  { label: 'Carboxyl', smarts: 'C(=O)[OH]' },
  { label: 'Halogen', smarts: '[F,Cl,Br,I]' },
  { label: 'Heterocycle', smarts: '[n,o,s]' },
];

const SEARCH_SMARTS_EXAMPLES = [
  { label: 'Sulfonamide', query: 'S(=O)(=O)N' },
  { label: 'Aryl Ring', query: 'c1ccccc1' },
  { label: 'Amide', query: 'C(=O)N' },
  { label: 'Carbonyl', query: 'C=O' },
  { label: 'Acetazolamide-like', query: 'CC(=O)Nc1nnc(S(N)(=O)=O)s1' },
];

export function ChemistryWorkbench({
  state,
  dispatch,
  result,
  comparison,
  error,
  onFocusResidue,
  onStageForCompute,
  libraryCompounds = [],
  simpleMode = false,
  bridge,
}: ChemistryWorkbenchProps) {
  const [smilesDraft, setSmilesDraft] = useState(state.smiles);
  const [nameDraft, setNameDraft] = useState(state.name);
  const [subMode, setSubMode] = useState<ChemSubMode>('analyze');
  const [guideOpen, setGuideOpen] = useState(false);
  const [highlightSmarts, setHighlightSmarts] = useState('');
  const [rdkitData, setRdkitData] = useState<RdkitMoleculeAnalysis | null>(null);
  const [rdkitBusy, setRdkitBusy] = useState(false);
  const [rdkitError, setRdkitError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [savedToast, setSavedToast] = useState<string | null>(null);

  // Similarity comparison against presets + active project molecules
  const [similarityHits, setSimilarityHits] = useState<RdkitSearchHit[]>([]);

  // Search tab state
  const [searchQuery, setSearchQuery] = useState('S(=O)(=O)N');
  const [searchHits, setSearchHits] = useState<RdkitSearchHit[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);

  // 3D Pocket Contact controls
  const [contactCutoff, setContactCutoff] = useState(4.5);
  const [ligandFilter, setLigandFilter] = useState<string>('ALL');
  const [contactView, setContactView] = useState<'grouped' | 'atoms'>('grouped');

  useEffect(() => {
    setSmilesDraft(state.smiles);
    setNameDraft(state.name);
  }, [state.smiles, state.name]);

  // Lazily run RDKit WASM only in browser environments when the Chemistry panel is active.
  useEffect(() => {
    if (typeof Worker === 'undefined' || !state.smiles.trim()) return;
    let alive = true;
    setRdkitBusy(true);
    setRdkitError(null);
    void getSharedRdkitClient()
      .analyzeMolecule(state.smiles, { highlightSmarts: highlightSmarts || undefined })
      .then((res) => {
        if (alive) setRdkitData(res);
      })
      .catch((err) => {
        if (alive) setRdkitError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (alive) setRdkitBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [state.smiles, highlightSmarts]);

  // Compute Morgan Tanimoto similarity against presets & project molecules
  useEffect(() => {
    if (typeof Worker === 'undefined' || !state.smiles.trim()) return;
    let alive = true;
    const candidates = [
      ...SMILES_PRESETS.map((p) => ({ id: p.id, name: p.name.split(' (')[0], smiles: p.smiles })),
      ...(bridge?.projectMolecules ?? []).map((m) => ({ id: m.id, name: m.name, smiles: m.smiles })),
    ];
    const unique = Array.from(new Map(candidates.map((c) => [c.smiles, c])).values());
    void getSharedRdkitClient()
      .searchLibrary(state.smiles, unique)
      .then((hits) => {
        if (alive) setSimilarityHits(hits.slice(0, 5));
      })
      .catch(() => {
        if (alive) setSimilarityHits([]);
      });
    return () => {
      alive = false;
    };
  }, [state.smiles, bridge?.projectMolecules]);

  const copyText = (id: string, value: string) => {
    void navigator.clipboard?.writeText(value);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const flashSaved = (label: string) => {
    setSavedToast(label);
    setTimeout(() => setSavedToast(null), 2000);
  };

  const runCustomSmiles = () => {
    if (!smilesDraft.trim()) return;
    dispatch({
      type: 'set_custom_smiles',
      smiles: smilesDraft.trim(),
      name: nameDraft.trim() || 'Custom SMILES',
    });
  };

  const handleSketchCommit = (molblock: string) => {
    if (typeof Worker === 'undefined') return;
    void getSharedRdkitClient()
      .analyzeMolecule(molblock, { highlightSmarts: highlightSmarts || undefined })
      .then((res) => {
        setRdkitData(res);
        setSmilesDraft(res.canonicalSmiles);
        setNameDraft('2D Sketch Molecule');
        dispatch({
          type: 'set_custom_smiles',
          smiles: res.canonicalSmiles,
          name: '2D Sketch Molecule',
        });
      })
      .catch(() => {
        /* ignore incomplete valence while sketching */
      });
  };

  const runSubstructureSearch = async (overrideQuery?: string) => {
    const q = (overrideQuery ?? searchQuery).trim();
    if (typeof Worker === 'undefined' || !q) return;
    setSearchBusy(true);
    setRdkitError(null);
    try {
      const candidates = [
        ...SMILES_PRESETS.map((p) => ({ id: p.id, name: p.name, smiles: p.smiles })),
        ...(bridge?.projectMolecules ?? []).map((m) => ({ id: m.id, name: m.name, smiles: m.smiles })),
        ...libraryCompounds,
      ];
      const unique = Array.from(new Map(candidates.map((c) => [c.smiles, c])).values());
      const hits = await getSharedRdkitClient().searchLibrary(q, unique);
      setSearchHits(hits);
    } catch (err) {
      setRdkitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearchBusy(false);
    }
  };

  const downloadFile = (filename: string, content: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const safeBaseName = (state.name || 'ligand').replace(/[^a-zA-Z0-9._-]+/g, '_');

  // 3D pocket contact filtering & residue grouping
  const rawContacts = comparison?.refContacts ?? [];
  const ligandNames = useMemo(
    () => Array.from(new Set(rawContacts.map((c) => c.ligandResName))),
    [rawContacts],
  );

  const filteredContacts = useMemo(() => {
    return [...rawContacts]
      .filter((c) => c.distanceAngstrom <= contactCutoff)
      .filter((c) => ligandFilter === 'ALL' || c.ligandResName === ligandFilter)
      .sort((a, b) => {
        const rank = (name: string) => (name === 'AZM' ? 0 : name === 'ZN' ? 1 : 2);
        const dr = rank(a.ligandResName) - rank(b.ligandResName);
        return dr !== 0 ? dr : a.distanceAngstrom - b.distanceAngstrom;
      });
  }, [rawContacts, contactCutoff, ligandFilter]);

  const groupedContacts = useMemo(() => {
    const map = new Map<
      number,
      {
        seqId: number;
        resName3: string;
        minDist: number;
        count: number;
        ligands: Set<string>;
        closestPair: string;
      }
    >();
    for (const c of filteredContacts) {
      const existing = map.get(c.proteinSeqId);
      if (!existing) {
        map.set(c.proteinSeqId, {
          seqId: c.proteinSeqId,
          resName3: c.proteinResName3,
          minDist: c.distanceAngstrom,
          count: 1,
          ligands: new Set([c.ligandResName]),
          closestPair: `${c.ligandResName} ${c.ligandAtom} ↔ ${c.proteinAtom}`,
        });
      } else {
        existing.count += 1;
        existing.ligands.add(c.ligandResName);
        if (c.distanceAngstrom < existing.minDist) {
          existing.minDist = c.distanceAngstrom;
          existing.closestPair = `${c.ligandResName} ${c.ligandAtom} ↔ ${c.proteinAtom}`;
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => a.minDist - b.minDist);
  }, [filteredContacts]);

  const focusPocketResidueIn3D = (seqId: number) => {
    onFocusResidue(seqId);
    bridge?.focusIn3D(seqId, { centerCamera: true, style: 'pocket' });
  };

  const highlightPocketIn3D = () => {
    if (!bridge || groupedContacts.length === 0) return;
    const seqIds = groupedContacts.map((g) => g.seqId);
    bridge.highlightIn3D(seqIds, `Pocket ≤${contactCutoff.toFixed(1)} Å`, {
      focusSeqId: groupedContacts[0]?.seqId,
      style: 'pocket',
    });
  };

  const canonicalOrDraft = rdkitData?.canonicalSmiles ?? state.smiles;
  const activePocketSeqIds = useMemo(() => new Set(groupedContacts.map((g) => g.seqId)), [groupedContacts]);
  const coCrystalLigands = bridge?.coCrystalLigands ?? [];

  return (
    <div className="@container flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3 text-xs @xl:p-4">
      <Project3DContextBanner
        bridge={bridge}
        title="Ligands, 2D Sketcher & Binding Prep"
        subtitle="Inspect SMILES, compute deterministic RDKit descriptors & PAINS alerts, sketch analogs, and inspect 3D receptor pockets."
        icon={<Atom className="h-4 w-4" />}
        guideOpen={guideOpen}
        onToggleGuide={() => setGuideOpen((v) => !v)}
        actions={
          rdkitData && (
            <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 font-mono text-[0.6875rem] text-emerald-300">
              RDKit {rdkitData.rdkitVersion} WASM
            </span>
          )
        }
      />

      <ToolGuideCard
        open={guideOpen}
        title="How Ligands & 2D Sketcher Works"
        summary="Design or load small-molecule ligands using SMILES or the interactive 2D SVG canvas. All physicochemical properties, Lipinski/Veber/Ghose heuristics, and PAINS/Brenk alerts run locally in your browser via Rust + RDKit WebAssembly (RUO)."
        steps={[
          'Pick a preset scaffold, a molecule from your Active Project, or paste any SMILES string and click Analyze.',
          'Switch to 2D Sketcher to draw bonds/rings visually or edit an existing scaffold; changes auto-update descriptors.',
          'Use Highlight SMARTS chips to visually locate functional groups (e.g. sulfonamide zinc-binders) and Substructure Search to screen your project + library.',
        ]}
        connectionTip="When a 3D receptor complex (like 3HS4 with AZM & Zn²⁺) is loaded in the main 3D project, the 3D Binding Pocket panel lists every protein contact residue. Click any residue or 'Highlight Pocket in 3D' to focus the 3D camera directly on the active site, or send your ligand + pocket box straight to AutoDock Vina / PySCF."
        glossary={[
          { term: 'SMILES', desc: 'Text notation describing a molecule’s atoms, bonds, rings, and stereochemistry.' },
          { term: 'SMARTS', desc: 'Substructure pattern language (e.g. S(=O)(=O)N for sulfonamide) used for highlighting and screening.' },
          { term: 'TPSA (Å²)', desc: 'Topological Polar Surface Area. Values ≤ 140 Å² are generally favored for passive membrane permeation.' },
          { term: 'cLogP', desc: 'Wildman-Crippen octanol-water partition coefficient estimating lipophilicity (Rule of 5 ≤ 5).' },
          { term: 'Fsp³', desc: 'Fraction of sp³ hybridized carbons (0–1); higher values indicate greater 3D saturation rather than flat aromaticity.' },
          { term: 'PAINS / Brenk', desc: 'Empirical substructure filters flagging potentially reactive, promiscuous, or assay-interfering motifs.' },
        ]}
      />

      {/* Mode Switcher & Workspace Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-[#0b1018] p-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ['analyze', 'Analyze & Depict', <Atom key="a" className="h-3.5 w-3.5" />],
              ['sketch', '2D Sketcher', <Pencil key="s" className="h-3.5 w-3.5" />],
              ['search', 'Substructure & Similarity', <Search key="q" className="h-3.5 w-3.5" />],
            ] as const
          ).map(([id, label, icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSubMode(id)}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                subMode === id
                  ? 'border-sky-400/50 bg-sky-500/20 text-sky-200'
                  : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/20 hover:text-white'
              }`}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {savedToast && (
            <span className="rounded-md bg-emerald-500/15 px-2 py-1 text-[0.6875rem] font-medium text-emerald-300">
              {savedToast}
            </span>
          )}
          {bridge && (
            <>
              <button
                type="button"
                onClick={() => {
                  bridge.saveMoleculeToProject({
                    name: nameDraft.trim() || state.name,
                    smiles: canonicalOrDraft,
                    molblock2d: rdkitData?.molblock2d,
                    note: rdkitData
                      ? `MW ${rdkitData.descriptors.molecularWeight.toFixed(1)} · cLogP ${rdkitData.descriptors.crippenLogP.toFixed(2)}`
                      : undefined,
                  });
                  flashSaved('Saved to Project');
                }}
                title="Save active ligand into the active project's asset list"
                className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-slate-200 hover:border-sky-400/40 hover:text-sky-200"
              >
                <FolderPlus className="h-3.5 w-3.5 text-sky-300" /> Save to Project
              </button>
              <button
                type="button"
                onClick={() => {
                  bridge.saveMoleculeToLibrary({
                    name: nameDraft.trim() || state.name,
                    smiles: canonicalOrDraft,
                  });
                  flashSaved('Saved to Library');
                }}
                title="Save active ligand to persistent local device library"
                className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-slate-200 hover:border-emerald-400/40 hover:text-emerald-200"
              >
                <BookmarkPlus className="h-3.5 w-3.5 text-emerald-300" /> Library
              </button>
            </>
          )}
          {onStageForCompute && (
            <>
              <button
                type="button"
                title="Stage this ligand + active 3D pocket box for AutoDock Vina on a GPU/compute node"
                onClick={() =>
                  onStageForCompute('vina', {
                    name: state.name,
                    smiles: canonicalOrDraft,
                    molblock2d: rdkitData?.molblock2d,
                  })
                }
                className="flex items-center gap-1 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-2.5 py-1.5 text-xs font-medium text-cyan-200 hover:bg-cyan-500/25"
              >
                <FlaskConical className="h-3.5 w-3.5" /> Dock (Vina)
              </button>
              <button
                type="button"
                title="Stage this ligand for PySCF DFT frontier orbital calculation on a compute node"
                onClick={() =>
                  onStageForCompute('pyscf', {
                    name: state.name,
                    smiles: canonicalOrDraft,
                    molblock2d: rdkitData?.molblock2d,
                  })
                }
                className="flex items-center gap-1 rounded-lg border border-violet-500/40 bg-violet-500/15 px-2.5 py-1.5 text-xs font-medium text-violet-200 hover:bg-violet-500/25"
              >
                <Cpu className="h-3.5 w-3.5" /> Quantum (PySCF)
              </button>
            </>
          )}
        </div>
      </div>

      {/* Molecule Selector & SMILES Input Card */}
      <div className="space-y-2.5 rounded-xl border border-white/[0.08] bg-[#0b1018] p-3">
        <div className="grid grid-cols-1 gap-2 @xl:grid-cols-[12rem_1fr_auto]">
          <input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            placeholder="Ligand name…"
            aria-label="Ligand name"
            className="h-9 rounded-lg border border-white/10 bg-slate-950 px-2.5 text-xs font-medium text-slate-100 outline-none focus:border-cyan-500"
          />
          <div className="flex min-w-0 items-center gap-1 rounded-lg border border-white/10 bg-slate-950 px-2.5 focus-within:border-cyan-500">
            <span className="shrink-0 font-mono text-[0.6875rem] text-slate-500">SMILES</span>
            <input
              value={smilesDraft}
              onChange={(e) => setSmilesDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') runCustomSmiles();
              }}
              placeholder="Paste SMILES string (e.g. CC(=O)Nc1nnc(S(N)(=O)=O)s1)…"
              aria-label="SMILES input"
              className="h-9 min-w-0 flex-1 bg-transparent font-mono text-xs text-slate-100 outline-none"
            />
            {smilesDraft && (
              <button
                type="button"
                onClick={() => copyText('smiles', smilesDraft)}
                title="Copy SMILES"
                className="rounded p-1 text-slate-400 hover:bg-white/[0.07] hover:text-slate-100"
              >
                {copiedId === 'smiles' ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={runCustomSmiles}
            className="flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25"
          >
            <Play className="h-3.5 w-3.5" /> Analyze
          </button>
        </div>

        {/* Presets + Project Molecules + 3D Ligands */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[0.6875rem] font-medium text-slate-400">Presets:</span>
          {SMILES_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              title={`${p.note} — ${p.smiles}`}
              onClick={() => {
                dispatch({ type: 'select_preset', presetId: p.id });
                setSmilesDraft(p.smiles);
                setNameDraft(p.name);
              }}
              className={`rounded-md border px-2 py-0.5 text-[0.75rem] transition ${
                state.selectedPresetId === p.id
                  ? 'border-cyan-500/50 bg-cyan-500/20 text-cyan-200'
                  : 'border-white/10 bg-slate-900/70 text-slate-300 hover:border-white/25'
              }`}
            >
              {p.name.split(' (')[0]}
            </button>
          ))}

          {bridge && bridge.projectMolecules.length > 0 && (
            <>
              <span className="mx-1 h-3.5 w-px bg-white/10" />
              <span className="text-[0.6875rem] font-medium text-violet-300">Project:</span>
              {bridge.projectMolecules.slice(0, 6).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  title={`Load project molecule: ${m.smiles}`}
                  onClick={() => {
                    dispatch({ type: 'set_custom_smiles', smiles: m.smiles, name: m.name });
                    setSmilesDraft(m.smiles);
                    setNameDraft(m.name);
                  }}
                  className={`rounded-md border px-2 py-0.5 text-[0.75rem] transition ${
                    state.smiles === m.smiles
                      ? 'border-violet-400/50 bg-violet-500/20 text-violet-200'
                      : 'border-violet-500/25 bg-violet-500/5 text-violet-200/80 hover:border-violet-400/40'
                  }`}
                >
                  {m.name.split(' (')[0]}
                </button>
              ))}
            </>
          )}

          {coCrystalLigands.length > 0 && (
            <>
              <span className="mx-1 h-3.5 w-px bg-white/10" />
              <span className="text-[0.6875rem] font-medium text-emerald-300">3D Co-Crystal:</span>
              {coCrystalLigands.map((lig) => (
                <button
                  key={`${lig.chainId}-${lig.seqId}-${lig.resName}`}
                  type="button"
                  title={`Focus 3D active pocket around ${lig.resName} (${lig.atomCount} atoms)`}
                  onClick={() => {
                    setLigandFilter(lig.resName);
                    if (lig.resName.toUpperCase() === 'AZM') {
                      dispatch({ type: 'select_preset', presetId: 'azm' });
                    }
                    bridge?.setStyle3D('pocket');
                    if (groupedContacts[0]) {
                      bridge?.focusIn3D(groupedContacts[0].seqId, { centerCamera: true, style: 'pocket' });
                    }
                  }}
                  className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[0.75rem] text-emerald-200 hover:bg-emerald-500/20"
                >
                  <Crosshair className="h-3 w-3" />
                  {lig.resName} ({lig.atomCount}a)
                </button>
              ))}
            </>
          )}
        </div>
      </div>

      {subMode === 'sketch' && (
        <MoleculeSketcher2D
          initialMolblock={rdkitData?.molblock2d}
          activeSmiles={canonicalOrDraft}
          activeName={state.name}
          onCommitMolblock={handleSketchCommit}
        />
      )}

      {subMode === 'search' && (
        <div className="space-y-3 rounded-xl border border-white/[0.08] bg-[#0b1018] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-semibold text-slate-200">RDKit Substructure &amp; Similarity Search</div>
              <div className="text-[0.6875rem] text-slate-400">
                Screens built-in presets, active project molecules, and your local library using SMARTS pattern matching &amp; Morgan fingerprint Tanimoto similarity (Tc).
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void runSubstructureSearch();
              }}
              placeholder="SMARTS or SMILES query (e.g. S(=O)(=O)N, c1ccccc1)…"
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100 outline-none focus:border-sky-500"
            />
            <button
              type="button"
              onClick={() => void runSubstructureSearch()}
              disabled={searchBusy}
              className="flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/15 px-3.5 py-2 text-xs font-medium text-sky-200 hover:bg-sky-500/25 disabled:opacity-50"
            >
              <Search className="h-3.5 w-3.5" />
              {searchBusy ? 'Searching…' : 'Search Molecules'}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[0.6875rem] text-slate-500">Quick SMARTS:</span>
            {SEARCH_SMARTS_EXAMPLES.map((ex) => (
              <button
                key={ex.label}
                type="button"
                onClick={() => {
                  setSearchQuery(ex.query);
                  void runSubstructureSearch(ex.query);
                }}
                className="rounded-md border border-white/10 bg-slate-900/80 px-2 py-0.5 text-[0.6875rem] text-slate-300 hover:border-sky-400/40 hover:text-sky-200"
              >
                {ex.label}
              </button>
            ))}
          </div>

          {searchHits.length > 0 && (
            <div className="grid grid-cols-1 gap-2.5 @lg:grid-cols-2 @3xl:grid-cols-3">
              {searchHits.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => {
                    dispatch({ type: 'set_custom_smiles', smiles: h.smiles, name: h.name });
                    setHighlightSmarts(searchQuery);
                    setSubMode('analyze');
                  }}
                  className="flex flex-col items-start rounded-xl border border-white/[0.08] bg-[#070b12] p-2.5 text-left transition hover:border-sky-500/50"
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="truncate font-medium text-slate-200">{h.name}</span>
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[0.6875rem] ${
                        h.substructureMatch
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {h.substructureMatch ? 'SMARTS Match' : `Tc ${h.tanimoto.toFixed(2)}`}
                    </span>
                  </div>
                  {h.svg && (
                    <div
                      className="mt-1.5 flex w-full justify-center"
                      dangerouslySetInnerHTML={{ __html: h.svg }}
                    />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {(error || rdkitError) && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 font-mono text-xs text-rose-200">
          {error ?? rdkitError}
        </div>
      )}

      {result && (
        <div className="grid grid-cols-1 gap-3 @4xl:grid-cols-2 @6xl:grid-cols-12">
          {/* 1. 2D SVG Molecular Depiction & Functional Highlighting */}
          <div className="flex flex-col justify-between gap-2.5 rounded-xl border border-white/[0.08] bg-[#070b12] p-3 @6xl:col-span-4">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[0.75rem] font-semibold text-sky-300">2D STRUCTURE DEPICTION</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setSubMode('sketch')}
                  className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[0.6875rem] text-slate-200 hover:border-sky-400/40"
                >
                  <Pencil className="h-3 w-3" /> Edit Sketch
                </button>
              </div>
            </div>

            <div className="flex min-h-44 w-full items-center justify-center rounded-lg border border-white/[0.05] bg-[#0a0f18] p-2">
              {rdkitData?.svg ? (
                <div
                  className="flex w-full items-center justify-center [&>svg]:max-h-52 [&>svg]:w-full"
                  dangerouslySetInnerHTML={{ __html: rdkitData.svg }}
                />
              ) : (
                <Molecule2DSvg layout={result.layout2d} />
              )}
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-1 font-mono text-[0.75rem] text-slate-300">
                <span className="truncate font-semibold">{result.name}</span>
                <span className="text-slate-400">
                  {result.heavyAtomCount} heavy · {result.ringCount} rings
                  {rdkitData ? ` · ${rdkitData.descriptors.aromaticRings} arom` : ''}
                  {rdkitBusy ? ' · updating…' : ''}
                </span>
              </div>

              {rdkitData && (
                <>
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-[0.6875rem] text-slate-500">SMARTS highlight:</span>
                    {SMARTS_HIGHLIGHT_PRESETS.map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => setHighlightSmarts(highlightSmarts === p.smarts ? '' : p.smarts)}
                        className={`rounded border px-1.5 py-0.5 text-[0.6875rem] transition ${
                          highlightSmarts === p.smarts
                            ? 'border-sky-400/60 bg-sky-500/20 text-sky-200'
                            : 'border-white/10 bg-slate-900 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 border-t border-white/[0.06] pt-2 text-[0.6875rem]">
                    <input
                      value={highlightSmarts}
                      onChange={(e) => setHighlightSmarts(e.target.value)}
                      placeholder="Custom SMARTS highlight (e.g. S(=O)(=O)N)"
                      className="min-w-0 flex-1 rounded-md border border-white/10 bg-slate-950 px-2 py-1 font-mono text-slate-200 outline-none focus:border-sky-500"
                    />
                    {highlightSmarts && (
                      <button
                        type="button"
                        onClick={() => setHighlightSmarts('')}
                        className="rounded-md border border-white/10 bg-slate-900 px-2 py-1 text-slate-400 hover:text-white"
                      >
                        Clear
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => downloadFile(`${safeBaseName}.mol`, rdkitData.molblock2d, 'chemical/x-mdl-molfile')}
                      className="flex items-center gap-1 rounded-md border border-white/10 bg-slate-900 px-2 py-1 text-slate-300 hover:border-white/25"
                    >
                      <Download className="h-3 w-3" /> .MOL
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadFile(`${safeBaseName}.svg`, rdkitData.svg, 'image/svg+xml')}
                      className="flex items-center gap-1 rounded-md border border-white/10 bg-slate-900 px-2 py-1 text-slate-300 hover:border-white/25"
                    >
                      <Download className="h-3 w-3" /> .SVG
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* 2. Physicochemical Descriptors, Rules & Similarity */}
          <div className="flex flex-col gap-2.5 rounded-xl border border-white/[0.08] bg-[#0b1018] p-3 @6xl:col-span-4">
            <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[0.75rem]">
              <span className="font-semibold text-cyan-300">COMPUTATIONAL DESCRIPTORS</span>
              <div className="flex items-center gap-2">
                <span
                  className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[0.6875rem] ${
                    result.veberCompliant
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                      : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                  }`}
                >
                  <CheckCircle2 className="h-3 w-3" />
                  {result.veberCompliant ? 'Veber OK' : 'Veber Warn'}
                </span>
                {rdkitData && (
                  <span
                    className={`rounded-md border px-1.5 py-0.5 text-[0.6875rem] ${
                      rdkitData.rules.ghoseCompliant
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                        : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                    }`}
                  >
                    Ghose {rdkitData.rules.ghoseCompliant ? 'Pass' : 'Warn'}
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 @md:grid-cols-3">
              <MetricInfoCell label="Formula" value={result.formula} tooltip="Molecular formula" />
              <MetricInfoCell
                label="MW"
                value={`${result.molecularWeight.toFixed(2)} Da`}
                hint={result.molecularWeight <= 500 ? '≤ 500 Ro5' : '> 500 Da'}
                accent={result.molecularWeight <= 500 ? 'text-slate-100' : 'text-amber-300'}
              />
              <MetricInfoCell label="Exact Mass" value={`${result.exactMass.toFixed(4)} Da`} />
              <MetricInfoCell
                label="TPSA"
                value={`${result.tpsa.toFixed(1)} Å²`}
                hint={result.tpsa <= 140 ? '≤ 140 Veber' : '> 140 polar'}
                accent={result.tpsa <= 140 ? 'text-emerald-300' : 'text-amber-300'}
              />
              <MetricInfoCell
                label="cLogP"
                value={result.crippenLogP.toFixed(2)}
                hint={result.crippenLogP <= 5 ? 'Crippen ≤ 5' : 'Lipophilic > 5'}
                accent={result.crippenLogP <= 5 ? 'text-slate-100' : 'text-amber-300'}
              />
              <MetricInfoCell label="HBD / HBA" value={`${result.hbd} / ${result.hba}`} hint="Donors / Acceptors" />
              <MetricInfoCell
                label="Rot. Bonds"
                value={String(result.rotatableBonds)}
                hint={result.rotatableBonds <= 10 ? '≤ 10 Veber' : 'Flexible > 10'}
              />
              <MetricInfoCell
                label="Lipinski Viol."
                value={String(result.lipinskiViolations)}
                hint="Rule-of-5 checks"
                accent={result.lipinskiViolations <= 1 ? 'text-emerald-300' : 'text-amber-300'}
              />
              {rdkitData && (
                <MetricInfoCell
                  label="Fsp³ / Stereo"
                  value={`${rdkitData.descriptors.fractionCsp3.toFixed(2)} / ${rdkitData.descriptors.stereoCenters}`}
                  hint="3D saturation / centers"
                />
              )}
            </div>

            {/* Plain-English Insights */}
            <div className="flex flex-wrap items-center gap-1.5">
              <MetricInsightBadge insight={explainTpsa(result.tpsa)} compact />
              <MetricInsightBadge insight={explainClogP(result.crippenLogP)} compact />
              <MetricInsightBadge insight={explainLipinski(result.lipinskiViolations)} compact />
            </div>

            <div className="rounded-lg border border-white/[0.06] bg-black/25 px-2.5 py-2 text-[0.6875rem] leading-relaxed text-slate-300">
              {explainTpsa(result.tpsa).explanation} {simpleMode ? '' : explainClogP(result.crippenLogP).explanation}
            </div>

            {rdkitData && (
              <div className="space-y-2 border-t border-white/[0.06] pt-2 font-mono text-[0.6875rem]">
                <div className="flex items-center justify-between gap-2 text-slate-400">
                  <span className="min-w-0 truncate">
                    InChIKey: <span className="text-slate-200">{rdkitData.inchiKey || '—'}</span>
                  </span>
                  {rdkitData.inchiKey && (
                    <button
                      type="button"
                      onClick={() => copyText('inchikey', rdkitData.inchiKey)}
                      className="shrink-0 rounded p-1 text-slate-400 hover:bg-white/10 hover:text-slate-100"
                      title="Copy InChIKey"
                    >
                      {copiedId === 'inchikey' ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                    </button>
                  )}
                </div>

                {rdkitData.alerts.length === 0 ? (
                  <div className="flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/8 px-2.5 py-1.5 text-emerald-300">
                    <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                    <span>0 PAINS / Brenk structural alerts detected</span>
                  </div>
                ) : (
                  <div className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-amber-200">
                    {rdkitData.alerts.map((al) => (
                      <div key={al.id} className="flex items-center gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        <span>[{al.family}] {al.label}</span>
                      </div>
                    ))}
                  </div>
                )}

                {similarityHits.length > 0 && (
                  <div className="space-y-1">
                    <div className="font-sans text-[0.6875rem] font-medium text-slate-400">
                      Morgan Fingerprint Similarity (Tanimoto)
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {similarityHits.slice(0, 4).map((hit) => (
                        <button
                          key={hit.id}
                          type="button"
                          onClick={() =>
                            dispatch({ type: 'set_custom_smiles', smiles: hit.smiles, name: hit.name })
                          }
                          className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-black/30 px-2 py-0.5 text-[0.6875rem] text-slate-300 hover:border-sky-400/40"
                        >
                          <span className="truncate max-w-28">{hit.name}</span>
                          <span className="text-sky-300">Tc {hit.tanimoto.toFixed(2)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 3. Connected 3D Binding Pocket Contacts & Docking Box */}
          <div className="flex flex-col gap-2.5 rounded-xl border border-white/[0.08] bg-[#0b1018] p-3 @4xl:col-span-2 @6xl:col-span-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-mono text-[0.75rem] font-semibold text-violet-300">
                  3D RECEPTOR POCKET CONTACTS (≤ {contactCutoff.toFixed(1)} Å)
                </div>
                <div className="text-[0.6875rem] text-slate-400">
                  {comparison
                    ? `Active 3D structure: ${comparison.reference.label} (${groupedContacts.length} residues · ${filteredContacts.length} atom pairs)`
                    : 'Contacts around co-crystallized ligands in the active 3D structure.'}
                </div>
              </div>
              {groupedContacts.length > 0 && bridge && (
                <button
                  type="button"
                  onClick={highlightPocketIn3D}
                  className="inline-flex items-center gap-1 rounded-lg border border-violet-400/40 bg-violet-500/15 px-2.5 py-1 text-[0.6875rem] font-medium text-violet-200 hover:bg-violet-500/25"
                >
                  <Box className="h-3 w-3" /> Highlight Pocket in 3D
                </button>
              )}
            </div>

            {rawContacts.length === 0 ? (
              <div className="flex flex-1 flex-col items-start justify-center gap-2 rounded-lg border border-white/[0.06] bg-black/20 p-3 text-slate-400">
                <p>No co-crystallized 3D ligand contacts found in the active reference structure.</p>
                {bridge && !bridge.hasRef && (
                  <button
                    type="button"
                    onClick={bridge.loadExample}
                    className="inline-flex items-center gap-1 rounded-lg border border-sky-400/40 bg-sky-500/15 px-2.5 py-1 text-xs font-medium text-sky-200 hover:bg-sky-500/25"
                  >
                    <FlaskConical className="h-3.5 w-3.5" /> Load 3HS4 (AZM + Zn²⁺ Pocket)
                  </button>
                )}
              </div>
            ) : (
              <>
                {/* Interactive Filters */}
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-black/25 p-2">
                  <div className="flex flex-wrap items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setLigandFilter('ALL')}
                      className={`rounded px-2 py-0.5 font-mono text-[0.6875rem] ${
                        ligandFilter === 'ALL'
                          ? 'bg-sky-500/20 text-sky-200'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      All
                    </button>
                    {ligandNames.map((ln) => (
                      <button
                        key={ln}
                        type="button"
                        onClick={() => setLigandFilter(ln)}
                        className={`rounded px-2 py-0.5 font-mono text-[0.6875rem] ${
                          ligandFilter === ln
                            ? 'bg-violet-500/25 text-violet-200'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {ln}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 font-mono text-[0.6875rem] text-slate-400">
                      <span>≤{contactCutoff.toFixed(1)}Å</span>
                      <input
                        type="range"
                        min={2.5}
                        max={4.5}
                        step={0.1}
                        value={contactCutoff}
                        onChange={(e) => setContactCutoff(Number(e.target.value))}
                        className="w-20 accent-sky-400"
                      />
                    </label>
                    <div className="flex rounded border border-white/10 bg-slate-950 p-0.5 text-[0.6875rem]">
                      <button
                        type="button"
                        onClick={() => setContactView('grouped')}
                        className={`rounded px-1.5 py-0.5 ${contactView === 'grouped' ? 'bg-white/10 text-white' : 'text-slate-400'}`}
                      >
                        Residues
                      </button>
                      <button
                        type="button"
                        onClick={() => setContactView('atoms')}
                        className={`rounded px-1.5 py-0.5 ${contactView === 'atoms' ? 'bg-white/10 text-white' : 'text-slate-400'}`}
                      >
                        Atoms
                      </button>
                    </div>
                  </div>
                </div>

                {/* Contacts List */}
                <div className="max-h-60 space-y-1.5 overflow-y-auto pr-0.5 font-mono text-[0.75rem]">
                  {contactView === 'grouped'
                    ? groupedContacts.map((g) => {
                        const isFocused = bridge?.focusedSeqId === g.seqId;
                        return (
                          <button
                            key={g.seqId}
                            type="button"
                            onClick={() => focusPocketResidueIn3D(g.seqId)}
                            className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left transition ${
                              isFocused
                                ? 'border-amber-400/60 bg-amber-500/10'
                                : 'border-white/[0.07] bg-black/30 hover:border-cyan-400/50'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-semibold text-sky-300">
                                  {g.resName3} {g.seqId}
                                </span>
                                <span className="text-[0.6875rem] text-slate-400">
                                  ({Array.from(g.ligands).join('+')})
                                </span>
                              </div>
                              <div className="truncate text-[0.6875rem] text-slate-500">
                                {g.closestPair} · {g.count} pair{g.count === 1 ? '' : 's'}
                              </div>
                            </div>
                            <span className="shrink-0 font-semibold text-emerald-300">
                              {g.minDist.toFixed(2)} Å
                            </span>
                          </button>
                        );
                      })
                    : filteredContacts.slice(0, 80).map((c, idx) => (
                        <button
                          key={`${c.ligandSeqId}-${c.ligandAtom}-${c.proteinSeqId}-${c.proteinAtom}-${idx}`}
                          type="button"
                          onClick={() => focusPocketResidueIn3D(c.proteinSeqId)}
                          className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/[0.07] bg-black/30 px-2.5 py-1 text-left hover:border-cyan-400/50"
                        >
                          <span className="min-w-0 truncate">
                            <span className="text-violet-300">{c.ligandResName}</span>{' '}
                            <span className="text-slate-400">{c.ligandAtom}</span> ↔{' '}
                            <span className="text-sky-300">
                              {c.proteinResName3}
                              {c.proteinSeqId}
                            </span>{' '}
                            <span className="text-slate-400">{c.proteinAtom}</span>
                          </span>
                          <span className="shrink-0 text-emerald-300">{c.distanceAngstrom.toFixed(2)} Å</span>
                        </button>
                      ))}
                </div>
              </>
            )}

            {/* Vina Box Bridge Footer */}
            {bridge?.dockingBox && (
              <div className="mt-auto flex flex-wrap items-center justify-between gap-2 rounded-lg border border-cyan-500/20 bg-cyan-500/[0.05] px-2.5 py-2 text-[0.6875rem]">
                <div className="min-w-0">
                  <div className="font-medium text-cyan-200">3D Vina Search Box ({bridge.dockingBox.sourceLabel})</div>
                  <div className="truncate font-mono text-slate-400">
                    Center [{bridge.dockingBox.center.join(', ')}] · Size {bridge.dockingBox.size.join('×')} Å
                  </div>
                </div>
                {onStageForCompute && (
                  <button
                    type="button"
                    onClick={() =>
                      onStageForCompute('vina', {
                        name: state.name,
                        smiles: canonicalOrDraft,
                        molblock2d: rdkitData?.molblock2d,
                      })
                    }
                    className="shrink-0 rounded-md border border-cyan-400/40 bg-cyan-500/20 px-2 py-1 font-medium text-cyan-100 hover:bg-cyan-500/30"
                  >
                    Dock Here →
                  </button>
                )}
              </div>
            )}

            {activePocketSeqIds.size > 0 && (
              <div className="text-[0.6875rem] text-slate-500">
                Tip: Click any residue above to focus the 3D camera directly on that pocket sidechain.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Molecule2DSvg({
  layout,
}: {
  layout: AnalyzeMoleculeSmilesResult['layout2d'];
}) {
  const viewBox = useMemo(() => {
    if (layout.atoms.length === 0) return '0 0 100 100';
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const a of layout.atoms) {
      if (a.x < minX) minX = a.x;
      if (a.x > maxX) maxX = a.x;
      if (a.y < minY) minY = a.y;
      if (a.y > maxY) maxY = a.y;
    }
    const pad = 1.4;
    const w = Math.max(2, maxX - minX + pad * 2);
    const h = Math.max(2, maxY - minY + pad * 2);
    return `${minX - pad} ${minY - pad} ${w} ${h}`;
  }, [layout]);

  const atomById = useMemo(() => {
    const map = new Map<number, AnalyzeMoleculeSmilesResult['layout2d']['atoms'][number]>();
    for (const a of layout.atoms) map.set(a.id, a);
    return map;
  }, [layout.atoms]);

  const elColor = (el: string) => {
    switch (el.toUpperCase()) {
      case 'N':
        return '#60a5fa';
      case 'O':
        return '#f87171';
      case 'S':
        return '#facc15';
      case 'P':
        return '#fb923c';
      case 'F':
      case 'CL':
        return '#34d399';
      case 'ZN':
        return '#c084fc';
      default:
        return '#cbd5e1';
    }
  };

  return (
    <svg viewBox={viewBox} className="h-44 w-full max-w-[300px]">
      {layout.bonds.map((b, idx) => {
        const a1 = atomById.get(b.from);
        const a2 = atomById.get(b.to);
        if (!a1 || !a2) return null;
        const dx = a2.x - a1.x;
        const dy = a2.y - a1.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = (-dy / len) * 0.1;
        const ny = (dx / len) * 0.1;

        if (b.order === 2) {
          return (
            <g key={idx} stroke="#94a3b8" strokeWidth={0.08} strokeLinecap="round">
              <line x1={a1.x + nx} y1={a1.y + ny} x2={a2.x + nx} y2={a2.y + ny} />
              <line x1={a1.x - nx} y1={a1.y - ny} x2={a2.x - nx} y2={a2.y - ny} />
            </g>
          );
        }
        if (b.order === 3) {
          return (
            <g key={idx} stroke="#94a3b8" strokeWidth={0.075} strokeLinecap="round">
              <line x1={a1.x} y1={a1.y} x2={a2.x} y2={a2.y} />
              <line x1={a1.x + nx * 1.4} y1={a1.y + ny * 1.4} x2={a2.x + nx * 1.4} y2={a2.y + ny * 1.4} />
              <line x1={a1.x - nx * 1.4} y1={a1.y - ny * 1.4} x2={a2.x - nx * 1.4} y2={a2.y - ny * 1.4} />
            </g>
          );
        }
        if (b.order === 4) {
          return (
            <g key={idx} stroke="#67e8f9" strokeWidth={0.08} strokeLinecap="round">
              <line x1={a1.x} y1={a1.y} x2={a2.x} y2={a2.y} />
              <line
                x1={a1.x + nx * 1.1}
                y1={a1.y + ny * 1.1}
                x2={a2.x + nx * 1.1}
                y2={a2.y + ny * 1.1}
                strokeDasharray="0.18 0.14"
              />
            </g>
          );
        }
        return (
          <line
            key={idx}
            x1={a1.x}
            y1={a1.y}
            x2={a2.x}
            y2={a2.y}
            stroke="#94a3b8"
            strokeWidth={0.09}
            strokeLinecap="round"
          />
        );
      })}

      {layout.atoms.map((a) => {
        if (a.element === 'C' && a.charge === 0) return null;
        return (
          <g key={a.id}>
            <circle cx={a.x} cy={a.y} r={0.38} fill="#070b12" />
            <text
              x={a.x}
              y={a.y + 0.18}
              textAnchor="middle"
              fill={elColor(a.element)}
              fontSize={0.55}
              fontWeight="700"
              fontFamily="ui-monospace, monospace"
            >
              {a.element}
              {a.charge > 0 ? '+' : a.charge < 0 ? '-' : ''}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
