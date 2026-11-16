import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Atom,
  CheckCircle2,
  Cpu,
  Download,
  FlaskConical,
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
import {
  SMILES_PRESETS,
  type ChemistryAction,
  type ChemistryWorkbenchState,
} from '../lib/workbenchReducers';
import { MetricInsightBadge } from './MetricInsightBadge';
import { MoleculeSketcher2D } from './MoleculeSketcher2D';

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
}

type ChemSubMode = 'analyze' | 'sketch' | 'search';

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
}: ChemistryWorkbenchProps) {
  const [smilesDraft, setSmilesDraft] = useState(state.smiles);
  const [subMode, setSubMode] = useState<ChemSubMode>('analyze');
  const [highlightSmarts, setHighlightSmarts] = useState('');
  const [rdkitData, setRdkitData] = useState<RdkitMoleculeAnalysis | null>(null);
  const [rdkitBusy, setRdkitBusy] = useState(false);
  const [rdkitError, setRdkitError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('S(=O)(=O)N');
  const [searchHits, setSearchHits] = useState<RdkitSearchHit[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);

  useEffect(() => {
    setSmilesDraft(state.smiles);
  }, [state.smiles]);

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

  const runCustomSmiles = () => {
    if (!smilesDraft.trim()) return;
    dispatch({
      type: 'set_custom_smiles',
      smiles: smilesDraft.trim(),
      name: 'Custom SMILES',
    });
  };

  const handleSketchCommit = (molblock: string) => {
    if (typeof Worker === 'undefined') return;
    void getSharedRdkitClient()
      .analyzeMolecule(molblock)
      .then((res) => {
        setRdkitData(res);
        setSmilesDraft(res.canonicalSmiles);
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

  const runSubstructureSearch = async () => {
    if (typeof Worker === 'undefined' || !searchQuery.trim()) return;
    setSearchBusy(true);
    setRdkitError(null);
    try {
      const candidates = [
        ...SMILES_PRESETS.map((p) => ({ id: p.id, name: p.name, smiles: p.smiles })),
        ...libraryCompounds,
      ];
      const unique = Array.from(new Map(candidates.map((c) => [c.smiles, c])).values());
      const hits = await getSharedRdkitClient().searchLibrary(searchQuery, unique);
      setSearchHits(hits);
    } catch (err) {
      setRdkitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearchBusy(false);
    }
  };

  const downloadMol2d = () => {
    if (!rdkitData?.molblock2d) return;
    const blob = new Blob([rdkitData.molblock2d], { type: 'chemical/x-mdl-molfile' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(state.name || 'ligand').replace(/[^a-zA-Z0-9._-]+/g, '_')}.mol`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="flex h-full flex-col gap-2.5 overflow-y-auto p-2.5 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-800 bg-[#0b1018] p-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ['analyze', 'Analyze & Depict', <Atom key="a" className="h-3 w-3" />],
              ['sketch', '2D Sketcher', <Pencil key="s" className="h-3 w-3" />],
              ['search', 'Substructure Search', <Search key="q" className="h-3 w-3" />],
            ] as const
          ).map(([id, label, icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSubMode(id)}
              className={`flex items-center gap-1 rounded border px-2 py-1 text-[0.75rem] font-medium transition ${
                subMode === id
                  ? 'border-sky-400/50 bg-sky-500/20 text-sky-200'
                  : 'border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-600'
              }`}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {rdkitData && (
            <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[0.6875rem] text-emerald-300">
              RDKit {rdkitData.rdkitVersion} WASM
            </span>
          )}
          {onStageForCompute && (
            <>
              <button
                type="button"
                onClick={() =>
                  onStageForCompute('vina', {
                    name: state.name,
                    smiles: rdkitData?.canonicalSmiles ?? state.smiles,
                    molblock2d: rdkitData?.molblock2d,
                  })
                }
                className="flex items-center gap-1 rounded border border-cyan-500/40 bg-cyan-500/15 px-2 py-1 text-[0.75rem] text-cyan-200 hover:bg-cyan-500/25"
              >
                <FlaskConical className="h-3 w-3" /> Dock (Vina)
              </button>
              <button
                type="button"
                onClick={() =>
                  onStageForCompute('pyscf', {
                    name: state.name,
                    smiles: rdkitData?.canonicalSmiles ?? state.smiles,
                    molblock2d: rdkitData?.molblock2d,
                  })
                }
                className="flex items-center gap-1 rounded border border-violet-500/40 bg-violet-500/15 px-2 py-1 text-[0.75rem] text-violet-200 hover:bg-violet-500/25"
              >
                <Cpu className="h-3 w-3" /> Quantum (PySCF)
              </button>
            </>
          )}
        </div>
      </div>

      {/* Presets & SMILES Input */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-800 bg-[#0b1018] p-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Atom className="h-3.5 w-3.5 text-cyan-400" />
          {SMILES_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                dispatch({ type: 'select_preset', presetId: p.id });
                setSmilesDraft(p.smiles);
              }}
              className={`rounded border px-2 py-0.5 text-[0.75rem] transition ${
                state.selectedPresetId === p.id
                  ? 'border-cyan-500/50 bg-cyan-500/20 text-cyan-200'
                  : 'border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-600'
              }`}
            >
              {p.name.split(' (')[0]}
            </button>
          ))}
        </div>

        <div className="flex flex-1 items-center gap-1.5 sm:max-w-md">
          <input
            value={smilesDraft}
            onChange={(e) => setSmilesDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') runCustomSmiles();
            }}
            placeholder="Enter SMILES string…"
            className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[0.8125rem] text-slate-100 outline-none focus:border-cyan-500"
          />
          <button
            type="button"
            onClick={runCustomSmiles}
            className="flex shrink-0 items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-[0.8125rem] text-emerald-200 hover:bg-emerald-500/25"
          >
            <Play className="h-3 w-3" /> Analyze
          </button>
        </div>
      </div>

      {subMode === 'sketch' && (
        <MoleculeSketcher2D
          initialMolblock={rdkitData?.molblock2d}
          onCommitMolblock={handleSketchCommit}
        />
      )}

      {subMode === 'search' && (
        <div className="rounded-xl border border-slate-800 bg-[#0b1018] p-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void runSubstructureSearch();
              }}
              placeholder="SMARTS or SMILES query (e.g. S(=O)(=O)N, c1ccccc1)…"
              className="flex-1 rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-slate-100 outline-none focus:border-sky-500"
            />
            <button
              type="button"
              onClick={() => void runSubstructureSearch()}
              disabled={searchBusy}
              className="flex items-center gap-1 rounded border border-sky-500/40 bg-sky-500/15 px-3 py-1.5 text-xs text-sky-200 hover:bg-sky-500/25 disabled:opacity-50"
            >
              <Search className="h-3.5 w-3.5" />
              {searchBusy ? 'Searching…' : 'Run RDKit Search'}
            </button>
          </div>
          {searchHits.length > 0 && (
            <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {searchHits.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => {
                    dispatch({ type: 'set_custom_smiles', smiles: h.smiles, name: h.name });
                    setHighlightSmarts(searchQuery);
                    setSubMode('analyze');
                  }}
                  className="flex flex-col items-start rounded-lg border border-slate-800 bg-[#070b12] p-2 text-left hover:border-sky-500/50"
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="truncate font-medium text-slate-200">{h.name}</span>
                    <span
                      className={`rounded px-1.5 py-0.5 font-mono text-[0.6875rem] ${
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
        <div className="rounded border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 font-mono text-[0.8125rem] text-rose-200">
          {error ?? rdkitError}
        </div>
      )}

      {result && (
        <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-12">
          {/* Deterministic 2D SVG Molecular Graph */}
          <div className="flex flex-col items-center justify-between rounded border border-slate-800 bg-[#070b12] p-2 lg:col-span-4">
            {rdkitData?.svg ? (
              <div
                className="flex min-h-32 w-full items-center justify-center [&>svg]:max-h-40 [&>svg]:w-full"
                dangerouslySetInnerHTML={{ __html: rdkitData.svg }}
              />
            ) : (
              <Molecule2DSvg layout={result.layout2d} />
            )}
            <div className="mt-1 w-full space-y-1">
              <div className="text-center font-mono text-[0.75rem] text-slate-400">
                {result.name} · {result.heavyAtomCount} heavy atoms · {result.ringCount} rings
                {rdkitBusy ? ' · RDKit updating…' : ''}
              </div>
              {rdkitData && (
                <div className="flex flex-wrap items-center justify-between gap-1 border-t border-slate-800/80 pt-1.5 text-[0.6875rem]">
                  <input
                    value={highlightSmarts}
                    onChange={(e) => setHighlightSmarts(e.target.value)}
                    placeholder="Highlight SMARTS (e.g. S(=O)(=O)N)"
                    className="min-w-0 flex-1 rounded border border-slate-800 bg-slate-950 px-1.5 py-0.5 font-mono text-slate-300 outline-none focus:border-sky-500"
                  />
                  <button
                    type="button"
                    onClick={downloadMol2d}
                    className="flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-slate-300 hover:border-slate-500"
                  >
                    <Download className="h-3 w-3" /> .MOL
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Physicochemical Descriptors */}
          <div className="rounded border border-slate-800 bg-[#0b1018] p-2.5 lg:col-span-4">
            <div className="mb-1.5 flex items-center justify-between font-mono text-[0.75rem]">
              <span className="font-semibold text-cyan-300">
                COMPUTATIONAL DESCRIPTORS (WASM)
              </span>
              <span className="flex items-center gap-1 text-emerald-300">
                <CheckCircle2 className="h-3 w-3" />
                {result.veberCompliant ? 'Veber OK' : 'Veber Warn'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-1.5 font-mono text-[0.75rem]">
              <MetricCell label="Formula" value={result.formula} />
              <MetricCell label="MW" value={`${result.molecularWeight.toFixed(2)} Da`} />
              <MetricCell label="Exact Mass" value={`${result.exactMass.toFixed(4)} Da`} />
              <MetricCell label="TPSA" value={`${result.tpsa.toFixed(2)} Å²`} />
              <MetricCell label="cLogP (Crippen)" value={result.crippenLogP.toFixed(2)} />
              <MetricCell label="HBD / HBA" value={`${result.hbd} / ${result.hba}`} />
              <MetricCell label="Rot. Bonds" value={String(result.rotatableBonds)} />
              <MetricCell
                label="Lipinski Viol."
                value={String(result.lipinskiViolations)}
                accent={result.lipinskiViolations <= 1 ? 'text-emerald-300' : 'text-amber-300'}
              />
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1.5 font-sans">
              <MetricInsightBadge insight={explainTpsa(result.tpsa)} compact />
              <MetricInsightBadge insight={explainClogP(result.crippenLogP)} compact />
              <MetricInsightBadge insight={explainLipinski(result.lipinskiViolations)} compact />
            </div>
            {rdkitData && (
              <div className="mt-2 space-y-1 border-t border-slate-800/80 pt-2 font-mono text-[0.6875rem]">
                <div className="flex flex-wrap items-center justify-between gap-1 text-slate-400">
                  <span>InChIKey: <span className="text-slate-200">{rdkitData.inchiKey || '—'}</span></span>
                  <span>Fsp³: <span className="text-slate-200">{rdkitData.descriptors.fractionCsp3.toFixed(2)}</span> · Ghose: <span className={rdkitData.rules.ghoseCompliant ? 'text-emerald-300' : 'text-amber-300'}>{rdkitData.rules.ghoseCompliant ? 'Pass' : 'Warn'}</span></span>
                </div>
                {rdkitData.alerts.length === 0 ? (
                  <div className="flex items-center gap-1 text-emerald-300">
                    <ShieldCheck className="h-3 w-3" /> 0 PAINS / Brenk structural alerts
                  </div>
                ) : (
                  <div className="space-y-0.5 text-amber-300">
                    {rdkitData.alerts.map((al) => (
                      <div key={al.id} className="flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        <span>[{al.family}] {al.label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {simpleMode && (
              <p className="mt-1.5 text-[0.75rem] leading-relaxed text-slate-400">
                {explainTpsa(result.tpsa).explanation}
              </p>
            )}
          </div>

          {/* 3HS4 Ligand Pocket Contacts (<= 4.5 A) */}
          <div className="rounded border border-slate-800 bg-[#0b1018] p-2.5 lg:col-span-4">
            <div className="mb-1.5 font-mono text-[0.75rem] font-semibold text-violet-300">
              3D POCKET CONTACTS (≤ 4.5 Å) · {comparison?.refContacts?.length ?? 0}
            </div>
            {!comparison?.refContacts || comparison.refContacts.length === 0 ? (
              <div className="text-[0.8125rem] text-slate-500">
                No 3D ligand contacts present in active reference structure.
              </div>
            ) : (
              <div className="max-h-36 space-y-1 overflow-y-auto font-mono text-[0.75rem]">
                {[...comparison.refContacts]
                  .sort((a, b) => {
                    const rank = (name: string) =>
                      name === 'AZM' ? 0 : name === 'ZN' ? 1 : 2;
                    const dr = rank(a.ligandResName) - rank(b.ligandResName);
                    return dr !== 0 ? dr : a.distanceAngstrom - b.distanceAngstrom;
                  })
                  .map((c, idx) => (
                  <button
                    key={`${c.ligandSeqId}-${c.ligandAtom}-${c.proteinSeqId}-${c.proteinAtom}-${idx}`}
                    type="button"
                    onClick={() => onFocusResidue(c.proteinSeqId)}
                    className="flex w-full items-center justify-between rounded border border-slate-800 bg-slate-950/70 px-2 py-1 text-left hover:border-cyan-500/50"
                  >
                    <span>
                      <span className="text-violet-300">{c.ligandResName}</span>{' '}
                      <span className="text-slate-400">{c.ligandAtom}</span> ↔{' '}
                      <span className="text-sky-300">
                        {c.proteinResName3}
                        {c.proteinSeqId}
                      </span>{' '}
                      <span className="text-slate-400">{c.proteinAtom}</span>
                    </span>
                    <span className="text-emerald-300">
                      {c.distanceAngstrom.toFixed(2)} Å
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCell({
  label,
  value,
  accent = 'text-slate-100',
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="rounded border border-slate-800/80 bg-slate-950/60 px-2 py-1">
      <div className="text-[0.6875rem] text-slate-500">{label}</div>
      <div className={`font-semibold ${accent}`}>{value}</div>
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
    <svg viewBox={viewBox} className="h-32 w-full max-w-[260px]">
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
