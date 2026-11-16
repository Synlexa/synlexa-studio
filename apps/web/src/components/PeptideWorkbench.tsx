import { useState } from 'react';
import { Plus, Scissors, X } from 'lucide-react';
import type { AnalyzePeptideResult } from '@synlexa/wasm-bridge';
import { explainGravy, explainPi } from '../lib/metricInsights';
import type { PeptideAction, PeptideWorkbenchState } from '../lib/workbenchReducers';
import { MetricInsightBadge } from './MetricInsightBadge';

interface PeptideWorkbenchProps {
  state: PeptideWorkbenchState;
  dispatch: (action: PeptideAction) => void;
  result: AnalyzePeptideResult | null;
  error: string | null;
  onFocusResidue: (seqId: number) => void;
  simpleMode?: boolean;
}

export function PeptideWorkbench({
  state,
  dispatch,
  result,
  error,
  onFocusResidue,
  simpleMode = false,
}: PeptideWorkbenchProps) {
  const [mutDraft, setMutDraft] = useState('');

  const addDraftMutation = () => {
    const clean = mutDraft.trim().toUpperCase();
    if (!clean) return;
    dispatch({ type: 'add_mutation', notation: clean });
    setMutDraft('');
  };

  return (
    <div className="flex h-full flex-col gap-2.5 overflow-y-auto p-2.5 text-xs">
      {/* Controls Row */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-800 bg-[#0b1018] p-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <input
              value={mutDraft}
              onChange={(e) => setMutDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addDraftMutation();
              }}
              placeholder="Point mutation (e.g. H94A)"
              className="w-40 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[0.8125rem] text-slate-100 placeholder-slate-500 outline-none focus:border-cyan-500"
            />
            <button
              type="button"
              onClick={addDraftMutation}
              className="flex items-center gap-1 rounded border border-cyan-500/40 bg-cyan-500/15 px-2 py-1 text-[0.8125rem] text-cyan-200 hover:bg-cyan-500/25"
            >
              <Plus className="h-3 w-3" /> Add
            </button>
          </div>

          <div className="flex items-center gap-1 font-mono text-[0.75rem]">
            <span className="text-slate-500">Presets:</span>
            {['H94A', 'T199V', 'H96A', 'H119A'].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => dispatch({ type: 'add_mutation', notation: m })}
                className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-slate-300 hover:border-emerald-500/50 hover:text-emerald-200"
              >
                +{m}
              </button>
            ))}
          </div>

          {state.mutations.map((m) => (
            <span
              key={m}
              className="flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[0.75rem] text-emerald-200"
            >
              {m}
              <button
                type="button"
                onClick={() => dispatch({ type: 'remove_mutation', notation: m })}
                className="text-emerald-300 hover:text-white"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>

        {/* Slice Range */}
        <div className="flex items-center gap-1.5 font-mono text-[0.75rem]">
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
            className="w-14 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-slate-200"
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
            className="w-14 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-slate-200"
          />
        </div>
      </div>

      {error && (
        <div className="rounded border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 font-mono text-[0.8125rem] text-rose-200">
          {error}
        </div>
      )}

      {result && (
        <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-12">
          {/* WT vs Engineered Metrics Table */}
          <div className="rounded border border-slate-800 bg-[#0b1018] p-2.5 lg:col-span-4">
            <div className="mb-1.5 font-mono text-[0.75rem] font-semibold text-cyan-300">
              WT vs ENGINEERED BIOPHYSICAL DELTAS (WASM)
            </div>
            <table className="w-full font-mono text-[0.75rem]">
              <thead>
                <tr className="border-b border-slate-800 text-slate-500">
                  <th className="py-1 text-left">Metric</th>
                  <th className="py-1 text-right">WT</th>
                  <th className="py-1 text-right">Eng</th>
                  <th className="py-1 text-right">Δ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-slate-200">
                <tr>
                  <td className="py-1 text-slate-400">Avg MW (Da)</td>
                  <td className="py-1 text-right">{result.wildType.mwAverageDa.toFixed(1)}</td>
                  <td className="py-1 text-right">{result.engineered.mwAverageDa.toFixed(1)}</td>
                  <td className="py-1 text-right text-cyan-300">
                    {result.deltas.mwAverageDa >= 0 ? '+' : ''}
                    {result.deltas.mwAverageDa.toFixed(1)}
                  </td>
                </tr>
                <tr>
                  <td className="py-1 text-slate-400">Mono MW (Da)</td>
                  <td className="py-1 text-right">{result.wildType.mwMonoisotopicDa.toFixed(1)}</td>
                  <td className="py-1 text-right">{result.engineered.mwMonoisotopicDa.toFixed(1)}</td>
                  <td className="py-1 text-right text-cyan-300">
                    {result.deltas.mwMonoisotopicDa >= 0 ? '+' : ''}
                    {result.deltas.mwMonoisotopicDa.toFixed(1)}
                  </td>
                </tr>
                <tr>
                  <td className="py-1 text-slate-400">pI</td>
                  <td className="py-1 text-right">{result.wildType.pi.toFixed(2)}</td>
                  <td className="py-1 text-right">{result.engineered.pi.toFixed(2)}</td>
                  <td className="py-1 text-right text-amber-300">
                    {result.deltas.pi >= 0 ? '+' : ''}
                    {result.deltas.pi.toFixed(3)}
                  </td>
                </tr>
                <tr>
                  <td className="py-1 text-slate-400">Charge pH 7.4</td>
                  <td className="py-1 text-right">{result.wildType.chargeAtPh74.toFixed(2)}</td>
                  <td className="py-1 text-right">{result.engineered.chargeAtPh74.toFixed(2)}</td>
                  <td className="py-1 text-right text-emerald-300">
                    {result.deltas.chargeAtPh74 >= 0 ? '+' : ''}
                    {result.deltas.chargeAtPh74.toFixed(2)}
                  </td>
                </tr>
                <tr>
                  <td className="py-1 text-slate-400">GRAVY</td>
                  <td className="py-1 text-right">{result.wildType.gravy.toFixed(3)}</td>
                  <td className="py-1 text-right">{result.engineered.gravy.toFixed(3)}</td>
                  <td className="py-1 text-right text-violet-300">
                    {result.deltas.gravy >= 0 ? '+' : ''}
                    {result.deltas.gravy.toFixed(3)}
                  </td>
                </tr>
                <tr>
                  <td className="py-1 text-slate-400">ε280 (red/ox)</td>
                  <td className="py-1 text-right">{result.wildType.extinctionReduced}</td>
                  <td className="py-1 text-right">{result.engineered.extinctionCystine}</td>
                  <td className="py-1 text-right text-slate-400">M⁻¹cm⁻¹</td>
                </tr>
                <tr>
                  <td className="py-1 text-slate-400">Steric ΔV</td>
                  <td className="py-1 text-right">—</td>
                  <td className="py-1 text-right">—</td>
                  <td className="py-1 text-right text-amber-300">
                    {result.deltas.stericVolumeDeltaA3 >= 0 ? '+' : ''}
                    {result.deltas.stericVolumeDeltaA3.toFixed(1)} Å³
                  </td>
                </tr>
              </tbody>
            </table>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <MetricInsightBadge
                insight={explainPi(result.engineered.pi, result.engineered.chargeAtPh74)}
                compact
              />
              <MetricInsightBadge insight={explainGravy(result.engineered.gravy)} compact />
            </div>
            {simpleMode && (
              <p className="mt-1.5 text-[0.75rem] leading-relaxed text-slate-400">
                {explainPi(result.engineered.pi, result.engineered.chargeAtPh74).explanation}
              </p>
            )}
          </div>

          {/* Titration & Kyte-Doolittle Charts */}
          <div className="flex flex-col gap-2 rounded border border-slate-800 bg-[#0b1018] p-2.5 lg:col-span-5">
            <div className="flex items-center justify-between font-mono text-[0.75rem]">
              <span className="font-semibold text-cyan-300">
                pH 0–14 TITRATION &amp; KYTE-DOOLITTLE PROFILE
              </span>
              <span className="flex items-center gap-2 text-[0.6875rem]">
                <span className="text-sky-400">— WT</span>
                <span className="text-emerald-400">— Engineered</span>
              </span>
            </div>

            <TitrationSvg curve={result.titrationCurve} />
            <HydropathySvg profile={result.gravyProfile} />
          </div>

          {/* 3D <5.0 A Contact Shell */}
          <div className="rounded border border-slate-800 bg-[#0b1018] p-2.5 lg:col-span-3">
            <div className="mb-1.5 font-mono text-[0.75rem] font-semibold text-violet-300">
              3D &lt;5.0 Å CONTACT SHELL
              {state.focusSeqId != null ? ` (RES ${state.focusSeqId})` : ''}
            </div>
            {result.local3dContacts.length === 0 ? (
              <div className="text-[0.8125rem] text-slate-500">
                Select a residue or apply a mutation (e.g. H94A) to inspect its 3D &lt;5.0 Å neighbor shell.
              </div>
            ) : (
              <div className="max-h-36 space-y-1 overflow-y-auto font-mono text-[0.75rem]">
                {result.local3dContacts.map((c) => (
                  <button
                    key={`${c.seqId}-${c.resName3}`}
                    type="button"
                    onClick={() => onFocusResidue(c.seqId)}
                    className="flex w-full items-center justify-between rounded border border-slate-800 bg-slate-950/70 px-2 py-1 text-left hover:border-cyan-500/50"
                  >
                    <span className="text-slate-200">
                      {c.resName3} {c.seqId}
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

function TitrationSvg({
  curve,
}: {
  curve: AnalyzePeptideResult['titrationCurve'];
}) {
  if (curve.length < 2) return null;
  const w = 320;
  const h = 76;
  const minC = Math.min(...curve.flatMap((p) => [p.wtCharge, p.engCharge]), -10);
  const maxC = Math.max(...curve.flatMap((p) => [p.wtCharge, p.engCharge]), 10);
  const span = Math.max(1, maxC - minC);

  const toX = (ph: number) => 22 + (ph / 14) * (w - 30);
  const toY = (q: number) => h - 12 - ((q - minC) / span) * (h - 20);

  const wtPath = curve
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.ph).toFixed(1)},${toY(p.wtCharge).toFixed(1)}`)
    .join(' ');
  const engPath = curve
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.ph).toFixed(1)},${toY(p.engCharge).toFixed(1)}`)
    .join(' ');

  const yZero = toY(0);
  const x74 = toX(7.4);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full rounded bg-slate-950/70">
      <line x1={22} y1={yZero} x2={w - 8} y2={yZero} stroke="#334155" strokeDasharray="3,3" strokeWidth={1} />
      <line x1={x74} y1={4} x2={x74} y2={h - 10} stroke="#f59e0b" strokeDasharray="2,2" strokeWidth={1} />
      <path d={wtPath} fill="none" stroke="#38bdf8" strokeWidth={1.6} />
      <path d={engPath} fill="none" stroke="#34d399" strokeWidth={1.4} strokeDasharray="4,2" />
      <text x={4} y={yZero + 3} fill="#64748b" fontSize={8} fontFamily="monospace">0</text>
      <text x={x74 + 2} y={12} fill="#fbbf24" fontSize={8} fontFamily="monospace">pH7.4</text>
    </svg>
  );
}

function HydropathySvg({
  profile,
}: {
  profile: AnalyzePeptideResult['gravyProfile'];
}) {
  if (profile.length < 2) return null;
  const w = 320;
  const h = 58;
  const toX = (idx: number) => 6 + (idx / Math.max(1, profile.length - 1)) * (w - 12);
  const toY = (v: number) => h / 2 - (v / 5.0) * (h / 2 - 6);

  const wtPath = profile
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(p.wtScore).toFixed(1)}`)
    .join(' ');
  const engPath = profile
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(p.engScore).toFixed(1)}`)
    .join(' ');

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full rounded bg-slate-950/70">
      <line x1={6} y1={h / 2} x2={w - 6} y2={h / 2} stroke="#1e293b" strokeWidth={1} />
      <path d={wtPath} fill="none" stroke="#38bdf8" strokeWidth={1.1} opacity={0.85} />
      <path d={engPath} fill="none" stroke="#34d399" strokeWidth={1.1} opacity={0.9} />
      <text x={8} y={11} fill="#64748b" fontSize={8} fontFamily="monospace">Kyte-Doolittle</text>
    </svg>
  );
}
