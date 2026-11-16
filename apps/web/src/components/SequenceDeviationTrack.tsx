import { useMemo, useRef } from 'react';
import type {
  CompareStructuresResult,
  InspectStructureResult,
} from '@synlexa/wasm-bridge';
import { deviationColor, rgbCss } from '../lib/colorPalettes';

interface SequenceDeviationTrackProps {
  comparison: CompareStructuresResult | null;
  refInspect: InspectStructureResult | null;
  mobInspect: InspectStructureResult | null;
  refChainId: string;
  mobChainId: string;
  focusedSeqId: number | null;
  onFocusResidue: (seqId: number) => void;
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

export function SequenceDeviationTrack({
  comparison,
  refInspect,
  mobInspect,
  refChainId,
  mobChainId,
  focusedSeqId,
  onFocusResidue,
}: SequenceDeviationTrackProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

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
    const matchedByRef = new Map<
      number,
      CompareStructuresResult['matchedResidues'][number]
    >();
    if (comparison) {
      for (const m of comparison.matchedResidues) {
        matchedByMob.set(m.mobSeqId, m);
        matchedByRef.set(m.refSeqId, m);
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

  if (columns.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-slate-500">
        Load reference and prediction structures to view aligned sequence &amp; per-residue Δd track.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2 p-2.5 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3 font-mono text-[0.75rem]">
          <span className="text-sky-300">
            REF: {comparison?.reference.label ?? 'Ref'} (Chain {comparison?.reference.chainId ?? refChainId})
          </span>
          <span className="text-emerald-300">
            MOB: {comparison?.mobile.label ?? 'Pred'} (Chain {comparison?.mobile.chainId ?? mobChainId})
          </span>
          <span className="text-amber-300/90">
            [-] = Missing experimental coordinates in declared sequence
          </span>
        </div>

        {focusedCol ? (
          <div className="flex items-center gap-3 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[0.75rem] text-amber-200">
            <span>
              Focus: {focusedCol.mobCode}
              {focusedCol.refSeqId ?? focusedCol.mobSeqId}
            </span>
            <span>
              Δd={focusedCol.distanceA != null ? `${focusedCol.distanceA.toFixed(3)} Å` : 'gap'}
            </span>
            <span>
              B={focusedCol.refBFactor != null ? `${focusedCol.refBFactor.toFixed(2)} Å²` : 'n/a'}
            </span>
            <span>
              pLDDT={focusedCol.mobPlddt != null ? focusedCol.mobPlddt.toFixed(1) : 'n/a'}
            </span>
          </div>
        ) : (
          <span className="font-mono text-[0.75rem] text-slate-500">
            Click any column to synchronize 3D, Peptide, CRISPR &amp; PAE
          </span>
        )}
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-x-auto overflow-y-hidden rounded border border-slate-800 bg-[#070a10] p-2"
      >
        <div className="inline-flex min-w-max items-end gap-[2px]">
          {columns.map((col) => {
            const seqTarget = col.refSeqId ?? col.mobSeqId ?? col.posIndex;
            const isFocused =
              focusedSeqId != null &&
              (col.refSeqId === focusedSeqId || col.mobSeqId === focusedSeqId);
            const barHeight =
              col.distanceA != null
                ? Math.max(3, Math.round((col.distanceA / maxDelta) * 44))
                : 2;
            const barRgb =
              col.distanceA != null
                ? deviationColor(col.distanceA)
                : ([71, 85, 105] as [number, number, number]);

            return (
              <button
                key={`${col.posIndex}-${col.mobSeqId ?? ''}`}
                type="button"
                onClick={() => onFocusResidue(seqTarget)}
                title={`Pos ${col.posIndex} | Ref: ${col.refCode}${col.refSeqId ?? '-'} | Mob: ${col.mobCode}${col.mobSeqId ?? '-'} | Δd=${col.distanceA != null ? `${col.distanceA.toFixed(3)} Å` : 'missing'} | B=${col.refBFactor ?? 'n/a'} | pLDDT=${col.mobPlddt ?? 'n/a'}`}
                className={`group flex w-4 shrink-0 flex-col items-center rounded-xs py-0.5 font-mono transition ${
                  isFocused
                    ? 'bg-amber-500/25 ring-1 ring-amber-400'
                    : 'hover:bg-slate-800/80'
                }`}
              >
                {/* Index tick every 10 */}
                <span className="h-3 text-[0.625rem] text-slate-500">
                  {col.posIndex % 10 === 0 || col.posIndex === 1 ? col.posIndex : ''}
                </span>

                {/* Delta-d Sparkline Bar */}
                <div className="flex h-12 w-full items-end justify-center pb-0.5">
                  <div
                    className="w-2.5 rounded-t-[1px] transition-all"
                    style={{
                      height: `${barHeight}px`,
                      backgroundColor: rgbCss(barRgb),
                      opacity: col.distanceA != null ? 0.92 : 0.3,
                    }}
                  />
                </div>

                {/* Ref residue */}
                <span
                  className={`text-[0.75rem] font-semibold leading-tight ${
                    col.refCode === '-'
                      ? 'text-amber-400'
                      : 'text-sky-300'
                  }`}
                >
                  {col.refCode}
                </span>

                {/* Mob residue */}
                <span className="text-[0.75rem] leading-tight text-emerald-300">
                  {col.mobCode}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
