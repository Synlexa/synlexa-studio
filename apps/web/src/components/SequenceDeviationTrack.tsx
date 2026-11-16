import { useMemo, useRef, useState } from 'react';
import {
  Activity,
  Box,
  Crosshair,
  Dna,
  FlaskConical,
  GitCompareArrows,
  Scissors,
} from 'lucide-react';
import type {
  CompareStructuresResult,
  InspectStructureResult,
} from '@synlexa/wasm-bridge';
import {
  bFactorColor,
  deviationColor,
  plddtColor,
  rgbCss,
} from '../lib/colorPalettes';
import { explainPlddt } from '../lib/metricInsights';
import type { Studio3DBridge } from '../lib/studioBridge';
import { MetricInsightBadge } from './MetricInsightBadge';
import { MetricInfoCell, Project3DContextBanner, ToolGuideCard } from './WorkbenchShared';

interface SequenceDeviationTrackProps {
  comparison: CompareStructuresResult | null;
  refInspect: InspectStructureResult | null;
  mobInspect: InspectStructureResult | null;
  refChainId: string;
  mobChainId: string;
  focusedSeqId: number | null;
  onFocusResidue: (seqId: number) => void;
  bridge?: Studio3DBridge;
}

interface AlignedColumn {
  posIndex: number;
  refSeqId: number | null;
  refCode: string;
  mobSeqId: number | null;
  mobCode: string;
  distanceA: number | null;
  refBFactor: number | null;
  mobPlddt: number | null;
  isMissingRefCoord: boolean;
}

type TrackMetric = 'deviation' | 'plddt' | 'bfactor';
type TrackFilter = 'all' | 'high_dev' | 'low_plddt' | 'gaps';

export function SequenceDeviationTrack({
  comparison,
  refInspect,
  mobInspect,
  refChainId,
  mobChainId,
  focusedSeqId,
  onFocusResidue,
  bridge,
}: SequenceDeviationTrackProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [metric, setMetric] = useState<TrackMetric>('deviation');
  const [filter, setFilter] = useState<TrackFilter>('all');
  const [jumpInput, setJumpInput] = useState('');
  const [guideOpen, setGuideOpen] = useState(false);

  const columns = useMemo<AlignedColumn[]>(() => {
    const refChain =
      refInspect?.chains.find((c) => c.chainId === refChainId) ??
      refInspect?.chains[0];
    const mobChain =
      mobInspect?.chains.find((c) => c.chainId === mobChainId) ??
      mobInspect?.chains[0];

    const matchedByMob = new Map<
      number,
      CompareStructuresResult['matchedResidues'][number]
    >();
    if (comparison) {
      for (const m of comparison.matchedResidues) {
        matchedByMob.set(m.mobSeqId, m);
      }
    }

    const refDeclared = refChain?.sequence1Letter ?? '';
    const refObservedMap = new Map<number, { code: string; hasCa: boolean; b: number | null }>();
    for (const r of refChain?.residues ?? []) {
      refObservedMap.set(r.seqId, {
        code: r.resCode1,
        hasCa: r.ca != null,
        b: r.bOrPlddt,
      });
    }

    if (mobChain && mobChain.residues.length > 0) {
      return mobChain.residues.map((mr, idx) => {
        const match = matchedByMob.get(mr.seqId);
        const obsRef = refObservedMap.get(mr.seqId);
        const declChar = idx < refDeclared.length ? refDeclared[idx] : null;

        if (match) {
          return {
            posIndex: idx + 1,
            refSeqId: match.refSeqId,
            refCode: match.resCode1,
            mobSeqId: match.mobSeqId,
            mobCode: mr.resCode1,
            distanceA: match.distanceAngstrom,
            refBFactor: match.refBFactor,
            mobPlddt: match.mobPlddt,
            isMissingRefCoord: false,
          };
        }

        return {
          posIndex: idx + 1,
          refSeqId: obsRef ? mr.seqId : null,
          refCode: obsRef?.hasCa ? obsRef.code : '-',
          mobSeqId: mr.seqId,
          mobCode: mr.resCode1,
          distanceA: null,
          refBFactor: obsRef?.b ?? null,
          mobPlddt: mr.bOrPlddt,
          isMissingRefCoord: !obsRef?.hasCa && declChar != null,
        };
      });
    }

    if (comparison) {
      return comparison.matchedResidues.map((m, idx) => ({
        posIndex: idx + 1,
        refSeqId: m.refSeqId,
        refCode: m.resCode1,
        mobSeqId: m.mobSeqId,
        mobCode: m.resCode1,
        distanceA: m.distanceAngstrom,
        refBFactor: m.refBFactor,
        mobPlddt: m.mobPlddt,
        isMissingRefCoord: false,
      }));
    }

    return [];
  }, [comparison, refInspect, mobInspect, refChainId, mobChainId]);

  const stats = useMemo(() => {
    let matched = 0;
    let sumD = 0;
    let maxD = 0;
    let maxDSeqId: number | null = null;
    let highDevCount = 0;
    let highDevSeqIds: number[] = [];
    let lowPlddtCount = 0;
    let gapCount = 0;
    let sumPlddt = 0;
    let plddtN = 0;

    for (const c of columns) {
      const seqId = c.refSeqId ?? c.mobSeqId ?? c.posIndex;
      if (c.distanceA != null) {
        matched++;
        sumD += c.distanceA;
        if (c.distanceA > maxD) {
          maxD = c.distanceA;
          maxDSeqId = seqId;
        }
        if (c.distanceA >= 2.0) {
          highDevCount++;
          highDevSeqIds.push(seqId);
        }
      } else {
        gapCount++;
      }
      if (c.mobPlddt != null) {
        sumPlddt += c.mobPlddt;
        plddtN++;
        if (c.mobPlddt < 70) lowPlddtCount++;
      }
    }
    return {
      matched,
      meanD: matched > 0 ? sumD / matched : 0,
      maxD,
      maxDSeqId,
      highDevCount,
      highDevSeqIds,
      lowPlddtCount,
      gapCount,
      meanPlddt: plddtN > 0 ? sumPlddt / plddtN : null,
    };
  }, [columns]);

  const visibleColumns = useMemo(() => {
    if (filter === 'all') return columns;
    return columns.filter((c) => {
      if (filter === 'high_dev') return c.distanceA != null && c.distanceA >= 2.0;
      if (filter === 'low_plddt') return c.mobPlddt != null && c.mobPlddt < 70;
      if (filter === 'gaps') return c.distanceA == null;
      return true;
    });
  }, [columns, filter]);

  const focusedCol = useMemo(
    () =>
      columns.find(
        (c) => c.refSeqId === focusedSeqId || c.mobSeqId === focusedSeqId,
      ) ?? null,
    [columns, focusedSeqId],
  );

  const maxDelta = useMemo(() => {
    let m = 2.0;
    for (const c of columns) {
      if (c.distanceA != null && c.distanceA > m) m = c.distanceA;
    }
    return m;
  }, [columns]);

  const focusAndCenter = (seqId: number) => {
    onFocusResidue(seqId);
    bridge?.focusIn3D(seqId, { centerCamera: true });
  };

  if (columns.length === 0) {
    return (
      <div className="@container flex h-full min-h-0 flex-col gap-3 p-3 @xl:p-4">
        <Project3DContextBanner
          bridge={bridge}
          title="Sequence Alignment & Per-Residue Deviation Track"
          subtitle="Compare aligned amino-acid sequences, Cα deviations (Δd), pLDDT confidence, and B-factors residue-by-residue."
          icon={<GitCompareArrows className="h-4 w-4" />}
          guideOpen={guideOpen}
          onToggleGuide={() => setGuideOpen((v) => !v)}
        />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-white/[0.08] bg-[#0b1018] p-6 text-center text-xs text-slate-400">
          <GitCompareArrows className="h-8 w-8 text-slate-500" />
          <div className="text-sm font-medium text-slate-200">No structure pair loaded</div>
          <p className="max-w-md">
            Load reference and comparison structures to inspect aligned sequence columns and per-residue Cα Δd deviations.
          </p>
          {bridge && (
            <button
              type="button"
              onClick={bridge.loadExample}
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400"
            >
              <FlaskConical className="h-3.5 w-3.5" /> Load CA II Example
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="@container flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3 text-xs @xl:p-4">
      <Project3DContextBanner
        bridge={bridge}
        title="Sequence Alignment & Per-Residue Δd Track"
        subtitle="Inspect aligned residue columns, structural deviation spikes (Δd), experimental B-factors, and AlphaFold pLDDT."
        icon={<GitCompareArrows className="h-4 w-4" />}
        guideOpen={guideOpen}
        onToggleGuide={() => setGuideOpen((v) => !v)}
      />

      <ToolGuideCard
        open={guideOpen}
        title="How Sequence Deviation Tracking Works"
        summary="Each column aligns a reference residue (top letter, sky blue) to the corresponding comparison/predicted residue (bottom letter, emerald). The bar height and color visualize local structural or confidence differences."
        steps={[
          'Switch the bar chart metric between Δd (Å), AlphaFold pLDDT, and Experimental B-factor.',
          'Use the Filter pills to isolate only High-Deviation hotspots (Δd ≥ 2.0 Å), Low-Confidence loops (pLDDT < 70), or Missing Coordinate gaps (-).',
          'Click any residue column to focus it in the 3D Viewer, or click "Highlight High Δd in 3D" to inspect flexible loops on the 3D model.',
        ]}
        connectionTip="Every column is directly bound to the 3D scene. Focusing a residue here highlights it in the 3D Viewer, updates the Peptide & CRISPR workbenches, and allows 1-click navigation to Ramachandran angles."
      />

      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-2 @lg:grid-cols-4">
        <MetricInfoCell label="Aligned / Total" value={`${stats.matched} / ${columns.length}`} hint={`${stats.gapCount} missing coords (-)`} />
        <MetricInfoCell label="Mean Δd" value={`${stats.meanD.toFixed(3)} Å`} hint="Average Cα offset" />
        <button
          type="button"
          onClick={() => stats.maxDSeqId !== null && focusAndCenter(stats.maxDSeqId)}
          disabled={stats.maxDSeqId === null}
          className="min-w-0 rounded-lg border border-amber-400/25 bg-amber-500/[0.06] px-2.5 py-2 text-left transition hover:border-amber-400/50 disabled:opacity-50"
          title="Click to jump to the highest-deviating residue"
        >
          <div className="truncate text-[0.6875rem] text-amber-300">Max Δd (Jump ↗)</div>
          <div className="mt-0.5 truncate font-mono text-sm font-semibold text-amber-200 tabular-nums">
            {stats.maxD.toFixed(2)} Å {stats.maxDSeqId !== null ? `(#${stats.maxDSeqId})` : ''}
          </div>
          <div className="mt-0.5 truncate text-[0.625rem] text-slate-400">{stats.highDevCount} res ≥ 2.0 Å</div>
        </button>
        <MetricInfoCell
          label="Mean pLDDT"
          value={stats.meanPlddt !== null ? stats.meanPlddt.toFixed(1) : 'n/a'}
          hint={stats.meanPlddt !== null ? `${stats.lowPlddtCount} res < 70` : 'No pLDDT'}
        />
      </div>

      {/* Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-[#0b1018] p-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[0.6875rem] text-slate-400">Bar Metric:</span>
          {(
            [
              ['deviation', 'Δd (Å)'],
              ['plddt', 'pLDDT'],
              ['bfactor', 'B-Factor'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setMetric(id);
                bridge?.setColorMode3D(id);
              }}
              className={`rounded-md border px-2 py-1 font-mono text-[0.6875rem] transition ${
                metric === id
                  ? 'border-sky-400/50 bg-sky-500/20 text-sky-200'
                  : 'border-white/10 bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {(
            [
              ['all', `All (${columns.length})`],
              ['high_dev', `Δd ≥ 2Å (${stats.highDevCount})`],
              ['low_plddt', `pLDDT < 70 (${stats.lowPlddtCount})`],
              ['gaps', `Gaps (${stats.gapCount})`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={`rounded-md border px-2 py-1 text-[0.6875rem] transition ${
                filter === id
                  ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-200'
                  : 'border-white/10 bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}

          {bridge && stats.highDevSeqIds.length > 0 && (
            <button
              type="button"
              onClick={() =>
                bridge.highlightIn3D(stats.highDevSeqIds, 'High Δd ≥ 2.0 Å', {
                  focusSeqId: stats.maxDSeqId ?? stats.highDevSeqIds[0],
                })
              }
              className="inline-flex items-center gap-1 rounded-md border border-rose-400/40 bg-rose-500/15 px-2 py-1 text-[0.6875rem] font-medium text-rose-200 hover:bg-rose-500/25"
            >
              <Box className="h-3 w-3" /> Highlight High Δd in 3D
            </button>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number.parseInt(jumpInput.trim(), 10);
            if (Number.isFinite(n) && n > 0) focusAndCenter(n);
          }}
          className="flex items-center gap-1"
        >
          <input
            value={jumpInput}
            onChange={(e) => setJumpInput(e.target.value)}
            placeholder="Jump res #"
            className="h-7 w-20 rounded-md border border-white/10 bg-slate-950 px-2 font-mono text-[0.6875rem] text-slate-200 outline-none focus:border-sky-400"
          />
          <button
            type="submit"
            className="h-7 rounded-md border border-white/10 bg-white/[0.04] px-2 text-[0.6875rem] text-slate-300 hover:text-white"
          >
            Go
          </button>
        </form>
      </div>

      {/* Horizontal Sequence + Bar Track */}
      <div
        ref={scrollRef}
        className="min-h-36 flex-1 overflow-x-auto overflow-y-hidden rounded-xl border border-white/[0.08] bg-[#070a10] p-3"
      >
        {visibleColumns.length === 0 ? (
          <div className="flex h-full items-center justify-center text-slate-500">
            No residues match this filter.
          </div>
        ) : (
          <div className="inline-flex min-w-max items-end gap-[3px]">
            {visibleColumns.map((col) => {
              const seqTarget = col.refSeqId ?? col.mobSeqId ?? col.posIndex;
              const isFocused =
                focusedSeqId != null &&
                (col.refSeqId === focusedSeqId || col.mobSeqId === focusedSeqId);

              let barHeight = 3;
              let barRgb: [number, number, number] = [71, 85, 105];
              let hasVal = false;

              if (metric === 'deviation' && col.distanceA != null) {
                hasVal = true;
                barHeight = Math.max(4, Math.round((col.distanceA / maxDelta) * 56));
                barRgb = deviationColor(col.distanceA);
              } else if (metric === 'plddt' && col.mobPlddt != null) {
                hasVal = true;
                barHeight = Math.max(4, Math.round((col.mobPlddt / 100) * 56));
                barRgb = plddtColor(col.mobPlddt);
              } else if (metric === 'bfactor' && col.refBFactor != null) {
                hasVal = true;
                barHeight = Math.max(4, Math.min(56, Math.round((col.refBFactor / 60) * 56)));
                barRgb = bFactorColor(col.refBFactor);
              }

              return (
                <button
                  key={`${col.posIndex}-${col.mobSeqId ?? ''}`}
                  type="button"
                  onClick={() => focusAndCenter(seqTarget)}
                  title={`Pos ${col.posIndex} | Ref: ${col.refCode}${col.refSeqId ?? '-'} | Mob: ${col.mobCode}${col.mobSeqId ?? '-'} | Δd=${col.distanceA != null ? `${col.distanceA.toFixed(3)} Å` : 'missing'} | B=${col.refBFactor ?? 'n/a'} | pLDDT=${col.mobPlddt ?? 'n/a'}`}
                  className={`group flex w-4.5 shrink-0 flex-col items-center rounded py-1 font-mono transition ${
                    isFocused
                      ? 'bg-amber-500/25 ring-1 ring-amber-400'
                      : 'hover:bg-slate-800/80'
                  }`}
                >
                  <span className="h-3.5 text-[0.5625rem] text-slate-500">
                    {col.posIndex % 10 === 0 || col.posIndex === 1 ? col.posIndex : ''}
                  </span>

                  <div className="flex h-15 w-full items-end justify-center pb-1">
                    <div
                      className="w-2.5 rounded-t-[2px] transition-all"
                      style={{
                        height: `${barHeight}px`,
                        backgroundColor: rgbCss(barRgb),
                        opacity: hasVal ? 0.94 : 0.3,
                      }}
                    />
                  </div>

                  <span
                    className={`text-[0.75rem] font-semibold leading-tight ${
                      col.refCode === '-' ? 'text-amber-400' : 'text-sky-300'
                    }`}
                  >
                    {col.refCode}
                  </span>

                  <span className="text-[0.75rem] leading-tight text-emerald-300">
                    {col.mobCode}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Focused Residue Inspector Footer */}
      {focusedCol ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/35 bg-amber-500/[0.06] px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-3 font-mono text-xs text-amber-100">
            <span className="font-semibold text-amber-200">
              Focus: {focusedCol.mobCode}
              {focusedCol.refSeqId ?? focusedCol.mobSeqId}
            </span>
            <span>
              Δd={focusedCol.distanceA != null ? `${focusedCol.distanceA.toFixed(3)} Å` : 'gap (-)'}
            </span>
            <span>
              B={focusedCol.refBFactor != null ? `${focusedCol.refBFactor.toFixed(2)} Å²` : 'n/a'}
            </span>
            <span>
              pLDDT={focusedCol.mobPlddt != null ? focusedCol.mobPlddt.toFixed(1) : 'n/a'}
            </span>
            {focusedCol.mobPlddt !== null && (
              <span className="font-sans">
                <MetricInsightBadge insight={explainPlddt(focusedCol.mobPlddt)} compact />
              </span>
            )}
          </div>

          {bridge && (
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  bridge.focusIn3D(focusedCol.refSeqId ?? focusedCol.mobSeqId ?? focusedCol.posIndex, {
                    centerCamera: true,
                    openViewer: 'activate',
                  })
                }
                className="inline-flex items-center gap-1 rounded-md border border-sky-400/40 bg-sky-500/15 px-2 py-1 text-[0.6875rem] font-medium text-sky-200 hover:bg-sky-500/25"
              >
                <Crosshair className="h-3 w-3" /> Focus in 3D
              </button>
              <button
                type="button"
                onClick={() =>
                  bridge.sendResidueToRamachandran(focusedCol.refSeqId ?? focusedCol.mobSeqId ?? focusedCol.posIndex)
                }
                className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[0.6875rem] text-slate-200 hover:border-cyan-400/40"
              >
                <Activity className="h-3 w-3 text-cyan-300" /> Ramachandran
              </button>
              <button
                type="button"
                onClick={() => {
                  const seqId = focusedCol.refSeqId ?? focusedCol.mobSeqId ?? focusedCol.posIndex;
                  const wt = focusedCol.mobCode !== '-' ? focusedCol.mobCode : focusedCol.refCode;
                  bridge.sendMutationToPeptide(`${wt}${seqId}A`, seqId);
                }}
                className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[0.6875rem] text-slate-200 hover:border-emerald-400/40"
              >
                <Scissors className="h-3 w-3 text-emerald-300" /> Ala Scan
              </button>
              <button
                type="button"
                onClick={() =>
                  bridge.sendResidueToCrispr(focusedCol.refSeqId ?? focusedCol.mobSeqId ?? focusedCol.posIndex)
                }
                className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[0.6875rem] text-slate-200 hover:border-violet-400/40"
              >
                <Dna className="h-3 w-3 text-violet-300" /> CRISPR Codon
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[0.6875rem] text-slate-400">
          <span>Click any column to synchronize 3D Viewer, Peptide, CRISPR &amp; Ramachandran.</span>
          <span className="text-amber-300/90">[-] = Missing coordinates in experimental structure</span>
        </div>
      )}
    </div>
  );
}
