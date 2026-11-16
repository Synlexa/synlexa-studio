import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Activity, Info } from 'lucide-react';
import type {
  AnalyzeRamachandranResult,
  RamachandranResidue,
} from '@synlexa/wasm-bridge';

interface RamachandranPanelProps {
  refLabel: string;
  refChain: string;
  mobLabel: string;
  mobChain: string;
  activeSource: 'reference' | 'mobile';
  onChangeSource: (source: 'reference' | 'mobile') => void;
  result: AnalyzeRamachandranResult | null;
  error: string | null;
  focusedSeqId: number | null;
  onFocusResidue: (seqId: number) => void;
  simpleMode?: boolean;
}

const PLOT_SIZE = 220;
const PLOT_PAD = 24;
const INNER = PLOT_SIZE - PLOT_PAD * 2;

function toPlotX(phi: number): number {
  return PLOT_PAD + ((phi + 180) / 360) * INNER;
}

function toPlotY(psi: number): number {
  return PLOT_PAD + ((180 - psi) / 360) * INNER;
}

function colorForResidue(r: RamachandranResidue): string {
  if (r.region === 'outlier') return '#fb7185'; // rose-400
  switch (r.secondary) {
    case 'helix':
      return '#38bdf8'; // sky-400
    case 'sheet':
      return '#34d399'; // emerald-400
    default:
      return '#fbbf24'; // amber-400
  }
}

export function RamachandranPanel({
  refLabel,
  refChain,
  mobLabel,
  mobChain,
  activeSource,
  onChangeSource,
  result,
  error,
  focusedSeqId,
  onFocusResidue,
  simpleMode = false,
}: RamachandranPanelProps) {
  const [hoveredRes, setHoveredRes] = useState<RamachandranResidue | null>(null);
  const [hoveredContact, setHoveredContact] = useState<[number, number, number] | null>(null);
  const [showAllDots, setShowAllDots] = useState(true);
  const contactCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const stats = useMemo(() => {
    if (!result) return null;
    const total = Math.max(1, result.residueCount);
    const { helix, sheet, loop } = result.secondaryCounts;
    const { favored, allowed, outlier } = result.regionCounts;
    const classified = Math.max(1, favored + allowed + outlier);
    return {
      helixPct: (helix / total) * 100,
      sheetPct: (sheet / total) * 100,
      loopPct: (loop / total) * 100,
      favoredPct: (favored / classified) * 100,
      allowedPct: (allowed / classified) * 100,
      outlierPct: (outlier / classified) * 100,
      classified,
    };
  }, [result]);

  const plottable = useMemo(
    () =>
      (result?.residues ?? []).filter(
        (r) =>
          r.phiDeg !== null &&
          r.psiDeg !== null &&
          (showAllDots || r.region === 'outlier' || r.seqId === focusedSeqId),
      ),
    [result, showAllDots, focusedSeqId],
  );

  const focusedResidue = useMemo(
    () => result?.residues.find((r) => r.seqId === focusedSeqId) ?? null,
    [result, focusedSeqId],
  );

  const focusedContacts = useMemo(() => {
    if (!result || focusedSeqId === null) return [];
    return result.contactPairs
      .filter(([i, j]) => i === focusedSeqId || j === focusedSeqId)
      .slice(0, 12);
  }, [result, focusedSeqId]);

  const seqIndexBounds = useMemo(() => {
    if (!result || result.residues.length === 0) return { min: 1, max: 1 };
    let min = result.residues[0].seqId;
    let max = result.residues[0].seqId;
    for (const r of result.residues) {
      if (r.seqId < min) min = r.seqId;
      if (r.seqId > max) max = r.seqId;
    }
    return { min, max: Math.max(min + 1, max) };
  }, [result]);

  // Draw Cα–Cα contact distance map on canvas
  useEffect(() => {
    const canvas = contactCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const size = 196;
    ctx.fillStyle = '#070a10';
    ctx.fillRect(0, 0, size, size);

    if (!result || result.residues.length === 0) return;

    const span = seqIndexBounds.max - seqIndexBounds.min;
    const mapCoord = (seqId: number) => 6 + ((seqId - seqIndexBounds.min) / span) * (size - 12);

    // Subtle diagonal
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(6, 6);
    ctx.lineTo(size - 6, size - 6);
    ctx.stroke();

    // Contact points (symmetric)
    for (const [iSeq, jSeq, dist] of result.contactPairs) {
      const x = mapCoord(iSeq);
      const y = mapCoord(jSeq);
      const t = Math.max(0, Math.min(1, (8.0 - dist) / 4.5));
      ctx.fillStyle =
        dist <= 5.0
          ? `rgba(52, 211, 153, ${0.55 + t * 0.45})`
          : `rgba(56, 189, 248, ${0.35 + t * 0.4})`;
      ctx.fillRect(x - 1, y - 1, 2.5, 2.5);
      ctx.fillRect(y - 1, x - 1, 2.5, 2.5);
    }

    // Focused residue crosshair
    if (focusedSeqId !== null) {
      const p = mapCoord(focusedSeqId);
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.65)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, size);
      ctx.moveTo(0, p);
      ctx.lineTo(size, p);
      ctx.stroke();
    }
  }, [result, seqIndexBounds, focusedSeqId]);

  const handleContactPointer = (e: MouseEvent<HTMLCanvasElement>, click: boolean) => {
    if (!result || result.contactPairs.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const size = rect.width;
    const span = seqIndexBounds.max - seqIndexBounds.min;
    const xSeq = seqIndexBounds.min + ((e.clientX - rect.left - 6) / Math.max(1, size - 12)) * span;
    const ySeq = seqIndexBounds.min + ((e.clientY - rect.top - 6) / Math.max(1, size - 12)) * span;

    let best: [number, number, number] | null = null;
    let bestD2 = 144;
    for (const pair of result.contactPairs) {
      const d1 = (pair[0] - xSeq) ** 2 + (pair[1] - ySeq) ** 2;
      const d2 = (pair[1] - xSeq) ** 2 + (pair[0] - ySeq) ** 2;
      const m = Math.min(d1, d2);
      if (m < bestD2) {
        bestD2 = m;
        best = pair;
      }
    }
    setHoveredContact(best);
    if (click && best) {
      onFocusResidue(best[0]);
    }
  };

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto p-2.5 text-xs">
      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-800 bg-[#0b1018] px-2.5 py-1.5">
        <div className="flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-cyan-300" />
          <span className="font-mono text-[0.8125rem] font-semibold text-slate-200">
            Ramachandran (φ, ψ) &amp; Cα Contact Map
          </span>
          <div className="flex items-center rounded border border-slate-700/80 bg-slate-950 p-0.5 font-mono text-[0.75rem]">
            <button
              type="button"
              onClick={() => onChangeSource('reference')}
              className={`rounded px-2 py-0.5 transition ${
                activeSource === 'reference'
                  ? 'bg-sky-500/20 text-sky-200'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Ref: {refLabel} ({refChain || '?'})
            </button>
            <button
              type="button"
              onClick={() => onChangeSource('mobile')}
              className={`rounded px-2 py-0.5 transition ${
                activeSource === 'mobile'
                  ? 'bg-emerald-500/20 text-emerald-200'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Mob: {mobLabel} ({mobChain || '?'})
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 font-mono text-[0.75rem]">
          <button
            type="button"
            onClick={() => setShowAllDots((v) => !v)}
            className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-slate-300 hover:border-cyan-500/40"
          >
            {showAllDots ? 'Show All Dots' : 'Outliers Only'}
          </button>
          {result && (
            <span className="text-slate-400">
              {result.residueCount} res · {result.contactPairs.length} Cα contacts (≤ 8 Å)
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 font-mono text-[0.8125rem] text-rose-200">
          {error}
        </div>
      )}

      {!result && !error && (
        <div className="flex flex-1 items-center justify-center font-mono text-[0.8125rem] text-slate-500">
          Computing backbone φ/ψ dihedral angles and Cα–Cα contact distances in Wasm…
        </div>
      )}

      {result && stats && (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-2.5 lg:grid-cols-12">
          {/* 1. Interactive 2D Ramachandran Plot */}
          <div className="flex flex-col items-center justify-between rounded border border-slate-800 bg-[#0b1018] p-2 lg:col-span-4">
            <div className="mb-1 flex w-full items-center justify-between font-mono text-[0.75rem]">
              <span className="font-semibold text-cyan-300">RAMACHANDRAN PLOT</span>
              <span className="text-slate-400">
                {hoveredRes
                  ? `${hoveredRes.resName3}${hoveredRes.seqId} (φ ${hoveredRes.phiDeg?.toFixed(0)}°, ψ ${hoveredRes.psiDeg?.toFixed(0)}°)`
                  : focusedResidue && focusedResidue.phiDeg !== null
                    ? `Sel: ${focusedResidue.resName3}${focusedResidue.seqId} · ${focusedResidue.region}`
                    : 'Click a dot to sync 3D'}
              </span>
            </div>

            <svg
              viewBox={`0 0 ${PLOT_SIZE} ${PLOT_SIZE}`}
              className="h-[188px] w-[188px] shrink-0 rounded border border-slate-800 bg-[#070a10]"
            >
              {/* Favored zone envelopes (schematic classic Ramachandran regions) */}
              {/* Beta sheet */}
              <rect
                x={toPlotX(-165)}
                y={toPlotY(175)}
                width={toPlotX(-65) - toPlotX(-165)}
                height={toPlotY(85) - toPlotY(175)}
                rx={6}
                fill="rgba(52, 211, 153, 0.12)"
                stroke="rgba(52, 211, 153, 0.3)"
                strokeWidth={0.75}
              />
              {/* Right-handed alpha helix */}
              <rect
                x={toPlotX(-105)}
                y={toPlotY(-5)}
                width={toPlotX(-35) - toPlotX(-105)}
                height={toPlotY(-70) - toPlotY(-5)}
                rx={6}
                fill="rgba(56, 189, 248, 0.14)"
                stroke="rgba(56, 189, 248, 0.35)"
                strokeWidth={0.75}
              />
              {/* Left-handed helix */}
              <rect
                x={toPlotX(35)}
                y={toPlotY(65)}
                width={toPlotX(95) - toPlotX(35)}
                height={toPlotY(5) - toPlotY(65)}
                rx={5}
                fill="rgba(56, 189, 248, 0.09)"
                stroke="rgba(56, 189, 248, 0.25)"
                strokeWidth={0.75}
              />

              {/* Zero axes */}
              <line
                x1={toPlotX(0)}
                y1={PLOT_PAD}
                x2={toPlotX(0)}
                y2={PLOT_SIZE - PLOT_PAD}
                stroke="rgba(148,163,184,0.25)"
                strokeDasharray="2 2"
              />
              <line
                x1={PLOT_PAD}
                y1={toPlotY(0)}
                x2={PLOT_SIZE - PLOT_PAD}
                y2={toPlotY(0)}
                stroke="rgba(148,163,184,0.25)"
                strokeDasharray="2 2"
              />
              <rect
                x={PLOT_PAD}
                y={PLOT_PAD}
                width={INNER}
                height={INNER}
                fill="none"
                stroke="rgba(51,65,85,0.8)"
              />

              {/* Axis labels */}
              <text x={PLOT_SIZE / 2} y={PLOT_SIZE - 5} textAnchor="middle" fill="#64748b" fontSize="8" fontFamily="monospace">
                φ (deg) [-180 … +180]
              </text>
              <text
                x={8}
                y={PLOT_SIZE / 2}
                textAnchor="middle"
                fill="#64748b"
                fontSize="8"
                fontFamily="monospace"
                transform={`rotate(-90 8 ${PLOT_SIZE / 2})`}
              >
                ψ (deg)
              </text>

              {/* Zone hints */}
              <text x={toPlotX(-115)} y={toPlotY(135)} textAnchor="middle" fill="rgba(52,211,153,0.55)" fontSize="7" fontFamily="monospace">
                β-sheet
              </text>
              <text x={toPlotX(-70)} y={toPlotY(-38)} textAnchor="middle" fill="rgba(56,189,248,0.65)" fontSize="7" fontFamily="monospace">
                α-helix
              </text>

              {/* Residue dots */}
              {plottable.map((r) => {
                const cx = toPlotX(r.phiDeg!);
                const cy = toPlotY(r.psiDeg!);
                const isFocused = r.seqId === focusedSeqId;
                return (
                  <g key={`${r.seqId}-${r.insCode}`}>
                    {isFocused && (
                      <circle
                        cx={cx}
                        cy={cy}
                        r={6.5}
                        fill="none"
                        stroke="#fbbf24"
                        strokeWidth={1.5}
                      />
                    )}
                    <circle
                      cx={cx}
                      cy={cy}
                      r={isFocused ? 3.5 : r.region === 'outlier' ? 3 : 2.1}
                      fill={colorForResidue(r)}
                      fillOpacity={isFocused ? 1 : 0.85}
                      className="cursor-pointer"
                      onMouseEnter={() => setHoveredRes(r)}
                      onMouseLeave={() => setHoveredRes(null)}
                      onClick={() => onFocusResidue(r.seqId)}
                    />
                  </g>
                );
              })}
            </svg>

            <div className="mt-1 flex items-center gap-3 font-mono text-[0.6875rem] text-slate-400">
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-sky-400" /> Helix
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" /> Sheet
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-amber-400" /> Loop
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-rose-400" /> Outlier
              </span>
            </div>
          </div>

          {/* 2. Secondary Structure & Geometry Quality Cards */}
          <div className="flex flex-col gap-2 rounded border border-slate-800 bg-[#0b1018] p-2.5 lg:col-span-4">
            <div className="font-mono text-[0.75rem] font-semibold text-cyan-300">
              SECONDARY STRUCTURE &amp; GEOMETRY
            </div>

            {simpleMode && (
              <div className="flex items-start gap-1.5 rounded border border-cyan-500/25 bg-cyan-500/8 px-2 py-1.5 text-[0.8125rem] text-cyan-100">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-300" />
                <span>
                  {stats.favoredPct >= 90
                    ? `${stats.favoredPct.toFixed(1)}% of dihedral pairs sit in favored Ramachandran zones — typical of well-packed backbone geometry.`
                    : `${stats.favoredPct.toFixed(1)}% favored (${result.regionCounts.outlier} outlier(s)). Click rose dots to inspect strained residues in 3D.`}
                </span>
              </div>
            )}

            {/* Helix / Sheet / Loop breakdown */}
            <div className="space-y-1.5">
              <div className="flex h-2.5 w-full overflow-hidden rounded bg-slate-900">
                <div
                  style={{ width: `${stats.helixPct}%` }}
                  className="bg-sky-400"
                  title={`Helix ${stats.helixPct.toFixed(1)}%`}
                />
                <div
                  style={{ width: `${stats.sheetPct}%` }}
                  className="bg-emerald-400"
                  title={`Sheet ${stats.sheetPct.toFixed(1)}%`}
                />
                <div
                  style={{ width: `${stats.loopPct}%` }}
                  className="bg-amber-400"
                  title={`Loop ${stats.loopPct.toFixed(1)}%`}
                />
              </div>
              <div className="grid grid-cols-3 gap-1.5 font-mono text-[0.75rem]">
                <div className="rounded border border-slate-800 bg-slate-950/70 p-1.5">
                  <div className="text-[0.6875rem] text-sky-300">α-Helix</div>
                  <div className="font-bold text-slate-100">{stats.helixPct.toFixed(1)}%</div>
                  <div className="text-[0.6875rem] text-slate-500">{result.secondaryCounts.helix} res</div>
                </div>
                <div className="rounded border border-slate-800 bg-slate-950/70 p-1.5">
                  <div className="text-[0.6875rem] text-emerald-300">β-Sheet</div>
                  <div className="font-bold text-slate-100">{stats.sheetPct.toFixed(1)}%</div>
                  <div className="text-[0.6875rem] text-slate-500">{result.secondaryCounts.sheet} res</div>
                </div>
                <div className="rounded border border-slate-800 bg-slate-950/70 p-1.5">
                  <div className="text-[0.6875rem] text-amber-300">Loop / Turn</div>
                  <div className="font-bold text-slate-100">{stats.loopPct.toFixed(1)}%</div>
                  <div className="text-[0.6875rem] text-slate-500">{result.secondaryCounts.loop} res</div>
                </div>
              </div>
            </div>

            {/* Favored / Allowed / Outliers */}
            <div className="grid grid-cols-3 gap-1.5 font-mono text-[0.75rem]">
              <div className="rounded border border-emerald-500/30 bg-emerald-500/10 p-1.5">
                <div className="text-[0.6875rem] text-emerald-300">Favored</div>
                <div className="font-bold text-emerald-200">{stats.favoredPct.toFixed(1)}%</div>
                <div className="text-[0.6875rem] text-slate-400">{result.regionCounts.favored} res</div>
              </div>
              <div className="rounded border border-sky-500/30 bg-sky-500/10 p-1.5">
                <div className="text-[0.6875rem] text-sky-300">Allowed</div>
                <div className="font-bold text-sky-200">{stats.allowedPct.toFixed(1)}%</div>
                <div className="text-[0.6875rem] text-slate-400">{result.regionCounts.allowed} res</div>
              </div>
              <div className="rounded border border-rose-500/30 bg-rose-500/10 p-1.5">
                <div className="text-[0.6875rem] text-rose-300">Outliers</div>
                <div className="font-bold text-rose-200">{result.regionCounts.outlier}</div>
                <div className="text-[0.6875rem] text-slate-400">{stats.outlierPct.toFixed(1)}%</div>
              </div>
            </div>

            {/* Outlier jump buttons */}
            {result.regionCounts.outlier > 0 && (
              <div className="flex flex-wrap items-center gap-1 font-mono text-[0.6875rem]">
                <span className="text-slate-500">Outliers:</span>
                {result.residues
                  .filter((r) => r.region === 'outlier')
                  .slice(0, 10)
                  .map((r) => (
                    <button
                      key={`${r.seqId}-${r.insCode}`}
                      type="button"
                      onClick={() => onFocusResidue(r.seqId)}
                      className={`rounded border px-1.5 py-0.5 ${
                        r.seqId === focusedSeqId
                          ? 'border-amber-400 bg-amber-400/20 text-amber-200'
                          : 'border-rose-500/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20'
                      }`}
                    >
                      {r.resName3}
                      {r.seqId}
                    </button>
                  ))}
              </div>
            )}
          </div>

          {/* 3. Cα–Cα Contact Distance Matrix */}
          <div className="flex flex-col justify-between rounded border border-slate-800 bg-[#0b1018] p-2 lg:col-span-4">
            <div className="mb-1 flex items-center justify-between font-mono text-[0.75rem]">
              <span className="font-semibold text-emerald-300">
                Cα–Cα CONTACT MAP (|i−j|≥4, ≤8 Å)
              </span>
              <span className="text-slate-400">
                {hoveredContact
                  ? `${hoveredContact[0]}–${hoveredContact[1]}: ${hoveredContact[2].toFixed(2)} Å`
                  : `${result.contactPairs.length} pairs`}
              </span>
            </div>

            <div className="flex items-start gap-2.5">
              <canvas
                ref={contactCanvasRef}
                width={196}
                height={196}
                onMouseMove={(e) => handleContactPointer(e, false)}
                onClick={(e) => handleContactPointer(e, true)}
                onMouseLeave={() => setHoveredContact(null)}
                className="h-[168px] w-[168px] shrink-0 cursor-crosshair rounded border border-slate-800"
              />
              <div className="min-w-0 flex-1 space-y-1.5 font-mono text-[0.75rem]">
                <div className="text-[0.6875rem] text-slate-400">
                  {focusedSeqId !== null
                    ? `Contacts for residue ${focusedSeqId}:`
                    : 'Click plot or contact map to inspect tertiary neighbors.'}
                </div>
                <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto">
                  {focusedContacts.map(([iSeq, jSeq, dist], idx) => {
                    const partner = iSeq === focusedSeqId ? jSeq : iSeq;
                    return (
                      <button
                        key={`${iSeq}-${jSeq}-${idx}`}
                        type="button"
                        onClick={() => onFocusResidue(partner)}
                        className="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[0.6875rem] text-slate-200 hover:border-emerald-500/50 hover:text-emerald-200"
                      >
                        res {partner} · {dist.toFixed(1)}Å
                      </button>
                    );
                  })}
                  {focusedSeqId !== null && focusedContacts.length === 0 && (
                    <span className="text-[0.6875rem] text-slate-500">
                      No non-local Cα contacts ≤ 8.0 Å.
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
