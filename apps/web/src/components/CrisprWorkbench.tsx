import { useMemo, useState } from 'react';
import { Check, Copy, Crosshair, Dna, FolderPlus, Scissors } from 'lucide-react';
import type { AnalyzeGeneCrisprResult } from '@synlexa/wasm-bridge';
import { explainGcPercent } from '../lib/metricInsights';
import type { Studio3DBridge } from '../lib/studioBridge';
import type { CrisprAction, CrisprWorkbenchState } from '../lib/workbenchReducers';
import { MetricInsightBadge } from './MetricInsightBadge';
import { Project3DContextBanner, ToolGuideCard } from './WorkbenchShared';

interface CrisprWorkbenchProps {
  state: CrisprWorkbenchState;
  dispatch: (action: CrisprAction) => void;
  result: AnalyzeGeneCrisprResult | null;
  error: string | null;
  onFocusResidue: (seqId: number) => void;
  simpleMode?: boolean;
  bridge?: Studio3DBridge;
}

const TRANSCRIPTS = [
  { id: 'NM_000067.3', label: 'CA2 (NM_000067.3 · P00918 260aa)', matchesProteinHint: 'CA2 / 3HS4 / P00918' },
  { id: 'NM_000546.6', label: 'TP53 (NM_000546.6 · GRCh38 MANE)', matchesProteinHint: 'Tumor suppressor p53' },
  { id: 'NM_000518.5', label: 'HBB (NM_000518.5 · GRCh38 MANE)', matchesProteinHint: 'Hemoglobin β / 1A3N / P68871' },
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

type PamFilter = 'all' | 'near' | 'optimal';

export function CrisprWorkbench({
  state,
  dispatch,
  result,
  error,
  onFocusResidue,
  simpleMode = false,
  bridge,
}: CrisprWorkbenchProps) {
  const [guideOpen, setGuideOpen] = useState(false);
  const [pamFilter, setPamFilter] = useState<PamFilter>('all');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [savedToast, setSavedToast] = useState<string | null>(null);

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
  }, [result?.codingDna, result?.transcriptId, state.targetCodonIndex, state.useCustomDna, state.customDna, state.transcriptId]);

  const filteredPamSites = useMemo(() => {
    const sites = result?.pamSites ?? [];
    if (pamFilter === 'near') return sites.filter((s) => Math.abs(s.distanceToTargetCodonBp) <= 30);
    if (pamFilter === 'optimal') return sites.filter((s) => !s.hasPolyT && s.gcPercent >= 40 && s.gcPercent <= 60);
    return sites;
  }, [result?.pamSites, pamFilter]);

  const consequenceStyle =
    result?.targetCodon.consequence === 'nonsense'
      ? 'border-rose-500/50 bg-rose-500/15 text-rose-200'
      : result?.targetCodon.consequence === 'missense'
        ? 'border-amber-500/50 bg-amber-500/15 text-amber-200'
        : result?.targetCodon.consequence === 'synonymous'
          ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200'
          : 'border-slate-700 bg-slate-900 text-slate-300';

  const copyGuide = (key: string, text: string) => {
    void navigator.clipboard?.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const selectCodonAndSync3D = (codonIndex: number, center3d = false) => {
    dispatch({ type: 'set_target_codon', codonIndex });
    onFocusResidue(codonIndex);
    if (center3d) {
      bridge?.focusIn3D(codonIndex, { centerCamera: true });
    }
  };

  const canSendMissenseToPeptide =
    Boolean(bridge) &&
    Boolean(result) &&
    result!.targetCodon.consequence === 'missense' &&
    result!.targetCodon.wtAa !== '*' &&
    result!.targetCodon.editedAa !== '*';

  return (
    <div className="@container flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3 text-xs @xl:p-4">
      <Project3DContextBanner
        bridge={bridge}
        title="Gene & CRISPR Base-Editing Workbench"
        subtitle="Simulate single-nucleotide codon edits, scan SpCas9/SaCas9/Cas12a PAM windows, and bridge DNA edits to 3D residues."
        icon={<Dna className="h-4 w-4" />}
        guideOpen={guideOpen}
        onToggleGuide={() => setGuideOpen((v) => !v)}
        actions={
          bridge && result && (
            <button
              type="button"
              onClick={() => {
                bridge.saveCrisprToProject({
                  name: `${result.geneSymbol} codon ${state.targetCodonIndex} (${result.targetCodon.wtCodon}→${result.targetCodon.editedCodon})`,
                  transcriptId: state.transcriptId,
                  targetCodonIndex: state.targetCodonIndex,
                  baseEditOffset: state.baseEditOffset,
                  newBase: state.newBase,
                  nuclease: state.nuclease,
                });
                setSavedToast('Saved!');
                setTimeout(() => setSavedToast(null), 1600);
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-slate-200 hover:border-sky-400/40"
            >
              <FolderPlus className="h-3.5 w-3.5 text-sky-300" />
              <span>{savedToast ?? 'Save Edit'}</span>
            </button>
          )
        }
      />

      <ToolGuideCard
        open={guideOpen}
        title="How Gene & CRISPR Base Editing Works"
        summary="Select a GRCh38/MANE transcript or paste your own coding DNA (CDS), choose a target codon position, and test single-base edits (+1, +2, or +3 within the triplet) while scanning nearby nuclease PAM sites."
        steps={[
          'Select CA2 (matches 3HS4), HBB (matches 1A3N), TP53, or Custom Coding DNA.',
          'Pick a Codon # (or click a residue in the 3D Viewer to jump directly to its codon) and test a nucleotide change at Edit Pos +1/+2/+3.',
          'Browse PAM & Guide hits below — click any row to focus its cut-site codon in the 3D protein structure or copy its protospacer.',
        ]}
        connectionTip="Codon indices map directly onto the 3D protein residue numbering for matched transcripts (CA2 ↔ 3HS4, HBB ↔ 1A3N). When a base edit creates a missense substitution, click 'Test in Peptide' to evaluate its biophysical impact."
        glossary={[
          { term: 'SpCas9 / SaCas9 / Cas12a', desc: 'Different CRISPR nucleases recognize different PAM motifs: 5′-NGG-3′, 5′-NNGRRT-3′, and 5′-TTTV-3′ respectively.' },
          { term: 'ΔCodon (bp)', desc: 'Distance in base pairs from the predicted double-strand/nick cut site to the target codon.' },
          { term: 'GC% (40–60%)', desc: 'Balanced spacer GC content is generally preferred for gRNA stability and specificity.' },
          { term: 'Poly-T (TTTT)', desc: 'Four consecutive T’s act as a premature RNA Pol III terminator for U6-driven sgRNA expression.' },
        ]}
      />

      {/* Controls Row */}
      <div className="space-y-2.5 rounded-xl border border-white/[0.08] bg-[#0b1018] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={state.useCustomDna ? 'CUSTOM' : state.transcriptId}
              onChange={(e) => {
                if (e.target.value === 'CUSTOM') {
                  dispatch({ type: 'toggle_custom_dna', enabled: true });
                } else {
                  dispatch({ type: 'select_transcript', transcriptId: e.target.value });
                }
              }}
              aria-label="Transcript selector"
              className="h-8 rounded-lg border border-white/10 bg-slate-950 px-2.5 font-mono text-xs text-slate-200 outline-none focus:border-cyan-500"
            >
              {TRANSCRIPTS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
              <option value="CUSTOM">Custom Coding DNA (CDS)…</option>
            </select>

            <label className="flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-slate-950/70 px-2.5 font-mono text-xs text-slate-300">
              <span className="text-slate-400">Codon #</span>
              <input
                type="number"
                min={1}
                max={result?.proteinLengthAa ?? 500}
                value={state.targetCodonIndex}
                onChange={(e) => {
                  const idx = Number(e.target.value) || 1;
                  selectCodonAndSync3D(idx, false);
                }}
                className="w-16 rounded border border-white/10 bg-slate-900 px-1.5 py-0.5 text-slate-100 outline-none focus:border-cyan-500"
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
              aria-label="Nuclease selector"
              className="h-8 rounded-lg border border-white/10 bg-slate-950 px-2.5 font-mono text-xs text-emerald-300 outline-none focus:border-emerald-500"
            >
              <option value="SpCas9">SpCas9 (NGG)</option>
              <option value="SaCas9">SaCas9 (NNGRRT)</option>
              <option value="Cas12a">Cas12a (TTTV)</option>
            </select>
          </div>

          {/* Base Edit Simulator */}
          <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs">
            <span className="text-slate-400">Edit Pos:</span>
            {([0, 1, 2] as const).map((off) => (
              <button
                key={off}
                type="button"
                title={`Edit codon nucleotide ${off + 1}`}
                onClick={() =>
                  dispatch({
                    type: 'set_base_edit',
                    offset: off,
                    newBase: state.newBase,
                  })
                }
                className={`rounded-md border px-2 py-1 ${
                  state.baseEditOffset === off
                    ? 'border-cyan-500/50 bg-cyan-500/20 text-cyan-200'
                    : 'border-white/10 bg-slate-900 text-slate-400 hover:text-slate-200'
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
                title={`Substitute base with ${b}`}
                onClick={() =>
                  dispatch({
                    type: 'set_base_edit',
                    offset: state.baseEditOffset,
                    newBase: b,
                  })
                }
                className={`rounded-md border px-2 py-1 font-bold ${
                  state.newBase === b
                    ? 'border-amber-500/50 bg-amber-500/25 text-amber-200'
                    : 'border-white/10 bg-slate-900 text-slate-300 hover:border-white/25'
                }`}
              >
                {b}
              </button>
            ))}
          </div>
        </div>

        {/* Quick Examples */}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-white/[0.06] pt-2 text-[0.6875rem]">
          <span className="text-slate-500">Examples:</span>
          <button
            type="button"
            onClick={() => {
              dispatch({ type: 'select_transcript', transcriptId: 'NM_000067.3' });
              dispatch({ type: 'set_target_codon', codonIndex: 94 });
              dispatch({ type: 'set_base_edit', offset: 0, newBase: 'G' });
              onFocusResidue(94);
            }}
            className="rounded-md border border-white/10 bg-slate-900/80 px-2 py-0.5 text-slate-300 hover:border-sky-400/40 hover:text-sky-200"
          >
            CA2 Codon 94 (Zn²⁺ His)
          </button>
          <button
            type="button"
            onClick={() => {
              dispatch({ type: 'select_transcript', transcriptId: 'NM_000518.5' });
              dispatch({ type: 'set_target_codon', codonIndex: 7 });
              dispatch({ type: 'set_base_edit', offset: 1, newBase: 'T' });
              onFocusResidue(7);
            }}
            className="rounded-md border border-white/10 bg-slate-900/80 px-2 py-0.5 text-slate-300 hover:border-sky-400/40 hover:text-sky-200"
          >
            HBB Codon 7 (c.20A&gt;T · Glu→Val)
          </button>
          <button
            type="button"
            onClick={() => {
              dispatch({ type: 'select_transcript', transcriptId: 'NM_000546.6' });
              dispatch({ type: 'set_target_codon', codonIndex: 175 });
              dispatch({ type: 'set_base_edit', offset: 1, newBase: 'A' });
              onFocusResidue(175);
            }}
            className="rounded-md border border-white/10 bg-slate-900/80 px-2 py-0.5 text-slate-300 hover:border-sky-400/40 hover:text-sky-200"
          >
            TP53 Codon 175 (Arg→His)
          </button>
        </div>
      </div>

      {state.useCustomDna && (
        <textarea
          value={state.customDna}
          onChange={(e) => dispatch({ type: 'set_custom_dna', dna: e.target.value })}
          rows={3}
          placeholder="Paste coding DNA sequence (5'->3' ATG...)"
          className="w-full rounded-xl border border-white/10 bg-slate-950 p-2.5 font-mono text-xs text-slate-200 outline-none focus:border-cyan-500"
        />
      )}

      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 font-mono text-xs text-rose-200">
          {error}
        </div>
      )}

      {result && (
        <div className="grid grid-cols-1 gap-3 @4xl:grid-cols-12">
          {/* Codon & Mutation Consequence */}
          <div className="flex flex-col gap-2.5 rounded-xl border border-white/[0.08] bg-[#0b1018] p-3 @4xl:col-span-5">
            <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[0.75rem]">
              <span className="font-semibold text-cyan-300">
                {result.geneSymbol} · {result.assembly} · {result.cdsLengthBp} bp
              </span>
              <span className={`rounded-md border px-2 py-0.5 text-[0.6875rem] uppercase ${consequenceStyle}`}>
                {result.targetCodon.consequence}
              </span>
            </div>

            <div className="rounded-lg border border-white/[0.07] bg-black/30 p-2.5 font-mono text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-slate-400">
                  Codon {result.targetCodon.codonIndex1} (bp {result.targetCodon.dnaStartBp1}–
                  {result.targetCodon.dnaStartBp1 + 2})
                </span>
                <span className="font-semibold">
                  <span className="text-sky-300">
                    {result.targetCodon.wtCodon} ({result.targetCodon.wtAa})
                  </span>
                  <span className="mx-1.5 text-slate-500">→</span>
                  <span className="text-amber-300">
                    {result.targetCodon.editedCodon} ({result.targetCodon.editedAa})
                  </span>
                </span>
              </div>

              <div className="mt-2 font-sans text-xs leading-relaxed text-slate-300">
                {result.targetCodon.consequence === 'missense'
                  ? `Changes amino acid ${result.targetCodon.wtAa} to ${result.targetCodon.editedAa} (missense substitution).`
                  : result.targetCodon.consequence === 'synonymous'
                    ? `Silent nucleotide change — encodes the same amino acid (${result.targetCodon.wtAa}).`
                    : result.targetCodon.consequence === 'nonsense'
                      ? `Introduces a premature stop codon (*) at position ${result.targetCodon.codonIndex1}.`
                      : `Select a different nucleotide at +1 / +2 / +3 to simulate a codon change.${simpleMode ? '' : ''}`}
              </div>

              {result.pamSites.length > 0 && (
                <div className="mt-2 font-sans">
                  <MetricInsightBadge insight={explainGcPercent(result.pamSites[0].gcPercent)} compact />
                </div>
              )}
            </div>

            {/* Synchronized Codon Window */}
            {codonWindow.length > 0 && (
              <div className="space-y-1">
                <div className="text-[0.6875rem] text-slate-400">Click any codon to focus &amp; sync 3D:</div>
                <div className="flex flex-wrap gap-1">
                  {codonWindow.map((c) => {
                    const active = c.index1 === state.targetCodonIndex;
                    return (
                      <button
                        key={c.index1}
                        type="button"
                        onClick={() => selectCodonAndSync3D(c.index1, true)}
                        className={`rounded-md border px-2 py-1 font-mono text-xs transition ${
                          active
                            ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                            : 'border-white/10 bg-black/30 text-slate-300 hover:border-cyan-500/40'
                        }`}
                      >
                        <div className="text-[0.625rem] text-slate-500">{c.index1}</div>
                        <div>{c.triplet}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 3D & Peptide Cross-Tool Actions */}
            {bridge && (
              <div className="mt-auto flex flex-wrap gap-1.5 border-t border-white/[0.06] pt-2">
                <button
                  type="button"
                  onClick={() =>
                    bridge.focusIn3D(result.targetCodon.codonIndex1, {
                      centerCamera: true,
                      openViewer: 'activate',
                    })
                  }
                  className="inline-flex items-center gap-1 rounded-md border border-sky-400/40 bg-sky-500/15 px-2.5 py-1 text-[0.6875rem] font-medium text-sky-200 hover:bg-sky-500/25"
                >
                  <Crosshair className="h-3 w-3" /> Focus Res #{result.targetCodon.codonIndex1} in 3D
                </button>
                {canSendMissenseToPeptide && (
                  <button
                    type="button"
                    onClick={() =>
                      bridge.sendMutationToPeptide(
                        `${result.targetCodon.wtAa}${result.targetCodon.codonIndex1}${result.targetCodon.editedAa}`,
                        result.targetCodon.codonIndex1,
                      )
                    }
                    className="inline-flex items-center gap-1 rounded-md border border-emerald-400/40 bg-emerald-500/15 px-2.5 py-1 text-[0.6875rem] font-medium text-emerald-200 hover:bg-emerald-500/25"
                  >
                    <Scissors className="h-3 w-3" /> Test {result.targetCodon.wtAa}
                    {result.targetCodon.codonIndex1}
                    {result.targetCodon.editedAa} in Peptide
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Interactive PAM & Guide Scanner Table */}
          <div className="flex flex-col gap-2.5 rounded-xl border border-white/[0.08] bg-[#0b1018] p-3 @4xl:col-span-7">
            <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[0.75rem]">
              <span className="font-semibold text-emerald-300">
                {state.nuclease} PAM &amp; GUIDE SCANNER ({filteredPamSites.length}/{result.pamSites.length})
              </span>
              <div className="flex flex-wrap gap-1 font-sans text-[0.6875rem]">
                {(
                  [
                    ['all', 'All'],
                    ['near', 'Near Target (≤30bp)'],
                    ['optimal', 'Optimal GC & No TTTT'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setPamFilter(id)}
                    className={`rounded-md border px-2 py-0.5 transition ${
                      pamFilter === id
                        ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-200'
                        : 'border-white/10 bg-slate-900 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="max-h-72 overflow-auto rounded-lg border border-white/[0.06] bg-black/25">
              <table className="w-full min-w-[520px] font-mono text-[0.75rem]">
                <thead className="sticky top-0 bg-[#0d131d]">
                  <tr className="border-b border-white/10 text-slate-400">
                    <th className="px-2 py-1.5 text-left">Strand</th>
                    <th className="px-2 py-1.5 text-left">Protospacer (5&apos;→3&apos;)</th>
                    <th className="px-2 py-1.5 text-left">PAM</th>
                    <th className="px-2 py-1.5 text-right">Cut bp</th>
                    <th className="px-2 py-1.5 text-right">ΔCodon</th>
                    <th className="px-2 py-1.5 text-right">GC%</th>
                    <th className="px-2 py-1.5 text-right">Poly-T</th>
                    <th className="px-2 py-1.5 text-right">Copy</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05] text-slate-200">
                  {filteredPamSites.slice(0, 30).map((site, idx) => {
                    const cutCodon = Math.max(1, Math.ceil(site.cutBp1 / 3));
                    const key = `${site.cutBp1}-${site.strand}-${idx}`;
                    return (
                      <tr
                        key={key}
                        onClick={() => selectCodonAndSync3D(cutCodon, true)}
                        title={`Click to jump to cut codon #${cutCodon} and focus in 3D`}
                        className="cursor-pointer transition hover:bg-sky-500/10"
                      >
                        <td className="px-2 py-1.5 text-cyan-300">{site.strand}</td>
                        <td className="px-2 py-1.5">{site.protospacer}</td>
                        <td className="px-2 py-1.5 text-amber-300">{site.pam}</td>
                        <td className="px-2 py-1.5 text-right">{site.cutBp1}</td>
                        <td className="px-2 py-1.5 text-right">
                          {site.distanceToTargetCodonBp >= 0 ? '+' : ''}
                          {site.distanceToTargetCodonBp} bp
                        </td>
                        <td className="px-2 py-1.5 text-right">{site.gcPercent.toFixed(0)}%</td>
                        <td className="px-2 py-1.5 text-right">
                          {site.hasPolyT ? (
                            <span className="text-rose-400">TTTT</span>
                          ) : (
                            <span className="text-emerald-400">ok</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              copyGuide(key, `${site.protospacer}${site.pam}`);
                            }}
                            title="Copy protospacer + PAM"
                            className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white"
                          >
                            {copiedKey === key ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredPamSites.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-3 py-6 text-center font-sans text-xs text-slate-500">
                        No PAM sites match the current filter. Switch to &ldquo;All&rdquo; or try another nuclease.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="text-[0.6875rem] text-slate-500">
              RUO Computational Guide Window · Click any row to focus the corresponding cut-site codon in the 3D protein structure.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
