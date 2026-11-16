import { useMemo } from 'react';
import { Dna } from 'lucide-react';
import type { AnalyzeGeneCrisprResult } from '@synlexa/wasm-bridge';
import { explainGcPercent } from '../lib/metricInsights';
import type { CrisprAction, CrisprWorkbenchState } from '../lib/workbenchReducers';
import { MetricInsightBadge } from './MetricInsightBadge';

interface CrisprWorkbenchProps {
  state: CrisprWorkbenchState;
  dispatch: (action: CrisprAction) => void;
  result: AnalyzeGeneCrisprResult | null;
  error: string | null;
  onFocusResidue: (seqId: number) => void;
  simpleMode?: boolean;
}

const TRANSCRIPTS = [
  { id: 'NM_000067.3', label: 'CA2 (NM_000067.3 · P00918 260aa)' },
  { id: 'NM_000546.6', label: 'TP53 (NM_000546.6 · GRCh38 MANE)' },
  { id: 'NM_000518.5', label: 'HBB (NM_000518.5 · GRCh38 MANE)' },
];

const SEEDED_CDS_BY_ID: Record<string, string> = {
  'NM_000067.3':
    'ATGTCCCATCACTGGGGGTACGGCAAACACAACGGACCTGAGCACTGGCATAAGGACTTC' +
    'CCCATTGCCAAGGGAGAGCGCCAGTCCCCTGTTGACATCGACACTCATACAGCCAAGTAT' +
    'GACCCTTCCCTGAAGCCCCTGTCTGTTTCCTATGATCAAGCAACTTCCCTGAGGATCCTC' +
    'AACAATGGTCATGCTTTCAACGTGGAGTTTGATGACTCTCAGGACAAAGCAGTGCTCAAG' +
    'GGAGGACCCCTGGATGGCACTTACAGATTGATTCAGTTTCACTTTCACTGGGGTTCACTT' +
    'GATGGACAAGGTTCAGAGCATACTGTGGATAAAAAGAAATATGCTGCAGAACTTCACTTG' +
    'GTTCACTGGAACACCAAATATGGGGATTTTGGGAAAGCTGTGCAGCAACCTGATGGACTG' +
    'GCCGTTCTAGGTATTTTTTTGAAGGTTGGCAGCGCTAAACCGGGCCTTCAGAAAGTTGTT' +
    'GATGTGCTGGATTCCATTAAAACAAAGGGCAAGAGTGCTGACTTCACTAACTTCGATCCT' +
    'CGTGGCCTCCTTCCTGAATCCCTGGATTACTGGACCTACCCAGGCTCACTGACCACCCCT' +
    'CCTCTTCTGGAATGTGTGACCTGGATTGTGCTCAAGGAACCCATCAGCGTCAGCAGCGAG' +
    'CAGGTGTTGAAATTCCGTAAACTTAACTTCAATGGGGAGGGTGAACCCGAAGAACTGATG' +
    'GTGGACAACTGGCGCCCAGCTCAGCCACTGAAGAACAGGCAAATCAAAGCTTCCTTCAAA',
  'NM_000518.5':
    'ATGGTGCATCTGACTCCTGAGGAGAAGTCTGCCGTTACTGCCCTGTGGGGCAAGGTGAAC' +
    'GTGGATGAAGTTGGTGGTGAGGCCCTGGGCAGGCTGCTGGTGGTCTACCCTTGGACCCAG' +
    'AGGTTCTTTGAGTCCTTTGGGGATCTGTCCACTCCTGATGCTGTTATGGGCAACCCTAAG' +
    'GTGAAGGCTCATGGCAAGAAAGTGCTCGGTGCCTTTAGTGATGGCCTGGCTCACCTGGAC' +
    'AACCTCAAGGGCACCTTTGCCACACTGAGTGAGCTGCACTGTGACAAGCTGCACGTGGAT' +
    'CCTGAGAACTTCAGGCTCCTGGGCAACGTGCTGGTCTGTGTGCTGGCCCATCACTTTGGC' +
    'AAAGAATTCACCCCACCAGTGCAGGCTGCCTATCAGAAAGTGGTGGCTGGTGTGGCTAAT' +
    'GCCCTGGCCCACAAGTATCAC',
  'NM_000546.6':
    'ATGGAGGAGCCGCAGTCAGATCCTAGCGTCGAGCCCCCTCTGAGTCAGGAAACATTTTCA' +
    'GACCTATGGAAACTACTTCCTGAAAACAACGTTCTGTCCCCCTTGCCGTCCCAAGCAATG' +
    'GATGATTTGATGCTGTCCCCGGACGATATTGAACAATGGTTCACTGAAGACCCAGGTCCA' +
    'GATGAAGCTCCCAGAATGCCAGAGGCTGCTCCCCCCGTGGCCCCTGCACCAGCAGCTCCT' +
    'ACACCGGCGGCCCCTGCACCAGCCCCCTCCTGGCCCCTGTCATCTTCTGTCCCTTCCCAG' +
    'AAAACCTACCAGGGCAGCTACGGTTTCCGTCTGGGCTTCTTGCATTCTGGGACAGCCAAG' +
    'TCTGTGACTTGCACGTACTCCCCTGCCCTCAACAAGATGTTTTGCCAACTGGCCAAGACC' +
    'TGCCCTGTGCAGCTGTGGGTTGATTCCACACCCCCGCCCGGCACCCGCGTCCGCGCCATG' +
    'GCCATCTACAAGCAGTCACAGCACATGACGGAGGTTGTGAGGCGCTGCCCCCACCATGAG' +
    'CGCTGCTCAGATAGCGATGGTCTGGCCCCTCCTCAGCATCTTATCCGAGTGGAAGGAAAT' +
    'TTGCGTGTGGAGTATTTGGATGACAGAAACACTTTTCGACATAGTGTGGTGGTGCCCTAT' +
    'GAGCCGCCTGAGGTTGGCTCTGACTGTACCACCATCCACTACAACTACATGTGTAACAGT' +
    'TCCTGCATGGGCGGCATGAACCGGAGGCCCATCCTCACCATCATCACACTGGAAGACTCC' +
    'AGTGGTAATCTACTGGGACGGAACAGCTTTGAGGTGCGTGTTTGTGCCTGTCCTGGGAGA' +
    'GACCGGCGCACAGAGGAAGAGAATCTCCGCAAGAAAGGGGAGCCTCACCACGAGCTGCCC' +
    'CCAGGGAGCACTAAGCGAGCACTGCCCAACAACACCAGCTCCTCTCCCCAGCCAAAGAAG' +
    'AAACCACTGGATGGAGAATATTTCACCCTTCAGATCCGTGGGCGTGAGCGCTTCGAGATG' +
    'TTCCGAGAGCTGAATGAGGCCTTGGAACTCAAGGATGCCCAGGCTGGGAAGGAGCCAGGG' +
    'GGGAGCAGGGCTCACTCCAGCCACCTGAAGTCCAAAAAGGGTCAGTCTACCTCCCGCCAT' +
    'AAAAAACTCATGTTCAAGACAGAAGGGCCTGACTCAGAC',
};

export function CrisprWorkbench({
  state,
  dispatch,
  result,
  error,
  onFocusResidue,
  simpleMode = false,
}: CrisprWorkbenchProps) {
  const codonWindow = useMemo(() => {
    const seq =
      result?.codingDna ??
      (state.useCustomDna
        ? state.customDna
        : SEEDED_CDS_BY_ID[result?.transcriptId ?? state.transcriptId] ?? '');
    if (!seq) return [];
    const totalCodons = Math.floor(seq.length / 3);
    const center = Math.max(1, Math.min(totalCodons, state.targetCodonIndex));
    const start = Math.max(1, center - 7);
    const end = Math.min(totalCodons, center + 7);
    const items: Array<{ index1: number; triplet: string }> = [];
    for (let c = start; c <= end; c++) {
      items.push({
        index1: c,
        triplet: seq.slice((c - 1) * 3, c * 3),
      });
    }
    return items;
  }, [result?.codingDna, state.targetCodonIndex]);

  const consequenceStyle =
    result?.targetCodon.consequence === 'nonsense'
      ? 'border-rose-500/50 bg-rose-500/15 text-rose-200'
      : result?.targetCodon.consequence === 'missense'
        ? 'border-amber-500/50 bg-amber-500/15 text-amber-200'
        : result?.targetCodon.consequence === 'synonymous'
          ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200'
          : 'border-slate-700 bg-slate-900 text-slate-300';

  return (
    <div className="flex h-full flex-col gap-2.5 overflow-y-auto p-2.5 text-xs">
      {/* Controls Row */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-800 bg-[#0b1018] p-2">
        <div className="flex flex-wrap items-center gap-2">
          <Dna className="h-3.5 w-3.5 text-cyan-400" />
          <select
            value={state.useCustomDna ? 'CUSTOM' : state.transcriptId}
            onChange={(e) => {
              if (e.target.value === 'CUSTOM') {
                dispatch({ type: 'toggle_custom_dna', enabled: true });
              } else {
                dispatch({ type: 'select_transcript', transcriptId: e.target.value });
              }
            }}
            className="rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[0.8125rem] text-slate-200"
          >
            {TRANSCRIPTS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
            <option value="CUSTOM">Custom Coding DNA (CDS)…</option>
          </select>

          <label className="flex items-center gap-1 font-mono text-[0.75rem] text-slate-400">
            <span>Codon #</span>
            <input
              type="number"
              min={1}
              max={result?.proteinLengthAa ?? 500}
              value={state.targetCodonIndex}
              onChange={(e) => {
                const idx = Number(e.target.value) || 1;
                dispatch({ type: 'set_target_codon', codonIndex: idx });
                onFocusResidue(idx);
              }}
              className="w-16 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-slate-100"
            />
          </label>

          <select
            value={state.nuclease}
            onChange={(e) =>
              dispatch({
                type: 'set_nuclease',
                nuclease: e.target.value as 'SpCas9' | 'SaCas9' | 'Cas12a',
              })
            }
            className="rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[0.8125rem] text-emerald-300"
          >
            <option value="SpCas9">SpCas9 (NGG)</option>
            <option value="SaCas9">SaCas9 (NNGRRT)</option>
            <option value="Cas12a">Cas12a (TTTV)</option>
          </select>
        </div>

        {/* Base Edit Simulator */}
        <div className="flex items-center gap-1.5 font-mono text-[0.75rem]">
          <span className="text-slate-400">Edit Pos:</span>
          {([0, 1, 2] as const).map((off) => (
            <button
              key={off}
              type="button"
              onClick={() =>
                dispatch({
                  type: 'set_base_edit',
                  offset: off,
                  newBase: state.newBase,
                })
              }
              className={`rounded px-1.5 py-0.5 ${
                state.baseEditOffset === off
                  ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/40'
                  : 'bg-slate-900 text-slate-400 border border-slate-800'
              }`}
            >
              +{off + 1}
            </button>
          ))}
          <span className="text-slate-500">→</span>
          {(['A', 'C', 'G', 'T'] as const).map((b) => (
            <button
              key={b}
              type="button"
              onClick={() =>
                dispatch({
                  type: 'set_base_edit',
                  offset: state.baseEditOffset,
                  newBase: b,
                })
              }
              className={`rounded px-1.5 py-0.5 font-bold ${
                state.newBase === b
                  ? 'bg-amber-500/25 text-amber-200 border border-amber-500/50'
                  : 'bg-slate-900 text-slate-300 border border-slate-800'
              }`}
            >
              {b}
            </button>
          ))}
        </div>
      </div>

      {state.useCustomDna && (
        <textarea
          value={state.customDna}
          onChange={(e) => dispatch({ type: 'set_custom_dna', dna: e.target.value })}
          rows={2}
          placeholder="Paste coding DNA sequence (5'->3' ATG...)"
          className="w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-[0.8125rem] text-slate-200 outline-none focus:border-cyan-500"
        />
      )}

      {error && (
        <div className="rounded border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 font-mono text-[0.8125rem] text-rose-200">
          {error}
        </div>
      )}

      {result && (
        <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-12">
          {/* Codon & Mutation Consequence */}
          <div className="flex flex-col gap-2 rounded border border-slate-800 bg-[#0b1018] p-2.5 lg:col-span-5">
            <div className="flex items-center justify-between font-mono text-[0.75rem]">
              <span className="font-semibold text-cyan-300">
                {result.geneSymbol} · {result.assembly} · {result.cdsLengthBp} bp
              </span>
              <span className={`rounded border px-1.5 py-0.5 uppercase ${consequenceStyle}`}>
                {result.targetCodon.consequence}
              </span>
            </div>

            <div className="rounded border border-slate-800 bg-slate-950/70 p-2 font-mono text-[0.8125rem]">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">
                  Codon {result.targetCodon.codonIndex1} (bp {result.targetCodon.dnaStartBp1}–
                  {result.targetCodon.dnaStartBp1 + 2})
                </span>
                <span>
                  <span className="text-sky-300">
                    {result.targetCodon.wtCodon} ({result.targetCodon.wtAa})
                  </span>
                  <span className="mx-1.5 text-slate-500">→</span>
                  <span className="text-amber-300">
                    {result.targetCodon.editedCodon} ({result.targetCodon.editedAa})
                  </span>
                </span>
              </div>
              {simpleMode && (
                <div className="mt-1.5 font-sans text-[0.75rem] leading-relaxed text-slate-400">
                  {result.targetCodon.consequence === 'missense'
                    ? `Changes amino acid ${result.targetCodon.wtAa} to ${result.targetCodon.editedAa} (missense substitution).`
                    : result.targetCodon.consequence === 'synonymous'
                      ? `Silent nucleotide change — encodes the same amino acid (${result.targetCodon.wtAa}).`
                      : result.targetCodon.consequence === 'nonsense'
                        ? `Introduces a premature stop codon (*) at position ${result.targetCodon.codonIndex1}.`
                        : 'Select a different nucleotide at +1 / +2 / +3 to simulate a codon change.'}
                </div>
              )}
              {result.pamSites.length > 0 && (
                <div className="mt-1.5 font-sans">
                  <MetricInsightBadge insight={explainGcPercent(result.pamSites[0].gcPercent)} compact />
                </div>
              )}
            </div>

            {/* Synchronized Codon Window */}
            {codonWindow.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {codonWindow.map((c) => {
                  const active = c.index1 === state.targetCodonIndex;
                  return (
                    <button
                      key={c.index1}
                      type="button"
                      onClick={() => {
                        dispatch({ type: 'set_target_codon', codonIndex: c.index1 });
                        onFocusResidue(c.index1);
                      }}
                      className={`rounded border px-1.5 py-1 font-mono text-[0.75rem] transition ${
                        active
                          ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                          : 'border-slate-800 bg-slate-950 text-slate-300 hover:border-cyan-500/40'
                      }`}
                    >
                      <div className="text-[0.625rem] text-slate-500">{c.index1}</div>
                      <div>{c.triplet}</div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* PAM & Guide Scanner Table */}
          <div className="rounded border border-slate-800 bg-[#0b1018] p-2.5 lg:col-span-7">
            <div className="mb-1.5 flex items-center justify-between font-mono text-[0.75rem]">
              <span className="font-semibold text-emerald-300">
                LIVE {state.nuclease} PAM &amp; GUIDE SCANNER ({result.pamSites.length} hits)
              </span>
              <span className="text-slate-500">RUO Computational Guide Window</span>
            </div>

            <div className="max-h-36 overflow-y-auto">
              <table className="w-full font-mono text-[0.75rem]">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-500">
                    <th className="py-1 text-left">Strand</th>
                    <th className="py-1 text-left">Protospacer (5&apos;→3&apos;)</th>
                    <th className="py-1 text-left">PAM</th>
                    <th className="py-1 text-right">Cut bp</th>
                    <th className="py-1 text-right">ΔCodon</th>
                    <th className="py-1 text-right">GC%</th>
                    <th className="py-1 text-right">Poly-T</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-200">
                  {result.pamSites.slice(0, 20).map((site, idx) => (
                    <tr key={`${site.cutBp1}-${site.strand}-${idx}`} className="hover:bg-slate-900/70">
                      <td className="py-1 text-cyan-300">{site.strand}</td>
                      <td className="py-1">{site.protospacer}</td>
                      <td className="py-1 text-amber-300">{site.pam}</td>
                      <td className="py-1 text-right">{site.cutBp1}</td>
                      <td className="py-1 text-right">
                        {site.distanceToTargetCodonBp >= 0 ? '+' : ''}
                        {site.distanceToTargetCodonBp} bp
                      </td>
                      <td className="py-1 text-right">{site.gcPercent.toFixed(0)}%</td>
                      <td className="py-1 text-right">
                        {site.hasPolyT ? (
                          <span className="text-rose-400">TTTT</span>
                        ) : (
                          <span className="text-slate-500">ok</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
