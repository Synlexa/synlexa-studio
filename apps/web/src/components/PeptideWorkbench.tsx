import { useMemo, useState, type MouseEvent } from 'react';
import {
  Box,
  Crosshair,
  Dna,
  Edit3,
  FolderPlus,
  Plus,
  RefreshCw,
  Scissors,
  X,
} from 'lucide-react';
import type { AnalyzePeptideResult } from '@synlexa/wasm-bridge';
import { explainGravy, explainPi } from '../lib/metricInsights';
import type { Studio3DBridge } from '../lib/studioBridge';
import type { PeptideAction, PeptideWorkbenchState } from '../lib/workbenchReducers';
import { MetricInsightBadge } from './MetricInsightBadge';
import { MetricInfoCell, Project3DContextBanner, ToolGuideCard } from './WorkbenchShared';

interface PeptideWorkbenchProps {
  state: PeptideWorkbenchState;
  dispatch: (action: PeptideAction) => void;
  result: AnalyzePeptideResult | null;
  error: string | null;
  onFocusResidue: (seqId: number) => void;
  simpleMode?: boolean;
  bridge?: Studio3DBridge;
}

export function PeptideWorkbench({
  state,
  dispatch,
  result,
  error,
  onFocusResidue,
  simpleMode = false,
  bridge,
}: PeptideWorkbenchProps) {
  const [mutDraft, setMutDraft] = useState('');
  const [guideOpen, setGuideOpen] = useState(false);
  const [editingSeq, setEditingSeq] = useState(false);
  const [seqDraft, setSeqDraft] = useState(state.sequence);
  const [savedToast, setSavedToast] = useState<string | null>(null);

  const activeFocusId = state.focusSeqId ?? bridge?.focusedSeqId ?? null;
  const isCa2 = state.sequence.startsWith('MSHHWGYGKHNGPEHWHK');

  const addDraftMutation = () => {
    const clean = mutDraft.trim().toUpperCase();
    if (!clean) return;
    dispatch({ type: 'add_mutation', notation: clean });
    setMutDraft('');
  };

  // Context-aware quick mutations at the currently focused residue
  const focusedQuickMutations = useMemo(() => {
    if (!activeFocusId || activeFocusId < 1 || activeFocusId > state.sequence.length) return [];
    const wt = state.sequence[activeFocusId - 1];
    if (!wt) return [];
    const targets = ['A', 'R', 'D', 'W'].filter((aa) => aa !== wt);
    return targets.map((aa) => ({
      notation: `${wt}${activeFocusId}${aa}`,
      label: aa === 'A' ? 'Ala Scan' : aa === 'R' ? '+Charge' : aa === 'D' ? '−Charge' : 'Bulky Trp',
    }));
  }, [activeFocusId, state.sequence]);

  // Sequence strip centered on focused residue
  const sequenceStrip = useMemo(() => {
    const len = state.sequence.length;
    if (len === 0) return [];
    const center = activeFocusId && activeFocusId >= 1 && activeFocusId <= len ? activeFocusId : Math.min(len, Math.max(1, state.sliceStart + 10));
    const start = Math.max(1, center - 10);
    const end = Math.min(len, start + 20);
    const mutMap = new Map<number, string>();
    for (const m of result?.appliedMutations ?? []) {
      mutMap.set(m.pos, m.to);
    }
    const items: Array<{ pos: number; wt: string; eng: string; mutated: boolean }> = [];
    for (let pos = start; pos <= end; pos++) {
      const wt = state.sequence[pos - 1] ?? 'X';
      const mutTo = mutMap.get(pos);
      items.push({
        pos,
        wt,
        eng: mutTo ?? wt,
        mutated: Boolean(mutTo),
      });
    }
    return items;
  }, [state.sequence, state.sliceStart, activeFocusId, result?.appliedMutations]);

  const selectPosAndSync = (pos: number, center3d = false) => {
    dispatch({ type: 'focus_residue', seqId: pos });
    onFocusResidue(pos);
    if (center3d) {
      bridge?.focusIn3D(pos, { centerCamera: true });
    }
  };

  return (
    <div className="@container flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3 text-xs @xl:p-4">
      <Project3DContextBanner
        bridge={bridge}
        title="Peptide & Protein Engineering Workbench"
        subtitle="Test point mutations and sequence slices, inspect pH 0–14 titration & Kyte-Doolittle shifts, and map 3D contact shells."
        icon={<Scissors className="h-4 w-4" />}
        guideOpen={guideOpen}
        onToggleGuide={() => setGuideOpen((v) => !v)}
        actions={
          bridge && (
            <button
              type="button"
              onClick={() => {
                bridge.savePeptideToProject({
                  name: state.mutations.length > 0 ? state.mutations.join(', ') : `Peptide (${state.sliceStart}–${state.sliceEnd})`,
                  sequence: state.sequence,
                  mutations: state.mutations,
                });
                setSavedToast('Saved');
                setTimeout(() => setSavedToast(null), 1600);
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-slate-200 hover:border-sky-400/40"
            >
              <FolderPlus className="h-3.5 w-3.5 text-sky-300" />
              <span>{savedToast ? 'Saved!' : 'Save Variant'}</span>
            </button>
          )
        }
      />

      <ToolGuideCard
        open={guideOpen}
        title="How Peptide Engineering Works"
        summary="Simulate amino-acid substitutions (e.g. H94A) or sequence truncations against the active protein chain in deterministic Rust/WASM. Side-by-side biophysical deltas compare Wild-Type (WT) vs Engineered sequences."
        steps={[
          'Click a residue on the sequence strip below (or pick any residue in the 3D Viewer) and click one of the dynamic mutation chips (e.g. Ala Scan) or type any mutation like H94A.',
          'Adjust Slice Start/End to evaluate a cleaved domain or peptide fragment.',
          'Hover the pH 0–14 Titration or Kyte-Doolittle charts to inspect exact shifts, and click any 3D < 5.0 Å neighbor to jump to it in 3D.',
        ]}
        connectionTip="Syncs directly with your loaded 3D structure's sequence and active pocket. Clicking 'Highlight Shell in 3D' illuminates every neighboring residue within 5.0 Å of the mutated site right on the 3D structure."
        glossary={[
          { term: 'pI (Isoelectric Point)', desc: 'pH where net peptide charge is 0 (Henderson-Hasselbalch model). Shifts affect solubility & purification.' },
          { term: 'GRAVY', desc: 'Grand Average of Hydropathy (Kyte-Doolittle). Positive = hydrophobic; negative = hydrophilic/soluble.' },
          { term: 'ε280 (M⁻¹cm⁻¹)', desc: 'Molar extinction coefficient at 280 nm from Trp, Tyr, and cystine disulfide pairs.' },
          { term: 'Steric ΔV (Å³)', desc: 'Net side-chain volume change from substitutions; large positive/negative ΔV inside a packed core can introduce clashes or cavities.' },
        ]}
      />

      {/* Sequence Source & Mutation Controls */}
      <div className="space-y-2.5 rounded-xl border border-white/[0.08] bg-[#0b1018] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="flex items-center gap-1">
              <input
                value={mutDraft}
                onChange={(e) => setMutDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addDraftMutation();
                }}
                placeholder="Mutation (e.g. H94A)"
                className="h-8 w-36 rounded-lg border border-white/10 bg-slate-950 px-2.5 font-mono text-xs text-slate-100 placeholder-slate-500 outline-none focus:border-cyan-500"
              />
              <button
                type="button"
                onClick={addDraftMutation}
                className="flex h-8 items-center gap-1 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-2.5 text-xs font-medium text-cyan-200 hover:bg-cyan-500/25"
              >
                <Plus className="h-3.5 w-3.5" /> Add
              </button>
            </div>

            {state.mutations.map((m) => (
              <span
                key={m}
                className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2 py-1 font-mono text-[0.75rem] text-emerald-200"
              >
                {m}
                <button
                  type="button"
                  onClick={() => dispatch({ type: 'remove_mutation', notation: m })}
                  className="text-emerald-300 hover:text-white"
                  aria-label={`Remove ${m}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}

            {state.mutations.length > 0 && (
              <button
                type="button"
                onClick={() => dispatch({ type: 'set_mutations_input', raw: '' })}
                className="rounded-md px-2 py-1 text-[0.6875rem] text-slate-400 hover:bg-white/[0.06] hover:text-slate-200"
              >
                Clear all
              </button>
            )}
          </div>

          {/* Slice Range & Sequence Sync */}
          <div className="flex flex-wrap items-center gap-2 font-mono text-[0.75rem]">
            <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-slate-950/70 px-2 py-1">
              <Scissors className="h-3 w-3 text-slate-400" />
              <span className="text-slate-400">Slice</span>
              <input
                type="number"
                min={1}
                max={Math.max(1, state.sequence.length)}
                value={state.sliceStart}
                onChange={(e) =>
                  dispatch({
                    type: 'set_slice',
                    start: Number(e.target.value) || 1,
                    end: state.sliceEnd,
                  })
                }
                className="w-14 rounded border border-white/10 bg-slate-900 px-1.5 py-0.5 text-slate-200"
              />
              <span className="text-slate-500">–</span>
              <input
                type="number"
                min={state.sliceStart}
                max={Math.max(1, state.sequence.length)}
                value={state.sliceEnd}
                onChange={(e) =>
                  dispatch({
                    type: 'set_slice',
                    start: state.sliceStart,
                    end: Number(e.target.value) || state.sequence.length,
                  })
                }
                className="w-14 rounded border border-white/10 bg-slate-900 px-1.5 py-0.5 text-slate-200"
              />
              <span className="text-[0.6875rem] text-slate-500">/ {state.sequence.length} aa</span>
            </div>

            {bridge && (
              <div className="flex items-center gap-1 font-sans">
                {bridge.hasRef && (
                  <button
                    type="button"
                    onClick={() => bridge.syncPeptideFromChain('reference')}
                    title="Load amino-acid sequence from active 3D Reference chain"
                    className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[0.6875rem] text-sky-300 hover:border-sky-400/40"
                  >
                    <RefreshCw className="h-3 w-3" /> Sync Ref
                  </button>
                )}
                {bridge.hasMob && (
                  <button
                    type="button"
                    onClick={() => bridge.syncPeptideFromChain('mobile')}
                    title="Load amino-acid sequence from active 3D Comparison chain"
                    className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[0.6875rem] text-emerald-300 hover:border-emerald-400/40"
                  >
                    <RefreshCw className="h-3 w-3" /> Sync Mob
                  </button>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setSeqDraft(state.sequence);
                setEditingSeq((v) => !v);
              }}
              className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 font-sans text-[0.6875rem] text-slate-300 hover:border-white/25"
            >
              <Edit3 className="h-3 w-3" /> {editingSeq ? 'Hide Seq' : 'Edit Seq'}
            </button>
          </div>
        </div>

        {/* Dynamic Focused-Residue Quick Substitutions + CA2 Presets */}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-white/[0.06] pt-2">
          {focusedQuickMutations.length > 0 && activeFocusId !== null && (
            <>
              <span className="text-[0.6875rem] font-medium text-amber-300">
                At #{activeFocusId}:
              </span>
              {focusedQuickMutations.map((q) => (
                <button
                  key={q.notation}
                  type="button"
                  onClick={() => dispatch({ type: 'add_mutation', notation: q.notation })}
                  className="rounded-md border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[0.6875rem] text-amber-200 hover:bg-amber-500/20"
                >
                  +{q.notation} <span className="font-sans text-amber-300/75">({q.label})</span>
                </button>
              ))}
            </>
          )}

          {isCa2 && (
            <>
              <span className="ml-1 text-[0.6875rem] text-slate-500">CA II Active Site:</span>
              {['H94A', 'T199V', 'H96A', 'H119A'].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => dispatch({ type: 'add_mutation', notation: m })}
                  className="rounded-md border border-white/10 bg-slate-900 px-2 py-0.5 font-mono text-[0.6875rem] text-slate-300 hover:border-emerald-500/50 hover:text-emerald-200"
                >
                  +{m}
                </button>
              ))}
            </>
          )}
        </div>

        {editingSeq && (
          <div className="space-y-1.5 border-t border-white/[0.06] pt-2">
            <textarea
              rows={3}
              value={seqDraft}
              onChange={(e) => setSeqDraft(e.target.value)}
              placeholder="Paste 1-letter protein/peptide sequence…"
              className="w-full rounded-lg border border-white/10 bg-slate-950 p-2 font-mono text-xs text-slate-100 outline-none focus:border-sky-500"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingSeq(false)}
                className="rounded-md px-2.5 py-1 text-xs text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  dispatch({ type: 'set_sequence', sequence: seqDraft });
                  setEditingSeq(false);
                }}
                className="rounded-md bg-sky-500 px-3 py-1 text-xs font-semibold text-slate-950 hover:bg-sky-400"
              >
                Apply Sequence
              </button>
            </div>
          </div>
        )}

        {/* Interactive Sequence Strip */}
        {sequenceStrip.length > 0 && (
          <div className="flex items-center gap-1 overflow-x-auto border-t border-white/[0.06] pt-2 pb-0.5">
            <span className="mr-1 shrink-0 font-mono text-[0.6875rem] text-slate-500">Window:</span>
            {sequenceStrip.map((item) => {
              const isFocus = item.pos === activeFocusId;
              return (
                <button
                  key={item.pos}
                  type="button"
                  onClick={() => selectPosAndSync(item.pos, true)}
                  title={`Residue ${item.pos}: WT ${item.wt}${item.mutated ? ` → ${item.eng}` : ''} (click to focus in 3D)`}
                  className={`flex min-w-7 shrink-0 flex-col items-center rounded-md border px-1 py-0.5 font-mono transition ${
                    isFocus
                      ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                      : item.mutated
                        ? 'border-emerald-400/50 bg-emerald-500/15 text-emerald-200'
                        : 'border-white/[0.06] bg-black/25 text-slate-300 hover:border-sky-400/40'
                  }`}
                >
                  <span className="text-[0.5625rem] text-slate-500">{item.pos}</span>
                  <span className="text-[0.75rem] font-semibold">
                    {item.mutated ? `${item.wt}→${item.eng}` : item.wt}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 font-mono text-xs text-rose-200">
          {error}
        </div>
      )}

      {result && (
        <div className="grid grid-cols-1 gap-3 @4xl:grid-cols-2 @6xl:grid-cols-12">
          {/* WT vs Engineered Metrics Table */}
          <div className="flex flex-col gap-2.5 rounded-xl border border-white/[0.08] bg-[#0b1018] p-3 @6xl:col-span-4">
            <div className="flex items-center justify-between font-mono text-[0.75rem]">
              <span className="font-semibold text-cyan-300">WT vs ENGINEERED DELTAS</span>
              <span className="text-slate-400">{result.engineered.length} aa</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full font-mono text-[0.75rem]">
                <thead>
                  <tr className="border-b border-white/10 text-slate-500">
                    <th className="py-1.5 text-left">Metric</th>
                    <th className="py-1.5 text-right">WT</th>
                    <th className="py-1.5 text-right">Eng</th>
                    <th className="py-1.5 text-right">Δ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06] text-slate-200">
                  <tr>
                    <td className="py-1.5 text-slate-400">Avg MW (Da)</td>
                    <td className="py-1.5 text-right">{result.wildType.mwAverageDa.toFixed(1)}</td>
                    <td className="py-1.5 text-right">{result.engineered.mwAverageDa.toFixed(1)}</td>
                    <td className="py-1.5 text-right text-cyan-300">
                      {result.deltas.mwAverageDa >= 0 ? '+' : ''}
                      {result.deltas.mwAverageDa.toFixed(1)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1.5 text-slate-400">Mono MW (Da)</td>
                    <td className="py-1.5 text-right">{result.wildType.mwMonoisotopicDa.toFixed(1)}</td>
                    <td className="py-1.5 text-right">{result.engineered.mwMonoisotopicDa.toFixed(1)}</td>
                    <td className="py-1.5 text-right text-cyan-300">
                      {result.deltas.mwMonoisotopicDa >= 0 ? '+' : ''}
                      {result.deltas.mwMonoisotopicDa.toFixed(1)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1.5 text-slate-400">pI</td>
                    <td className="py-1.5 text-right">{result.wildType.pi.toFixed(2)}</td>
                    <td className="py-1.5 text-right">{result.engineered.pi.toFixed(2)}</td>
                    <td className="py-1.5 text-right text-amber-300">
                      {result.deltas.pi >= 0 ? '+' : ''}
                      {result.deltas.pi.toFixed(3)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1.5 text-slate-400">Charge pH 7.4</td>
                    <td className="py-1.5 text-right">{result.wildType.chargeAtPh74.toFixed(2)}</td>
                    <td className="py-1.5 text-right">{result.engineered.chargeAtPh74.toFixed(2)}</td>
                    <td className="py-1.5 text-right text-emerald-300">
                      {result.deltas.chargeAtPh74 >= 0 ? '+' : ''}
                      {result.deltas.chargeAtPh74.toFixed(2)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1.5 text-slate-400">GRAVY</td>
                    <td className="py-1.5 text-right">{result.wildType.gravy.toFixed(3)}</td>
                    <td className="py-1.5 text-right">{result.engineered.gravy.toFixed(3)}</td>
                    <td className="py-1.5 text-right text-violet-300">
                      {result.deltas.gravy >= 0 ? '+' : ''}
                      {result.deltas.gravy.toFixed(3)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1.5 text-slate-400">ε280 (red/ox)</td>
                    <td className="py-1.5 text-right">{result.wildType.extinctionReduced}</td>
                    <td className="py-1.5 text-right">{result.engineered.extinctionCystine}</td>
                    <td className="py-1.5 text-right text-slate-400">M⁻¹cm⁻¹</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 text-slate-400">Steric ΔV</td>
                    <td className="py-1.5 text-right">—</td>
                    <td className="py-1.5 text-right">—</td>
                    <td className="py-1.5 text-right text-amber-300">
                      {result.deltas.stericVolumeDeltaA3 >= 0 ? '+' : ''}
                      {result.deltas.stericVolumeDeltaA3.toFixed(1)} Å³
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <MetricInfoCell
                label="Aromatic Fraction"
                value={`${(result.engineered.aromaticFraction * 100).toFixed(1)}%`}
                hint="Trp + Tyr + Phe"
              />
              <MetricInfoCell
                label="Hydrophobic"
                value={`${(result.engineered.hydrophobicFraction * 100).toFixed(1)}%`}
                hint="Nonpolar residues"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <MetricInsightBadge
                insight={explainPi(result.engineered.pi, result.engineered.chargeAtPh74)}
                compact
              />
              <MetricInsightBadge insight={explainGravy(result.engineered.gravy)} compact />
            </div>
            <p className="text-[0.6875rem] leading-relaxed text-slate-400">
              {explainPi(result.engineered.pi, result.engineered.chargeAtPh74).explanation}
              {simpleMode ? '' : ` ${explainGravy(result.engineered.gravy).explanation}`}
            </p>
          </div>

          {/* Interactive Titration & Kyte-Doolittle Charts */}
          <div className="flex flex-col gap-3 rounded-xl border border-white/[0.08] bg-[#0b1018] p-3 @6xl:col-span-5">
            <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[0.75rem]">
              <span className="font-semibold text-cyan-300">
                pH 0–14 TITRATION &amp; KYTE-DOOLITTLE PROFILE
              </span>
              <span className="flex items-center gap-3 text-[0.6875rem]">
                <span className="text-sky-400">— WT</span>
                <span className="text-emerald-400">-- Engineered</span>
              </span>
            </div>

            <TitrationSvg curve={result.titrationCurve} />
            <HydropathySvg
              profile={result.gravyProfile}
              focusedPos={activeFocusId}
              onPickPos={(pos) => selectPosAndSync(pos, true)}
            />
          </div>

          {/* 3D <5.0 A Contact Shell */}
          <div className="flex flex-col gap-2.5 rounded-xl border border-white/[0.08] bg-[#0b1018] p-3 @4xl:col-span-2 @6xl:col-span-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-[0.75rem] font-semibold text-violet-300">
                3D &lt;5.0 Å CONTACT SHELL
                {activeFocusId != null ? ` (RES ${activeFocusId})` : ''}
              </span>
              {bridge && result.local3dContacts.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    bridge.highlightIn3D(
                      result.local3dContacts.map((c) => c.seqId),
                      `Peptide Shell #${activeFocusId ?? ''}`,
                      { focusSeqId: activeFocusId ?? undefined, style: 'pocket' },
                    )
                  }
                  className="inline-flex items-center gap-1 rounded-md border border-violet-400/40 bg-violet-500/15 px-2 py-0.5 text-[0.6875rem] font-medium text-violet-200 hover:bg-violet-500/25"
                >
                  <Box className="h-3 w-3" /> Show in 3D
                </button>
              )}
            </div>

            {result.local3dContacts.length === 0 ? (
              <div className="flex flex-1 flex-col justify-center gap-2 rounded-lg border border-white/[0.06] bg-black/20 p-3 text-slate-400">
                <p>
                  Select a residue (e.g. click in the 3D Viewer or sequence window above) or apply a mutation like H94A to inspect its 3D &lt;5.0 Å neighbor shell.
                </p>
              </div>
            ) : (
              <div className="max-h-60 space-y-1.5 overflow-y-auto pr-0.5 font-mono text-[0.75rem]">
                {result.local3dContacts.map((c) => (
                  <button
                    key={`${c.seqId}-${c.resName3}`}
                    type="button"
                    onClick={() => selectPosAndSync(c.seqId, true)}
                    className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-1.5 text-left transition ${
                      c.seqId === activeFocusId
                        ? 'border-amber-400/60 bg-amber-500/10'
                        : 'border-white/[0.07] bg-black/30 hover:border-cyan-400/50'
                    }`}
                  >
                    <span className="text-slate-200">
                      {c.resName3} {c.seqId}
                    </span>
                    <span className="text-emerald-300">{c.distanceAngstrom.toFixed(2)} Å</span>
                  </button>
                ))}
              </div>
            )}

            {bridge && activeFocusId !== null && (
              <div className="mt-auto flex flex-wrap gap-1.5 border-t border-white/[0.06] pt-2">
                <button
                  type="button"
                  onClick={() => bridge.focusIn3D(activeFocusId, { centerCamera: true, openViewer: 'activate' })}
                  className="inline-flex items-center gap-1 rounded-md border border-sky-400/40 bg-sky-500/15 px-2 py-1 text-[0.6875rem] font-medium text-sky-200 hover:bg-sky-500/25"
                >
                  <Crosshair className="h-3 w-3" /> Focus #{activeFocusId} in 3D
                </button>
                <button
                  type="button"
                  onClick={() => bridge.sendResidueToCrispr(activeFocusId)}
                  className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[0.6875rem] text-slate-200 hover:border-emerald-400/40"
                >
                  <Dna className="h-3 w-3 text-emerald-300" /> Codon #{activeFocusId}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TitrationSvg({
  curve,
}: {
  curve: AnalyzePeptideResult['titrationCurve'];
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  if (curve.length < 2) return null;
  const w = 360;
  const h = 110;
  const minC = Math.min(...curve.flatMap((p) => [p.wtCharge, p.engCharge]), -10);
  const maxC = Math.max(...curve.flatMap((p) => [p.wtCharge, p.engCharge]), 10);
  const span = Math.max(1, maxC - minC);

  const toX = (ph: number) => 28 + (ph / 14) * (w - 40);
  const toY = (q: number) => h - 18 - ((q - minC) / span) * (h - 28);

  const wtPath = curve
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.ph).toFixed(1)},${toY(p.wtCharge).toFixed(1)}`)
    .join(' ');
  const engPath = curve
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.ph).toFixed(1)},${toY(p.engCharge).toFixed(1)}`)
    .join(' ');

  const yZero = toY(0);
  const x74 = toX(7.4);
  const hovered = hoverIdx !== null ? curve[hoverIdx] : null;

  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const xSvg = ((e.clientX - rect.left) / rect.width) * w;
    const ph = Math.max(0, Math.min(14, ((xSvg - 28) / (w - 40)) * 14));
    let best = 0;
    let bestD = Infinity;
    curve.forEach((p, idx) => {
      const d = Math.abs(p.ph - ph);
      if (d < bestD) {
        bestD = d;
        best = idx;
      }
    });
    setHoverIdx(best);
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between font-mono text-[0.6875rem] text-slate-400">
        <span>Net Charge vs pH (0–14)</span>
        {hovered ? (
          <span className="text-slate-200">
            pH {hovered.ph.toFixed(1)} · WT {hovered.wtCharge.toFixed(2)} · Eng {hovered.engCharge.toFixed(2)}
          </span>
        ) : (
          <span>Hover curve to inspect</span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        onMouseMove={onMove}
        onMouseLeave={() => setHoverIdx(null)}
        className="w-full cursor-crosshair rounded-lg border border-white/[0.06] bg-black/35"
      >
        <line x1={28} y1={yZero} x2={w - 12} y2={yZero} stroke="#334155" strokeDasharray="3,3" strokeWidth={1} />
        <line x1={x74} y1={6} x2={x74} y2={h - 14} stroke="#f59e0b" strokeDasharray="2,2" strokeWidth={1} />
        <path d={wtPath} fill="none" stroke="#38bdf8" strokeWidth={1.8} />
        <path d={engPath} fill="none" stroke="#34d399" strokeWidth={1.6} strokeDasharray="4,2" />
        {hovered && (
          <>
            <line x1={toX(hovered.ph)} y1={6} x2={toX(hovered.ph)} y2={h - 14} stroke="rgba(148,163,184,0.45)" strokeWidth={1} />
            <circle cx={toX(hovered.ph)} cy={toY(hovered.wtCharge)} r={3} fill="#38bdf8" />
            <circle cx={toX(hovered.ph)} cy={toY(hovered.engCharge)} r={3} fill="#34d399" />
          </>
        )}
        <text x={6} y={yZero + 3} fill="#64748b" fontSize={8} fontFamily="monospace">0</text>
        <text x={x74 + 3} y={13} fill="#fbbf24" fontSize={8} fontFamily="monospace">pH 7.4</text>
        <text x={28} y={h - 4} fill="#64748b" fontSize={8} fontFamily="monospace">0</text>
        <text x={w / 2} y={h - 4} fill="#64748b" fontSize={8} fontFamily="monospace">7</text>
        <text x={w - 20} y={h - 4} fill="#64748b" fontSize={8} fontFamily="monospace">14</text>
      </svg>
    </div>
  );
}

function HydropathySvg({
  profile,
  focusedPos,
  onPickPos,
}: {
  profile: AnalyzePeptideResult['gravyProfile'];
  focusedPos: number | null;
  onPickPos: (pos: number) => void;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  if (profile.length < 2) return null;
  const w = 360;
  const h = 88;
  const toX = (idx: number) => 10 + (idx / Math.max(1, profile.length - 1)) * (w - 20);
  const toY = (v: number) => h / 2 - (v / 5.0) * (h / 2 - 10);

  const wtPath = profile
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(p.wtScore).toFixed(1)}`)
    .join(' ');
  const engPath = profile
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(p.engScore).toFixed(1)}`)
    .join(' ');

  const hovered = hoverIdx !== null ? profile[hoverIdx] : null;
  const focusedIdx = focusedPos !== null ? profile.findIndex((p) => p.index === focusedPos) : -1;

  const getIndexFromMouse = (e: MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const xSvg = ((e.clientX - rect.left) / rect.width) * w;
    const t = Math.max(0, Math.min(1, (xSvg - 10) / (w - 20)));
    return Math.round(t * (profile.length - 1));
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between font-mono text-[0.6875rem] text-slate-400">
        <span>Kyte-Doolittle Hydropathy</span>
        {hovered ? (
          <span className="text-slate-200">
            Res {hovered.index} ({hovered.res}) · WT {hovered.wtScore.toFixed(2)} · Eng {hovered.engScore.toFixed(2)}
          </span>
        ) : (
          <span>Click profile to focus 3D residue</span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        onMouseMove={(e) => setHoverIdx(getIndexFromMouse(e))}
        onMouseLeave={() => setHoverIdx(null)}
        onClick={(e) => {
          const idx = getIndexFromMouse(e);
          const item = profile[idx];
          if (item) onPickPos(item.index);
        }}
        className="w-full cursor-pointer rounded-lg border border-white/[0.06] bg-black/35"
      >
        <line x1={10} y1={h / 2} x2={w - 10} y2={h / 2} stroke="#1e293b" strokeWidth={1} />
        <path d={wtPath} fill="none" stroke="#38bdf8" strokeWidth={1.3} opacity={0.85} />
        <path d={engPath} fill="none" stroke="#34d399" strokeWidth={1.3} strokeDasharray="3,2" opacity={0.95} />
        {focusedIdx >= 0 && (
          <line x1={toX(focusedIdx)} y1={4} x2={toX(focusedIdx)} y2={h - 4} stroke="#fbbf24" strokeWidth={1.4} />
        )}
        {hovered && hoverIdx !== null && (
          <circle cx={toX(hoverIdx)} cy={toY(hovered.engScore)} r={3} fill="#fbbf24" />
        )}
      </svg>
    </div>
  );
}
