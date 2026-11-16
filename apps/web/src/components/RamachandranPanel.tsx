import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import {
  Activity,
  Box,
  Crosshair,
  FlaskConical,
  GitCompareArrows,
  Info,
  Scissors,
} from 'lucide-react';
import type {
  AnalyzeRamachandranResult,
  RamachandranResidue,
} from '@synlexa/wasm-bridge';
import type { Studio3DBridge } from '../lib/studioBridge';
import { Project3DContextBanner, ToolGuideCard } from './WorkbenchShared';

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
  bridge?: Studio3DBridge;
}

type PlotFilter = 'all' | 'helix' | 'sheet' | 'loop' | 'outlier';

const PLOT_SIZE = 260;
const PLOT_PAD = 28;
const INNER = PLOT_SIZE - PLOT_PAD * 2;
const CONTACT_CANVAS_PX = 360;

function toPlotX(phi: number): number {
  return PLOT_PAD + ((phi + 180) / 360) * INNER;
}

function toPlotY(psi: number): number {
  return PLOT_PAD + ((180 - psi) / 360) * INNER;
}

function colorForResidue(r: RamachandranResidue): string {
  if (r.region === 'outlier') return '#fb7185';
  switch (r.secondary) {
    case 'helix':
      return '#38bdf8';
    case 'sheet':
      return '#34d399';
    default:
      return '#fbbf24';
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
  bridge,
}: RamachandranPanelProps) {
  const [hoveredRes, setHoveredRes] = useState<RamachandranResidue | null>(null);
  const [hoveredContact, setHoveredContact] = useState<[number, number, number] | null>(null);
  const [plotFilter, setPlotFilter] = useState<PlotFilter>('all');
  const [contactCutoff, setContactCutoff] = useState(8.0);
  const [longRangeOnly, setLongRangeOnly] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const contactCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const residueBySeqId = useMemo(() => {
    const map = new Map<number, RamachandranResidue>();
    for (const r of result?.residues ?? []) map.set(r.seqId, r);
    return map;
  }, [result]);

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
      (result?.residues ?? []).filter((r) => {
        if (r.phiDeg === null || r.psiDeg === null) return false;
        if (r.seqId === focusedSeqId) return true;
        if (plotFilter === 'all') return true;
        if (plotFilter === 'outlier') return r.region === 'outlier';
        return r.secondary === plotFilter;
      }),
    [result, plotFilter, focusedSeqId],
  );

  const outlierResidues = useMemo(
    () => (result?.residues ?? []).filter((r) => r.region === 'outlier'),
    [result],
  );

  const filteredContacts = useMemo(() => {
    if (!result) return [];
    const minSep = longRangeOnly ? 12 : 4;
    return result.contactPairs.filter(
      ([i, j, dist]) => dist <= contactCutoff && Math.abs(i - j) >= minSep,
    );
  }, [result, contactCutoff, longRangeOnly]);

  const focusedResidue = useMemo(
    () => (focusedSeqId !== null ? residueBySeqId.get(focusedSeqId) ?? null : null),
    [residueBySeqId, focusedSeqId],
  );

  const focusedContacts = useMemo(() => {
    if (focusedSeqId === null) return [];
    return filteredContacts
      .filter(([i, j]) => i === focusedSeqId || j === focusedSeqId)
      .sort((a, b) => a[2] - b[2]);
  }, [filteredContacts, focusedSeqId]);

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

  // Draw Cα–Cα contact distance map on high-res canvas
  useEffect(() => {
    const canvas = contactCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const size = CONTACT_CANVAS_PX;
    ctx.fillStyle = '#070a10';
    ctx.fillRect(0, 0, size, size);

    if (!result || result.residues.length === 0) return;

    const pad = 12;
    const span = seqIndexBounds.max - seqIndexBounds.min;
    const mapCoord = (seqId: number) => pad + ((seqId - seqIndexBounds.min) / span) * (size - pad * 2);

    // Subtle grid lines every 50 residues
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
    ctx.lineWidth = 1;
    for (let tick = Math.ceil(seqIndexBounds.min / 50) * 50; tick <= seqIndexBounds.max; tick += 50) {
      const p = mapCoord(tick);
      ctx.beginPath();
      ctx.moveTo(p, pad);
      ctx.lineTo(p, size - pad);
      ctx.moveTo(pad, p);
      ctx.lineTo(size - pad, p);
      ctx.stroke();
    }

    // Diagonal backbone line
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(pad, pad);
    ctx.lineTo(size - pad, size - pad);
    ctx.stroke();

    // Contact points (symmetric)
    for (const [iSeq, jSeq, dist] of filteredContacts) {
      const x = mapCoord(iSeq);
      const y = mapCoord(jSeq);
      const t = Math.max(0, Math.min(1, (contactCutoff - dist) / Math.max(1, contactCutoff - 3.5)));
      ctx.fillStyle =
        dist <= 5.5
          ? `rgba(52, 211, 153, ${0.6 + t * 0.4})`
          : `rgba(56, 189, 248, ${0.4 + t * 0.45})`;
      ctx.fillRect(x - 1.6, y - 1.6, 3.4, 3.4);
      ctx.fillRect(y - 1.6, x - 1.6, 3.4, 3.4);
    }

    // Focused residue crosshair
    if (focusedSeqId !== null) {
      const p = mapCoord(focusedSeqId);
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.8)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, size);
      ctx.moveTo(0, p);
      ctx.lineTo(size, p);
      ctx.stroke();
    }
  }, [result, filteredContacts, contactCutoff, seqIndexBounds, focusedSeqId]);

  const selectResidueAndSync3D = (seqId: number, centerCamera = false) => {
    onFocusResidue(seqId);
    if (centerCamera) {
      bridge?.focusIn3D(seqId, { centerCamera: true });
    }
  };

  const handleContactPointer = (e: MouseEvent<HTMLCanvasElement>, click: boolean) => {
    if (!result || filteredContacts.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const size = rect.width;
    const padRatio = 12 / CONTACT_CANVAS_PX;
    const padPx = size * padRatio;
    const span = seqIndexBounds.max - seqIndexBounds.min;
    const xSeq = seqIndexBounds.min + ((e.clientX - rect.left - padPx) / Math.max(1, size - padPx * 2)) * span;
    const ySeq = seqIndexBounds.min + ((e.clientY - rect.top - padPx) / Math.max(1, size - padPx * 2)) * span;

    let best: [number, number, number] | null = null;
    let bestD2 = 160;
    for (const pair of filteredContacts) {
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
      selectResidueAndSync3D(best[0], true);
    }
  };

  const hasAnyStructure = Boolean(refLabel || mobLabel);

  return (
    <div className="@container flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3 text-xs @xl:p-4">
      <Project3DContextBanner
        bridge={bridge}
        title="Ramachandran Geometry & Cα Contact Map"
        subtitle="Inspect backbone dihedral angles (φ, ψ), secondary structure packing, conformational outliers, and 3D tertiary contacts."
        icon={<Activity className="h-4 w-4" />}
        guideOpen={guideOpen}
        onToggleGuide={() => setGuideOpen((v) => !v)}
      />

      <ToolGuideCard
        open={guideOpen}
        title="How Ramachandran & Cα Contact Analysis Works"
        summary="Every protein residue’s backbone conformation is defined by two dihedral torsion angles: φ (N–Cα) and ψ (Cα–C). Plotting φ vs ψ reveals well-packed α-helices and β-sheets versus strained outliers."
        steps={[
          'Switch between Reference (experimental) and Mobile (predicted) structures in the toolbar below.',
          'Filter the Ramachandran plot by Helix, Sheet, Loop, or Outliers Only; click any dot to inspect its φ/ψ angles and sync the 3D Viewer.',
          'Use the Cα–Cα Contact Map to inspect folded tertiary contacts (distant residues in sequence that touch in 3D space). Adjust the Å cutoff or toggle Long-Range contacts.',
        ]}
        connectionTip="Every click on a Ramachandran dot, outlier chip, or contact neighbor synchronizes your focused residue across the 3D Viewer, Sequence Track, Peptide, and CRISPR tabs. Use 'Highlight Outliers in 3D' or 'Highlight Contacts in 3D' to light them up directly on the 3D model."
        glossary={[
          { term: 'Favored / Allowed / Outlier', desc: 'Empirical backbone angle regions; well-refined proteins typically have ≥ 90% in favored zones (Gly and Pro can legitimately occupy broader regions).' },
          { term: 'Cα–Cα Contact (≤ 8 Å)', desc: 'Residues separated by at least 4 sequence positions whose alpha carbons sit within 8 Å in 3D — defining secondary & tertiary fold packing.' },
          { term: 'Long-Range (|i−j| ≥ 12)', desc: 'Contacts between distant parts of the chain that reveal global domain folding rather than local helix turns.' },
        ]}
      />

      {/* Top Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-[#0b1018] p-2.5">
        <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs">
          <button
            type="button"
            disabled={!refLabel}
            onClick={() => onChangeSource('reference')}
            className={`rounded-lg border px-2.5 py-1 transition disabled:opacity-40 ${
              activeSource === 'reference'
                ? 'border-sky-400/50 bg-sky-500/20 text-sky-200'
                : 'border-white/10 bg-slate-950 text-slate-400 hover:text-slate-200'
            }`}
          >
            Ref: {refLabel || 'None'} ({refChain || '?'})
          </button>
          <button
            type="button"
            disabled={!mobLabel}
            onClick={() => onChangeSource('mobile')}
            className={`rounded-lg border px-2.5 py-1 transition disabled:opacity-40 ${
              activeSource === 'mobile'
                ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-200'
                : 'border-white/10 bg-slate-950 text-slate-400 hover:text-slate-200'
            }`}
          >
            Mob: {mobLabel || 'None'} ({mobChain || '?'})
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {(
            [
              ['all', 'All'],
              ['helix', 'α-Helix'],
              ['sheet', 'β-Sheet'],
              ['loop', 'Loop'],
              ['outlier', `Outliers (${outlierResidues.length})`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setPlotFilter(id)}
              className={`rounded-md border px-2 py-1 font-mono text-[0.6875rem] transition ${
                plotFilter === id
                  ? 'border-cyan-400/50 bg-cyan-500/20 text-cyan-200'
                  : 'border-white/10 bg-slate-900/70 text-slate-400 hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 font-mono text-xs text-rose-200">
          {error}
        </div>
      )}

      {!hasAnyStructure && !result && !error && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-white/[0.08] bg-[#0b1018] p-6 text-center">
          <Activity className="h-8 w-8 text-slate-500" />
          <div className="text-sm font-medium text-slate-200">No structure loaded for Ramachandran analysis</div>
          <p className="max-w-md text-xs text-slate-400">
            Load a PDB or mmCIF structure to compute backbone φ/ψ dihedral angles and tertiary Cα–Cα contact maps.
          </p>
          {bridge && (
            <button
              type="button"
              onClick={bridge.loadExample}
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400"
            >
              <FlaskConical className="h-3.5 w-3.5" /> Load Carbonic Anhydrase II Example
            </button>
          )}
        </div>
      )}

      {hasAnyStructure && !result && !error && (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-white/[0.08] bg-[#0b1018] p-6 font-mono text-xs text-slate-500">
          Computing backbone φ/ψ dihedral angles and Cα–Cα contact distances in Wasm…
        </div>
      )}

      {result && stats && (
        <div className="grid grid-cols-1 gap-3 @3xl:grid-cols-2 @6xl:grid-cols-12">
          {/* 1. Interactive 2D Ramachandran Plot */}
          <div className="flex flex-col gap-2.5 rounded-xl border border-white/[0.08] bg-[#0b1018] p-3 @6xl:col-span-4">
            <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[0.75rem]">
              <span className="font-semibold text-cyan-300">RAMACHANDRAN PLOT</span>
              <span className="text-slate-300">
                {hoveredRes
                  ? `${hoveredRes.resName3}${hoveredRes.seqId} (φ ${hoveredRes.phiDeg?.toFixed(0)}°, ψ ${hoveredRes.psiDeg?.toFixed(0)}°)`
                  : focusedResidue && focusedResidue.phiDeg !== null
                    ? `Sel: ${focusedResidue.resName3}${focusedResidue.seqId} · ${focusedResidue.region}`
                    : 'Click any dot to focus in 3D'}
              </span>
            </div>

            <div className="flex w-full justify-center">
              <svg
                viewBox={`0 0 ${PLOT_SIZE} ${PLOT_SIZE}`}
                className="aspect-square w-full max-w-[330px] rounded-lg border border-white/10 bg-[#070a10]"
              >
                {/* Beta sheet */}
                <rect
                  x={toPlotX(-165)}
                  y={toPlotY(175)}
                  width={toPlotX(-65) - toPlotX(-165)}
                  height={toPlotY(85) - toPlotY(175)}
                  rx={6}
                  fill="rgba(52, 211, 153, 0.12)"
                  stroke="rgba(52, 211, 153, 0.35)"
                  strokeWidth={0.85}
                />
                {/* Right-handed alpha helix */}
                <rect
                  x={toPlotX(-105)}
                  y={toPlotY(-5)}
                  width={toPlotX(-35) - toPlotX(-105)}
                  height={toPlotY(-70) - toPlotY(-5)}
                  rx={6}
                  fill="rgba(56, 189, 248, 0.14)"
                  stroke="rgba(56, 189, 248, 0.38)"
                  strokeWidth={0.85}
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
                  strokeWidth={0.85}
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
                  stroke="rgba(51,65,85,0.85)"
                />

                {/* Axis labels */}
                <text x={PLOT_SIZE / 2} y={PLOT_SIZE - 7} textAnchor="middle" fill="#64748b" fontSize="9" fontFamily="monospace">
                  φ (deg) [-180 … +180]
                </text>
                <text
                  x={10}
                  y={PLOT_SIZE / 2}
                  textAnchor="middle"
                  fill="#64748b"
                  fontSize="9"
                  fontFamily="monospace"
                  transform={`rotate(-90 10 ${PLOT_SIZE / 2})`}
                >
                  ψ (deg)
                </text>

                <text x={toPlotX(-115)} y={toPlotY(135)} textAnchor="middle" fill="rgba(52,211,153,0.65)" fontSize="8" fontFamily="monospace">
                  β-sheet
                </text>
                <text x={toPlotX(-70)} y={toPlotY(-38)} textAnchor="middle" fill="rgba(56,189,248,0.75)" fontSize="8" fontFamily="monospace">
                  α-helix
                </text>
                <text x={toPlotX(65)} y={toPlotY(35)} textAnchor="middle" fill="rgba(56,189,248,0.55)" fontSize="7" fontFamily="monospace">
                  L-helix
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
                          r={7.5}
                          fill="none"
                          stroke="#fbbf24"
                          strokeWidth={1.8}
                        />
                      )}
                      <circle
                        cx={cx}
                        cy={cy}
                        r={isFocused ? 4.2 : r.region === 'outlier' ? 3.5 : 2.5}
                        fill={colorForResidue(r)}
                        fillOpacity={isFocused ? 1 : 0.85}
                        className="cursor-pointer"
                        onMouseEnter={() => setHoveredRes(r)}
                        onMouseLeave={() => setHoveredRes(null)}
                        onClick={() => selectResidueAndSync3D(r.seqId, true)}
                      />
                    </g>
                  );
                })}
              </svg>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3 font-mono text-[0.6875rem] text-slate-400">
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

          {/* 2. Secondary Structure, Quality Cards & Focused Residue Inspector */}
          <div className="flex flex-col gap-3 rounded-xl border border-white/[0.08] bg-[#0b1018] p-3 @6xl:col-span-4">
            <div className="flex items-center justify-between gap-2 font-mono text-[0.75rem]">
              <span className="font-semibold text-cyan-300">SECONDARY STRUCTURE &amp; GEOMETRY</span>
              <span className="text-slate-400">{result.residueCount} res</span>
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-cyan-500/25 bg-cyan-500/8 px-2.5 py-2 text-xs leading-relaxed text-cyan-100">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-300" />
              <span>
                {stats.favoredPct >= 90
                  ? `${stats.favoredPct.toFixed(1)}% of dihedral pairs sit in favored Ramachandran zones — typical of well-packed backbone geometry.`
                  : `${stats.favoredPct.toFixed(1)}% favored (${result.regionCounts.outlier} outlier${result.regionCounts.outlier === 1 ? '' : 's'}). Click rose dots or outlier chips to inspect strained residues in 3D.`}
                {simpleMode ? '' : ' Click any residue dot or outlier below to jump in 3D.'}
              </span>
            </div>

            {/* Helix / Sheet / Loop bar + cards */}
            <div className="space-y-2">
              <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-900">
                <div style={{ width: `${stats.helixPct}%` }} className="bg-sky-400" title={`α-Helix ${stats.helixPct.toFixed(1)}%`} />
                <div style={{ width: `${stats.sheetPct}%` }} className="bg-emerald-400" title={`β-Sheet ${stats.sheetPct.toFixed(1)}%`} />
                <div style={{ width: `${stats.loopPct}%` }} className="bg-amber-400" title={`Loop / Turn ${stats.loopPct.toFixed(1)}%`} />
              </div>
              <div className="grid grid-cols-3 gap-2 font-mono text-xs">
                <div className="min-w-0 rounded-lg border border-white/[0.07] bg-black/25 p-2">
                  <div className="truncate text-[0.6875rem] text-sky-300">α-Helix</div>
                  <div className="mt-0.5 font-bold text-slate-100">{stats.helixPct.toFixed(1)}%</div>
                  <div className="text-[0.6875rem] text-slate-500">{result.secondaryCounts.helix} res</div>
                </div>
                <div className="min-w-0 rounded-lg border border-white/[0.07] bg-black/25 p-2">
                  <div className="truncate text-[0.6875rem] text-emerald-300">β-Sheet</div>
                  <div className="mt-0.5 font-bold text-slate-100">{stats.sheetPct.toFixed(1)}%</div>
                  <div className="text-[0.6875rem] text-slate-500">{result.secondaryCounts.sheet} res</div>
                </div>
                <div className="min-w-0 rounded-lg border border-white/[0.07] bg-black/25 p-2">
                  <div className="truncate text-[0.6875rem] text-amber-300">Loop / Turn</div>
                  <div className="mt-0.5 font-bold text-slate-100">{stats.loopPct.toFixed(1)}%</div>
                  <div className="text-[0.6875rem] text-slate-500">{result.secondaryCounts.loop} res</div>
                </div>
              </div>
            </div>

            {/* Favored / Allowed / Outliers */}
            <div className="grid grid-cols-3 gap-2 font-mono text-xs">
              <div className="min-w-0 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2">
                <div className="truncate text-[0.6875rem] text-emerald-300">Favored</div>
                <div className="mt-0.5 font-bold text-emerald-200">{stats.favoredPct.toFixed(1)}%</div>
                <div className="text-[0.6875rem] text-slate-400">{result.regionCounts.favored} res</div>
              </div>
              <div className="min-w-0 rounded-lg border border-sky-500/30 bg-sky-500/10 p-2">
                <div className="truncate text-[0.6875rem] text-sky-300">Allowed</div>
                <div className="mt-0.5 font-bold text-sky-200">{stats.allowedPct.toFixed(1)}%</div>
                <div className="text-[0.6875rem] text-slate-400">{result.regionCounts.allowed} res</div>
              </div>
              <div className="min-w-0 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2">
                <div className="truncate text-[0.6875rem] text-rose-300">Outliers</div>
                <div className="mt-0.5 font-bold text-rose-200">{result.regionCounts.outlier}</div>
                <div className="text-[0.6875rem] text-slate-400">{stats.outlierPct.toFixed(1)}%</div>
              </div>
            </div>

            {/* Outlier jump chips + 3D highlight button */}
            {outlierResidues.length > 0 && (
              <div className="space-y-1.5 rounded-lg border border-rose-500/20 bg-rose-500/[0.04] p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-[0.6875rem] font-medium text-rose-300">
                    Outliers ({outlierResidues.length}):
                  </span>
                  {bridge && (
                    <button
                      type="button"
                      onClick={() =>
                        bridge.highlightIn3D(
                          outlierResidues.map((r) => r.seqId),
                          'Ramachandran Outliers',
                          { focusSeqId: outlierResidues[0]?.seqId },
                        )
                      }
                      className="inline-flex items-center gap-1 rounded-md border border-rose-400/40 bg-rose-500/15 px-2 py-0.5 text-[0.6875rem] font-medium text-rose-200 hover:bg-rose-500/25"
                    >
                      <Box className="h-3 w-3" /> Highlight Outliers in 3D
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1 font-mono text-[0.6875rem]">
                  {outlierResidues.slice(0, 14).map((r) => (
                    <button
                      key={`${r.seqId}-${r.insCode}`}
                      type="button"
                      onClick={() => selectResidueAndSync3D(r.seqId, true)}
                      className={`rounded-md border px-2 py-0.5 transition ${
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
              </div>
            )}

            {/* Focused Residue Inspector */}
            {focusedResidue && (
              <div className="mt-auto space-y-2 rounded-lg border border-amber-400/30 bg-amber-500/[0.05] p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold text-amber-200">
                    {focusedResidue.resName3} {focusedResidue.seqId} ({focusedResidue.resCode1})
                  </span>
                  <span className="font-mono text-[0.6875rem] text-slate-300">
                    {focusedResidue.secondary} · {focusedResidue.region}
                  </span>
                </div>
                <div className="flex flex-wrap gap-3 font-mono text-[0.6875rem] text-slate-300">
                  <span>φ = {focusedResidue.phiDeg !== null ? `${focusedResidue.phiDeg.toFixed(1)}°` : 'terminal'}</span>
                  <span>ψ = {focusedResidue.psiDeg !== null ? `${focusedResidue.psiDeg.toFixed(1)}°` : 'terminal'}</span>
                  <span>Contacts: {focusedContacts.length}</span>
                </div>
                {bridge && (
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    <button
                      type="button"
                      onClick={() => bridge.focusIn3D(focusedResidue.seqId, { centerCamera: true, openViewer: 'activate' })}
                      className="inline-flex items-center gap-1 rounded-md border border-sky-400/40 bg-sky-500/15 px-2 py-1 text-[0.6875rem] font-medium text-sky-200 hover:bg-sky-500/25"
                    >
                      <Crosshair className="h-3 w-3" /> Focus in 3D
                    </button>
                    <button
                      type="button"
                      onClick={() => bridge.openTab('sequence')}
                      className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[0.6875rem] text-slate-200 hover:border-sky-400/40"
                    >
                      <GitCompareArrows className="h-3 w-3" /> Sequence Δd
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        bridge.sendMutationToPeptide(`${focusedResidue.resCode1}${focusedResidue.seqId}A`, focusedResidue.seqId)
                      }
                      className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[0.6875rem] text-slate-200 hover:border-emerald-400/40"
                    >
                      <Scissors className="h-3 w-3" /> Ala Scan in Peptide
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 3. Interactive Cα–Cα Contact Distance Matrix */}
          <div className="@container flex flex-col gap-2.5 rounded-xl border border-white/[0.08] bg-[#0b1018] p-3 @3xl:col-span-2 @6xl:col-span-4">
            <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[0.75rem]">
              <span className="font-semibold text-emerald-300">
                Cα–Cα CONTACT MAP (|i−j|≥{longRangeOnly ? 12 : 4}, ≤{contactCutoff.toFixed(1)} Å)
              </span>
              <span className="text-slate-300">
                {hoveredContact
                  ? `${hoveredContact[0]}–${hoveredContact[1]}: ${hoveredContact[2].toFixed(2)} Å`
                  : `${filteredContacts.length} pairs`}
              </span>
            </div>

            {/* Interactive Cutoffs */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-black/25 px-2.5 py-1.5 text-[0.6875rem]">
              <label className="flex items-center gap-2 font-mono text-slate-300">
                <span>Cutoff: {contactCutoff.toFixed(1)} Å</span>
                <input
                  type="range"
                  min={5.0}
                  max={8.0}
                  step={0.2}
                  value={contactCutoff}
                  onChange={(e) => setContactCutoff(Number(e.target.value))}
                  className="w-24 accent-emerald-400"
                />
              </label>
              <button
                type="button"
                onClick={() => setLongRangeOnly((v) => !v)}
                className={`rounded-md border px-2 py-0.5 font-mono transition ${
                  longRangeOnly
                    ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-200'
                    : 'border-white/10 bg-slate-900 text-slate-400 hover:text-slate-200'
                }`}
              >
                {longRangeOnly ? 'Long-Range |i−j|≥12' : 'All |i−j|≥4'}
              </button>
            </div>

            <div className="flex flex-col items-center gap-3 @lg:flex-row @lg:items-start">
              <canvas
                ref={contactCanvasRef}
                width={CONTACT_CANVAS_PX}
                height={CONTACT_CANVAS_PX}
                onMouseMove={(e) => handleContactPointer(e, false)}
                onClick={(e) => handleContactPointer(e, true)}
                onMouseLeave={() => setHoveredContact(null)}
                className="aspect-square w-full max-w-[280px] shrink-0 cursor-crosshair rounded-lg border border-white/10"
              />

              <div className="w-full min-w-0 flex-1 space-y-2 font-mono text-xs">
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <span className="text-[0.6875rem] text-slate-300">
                    {focusedSeqId !== null
                      ? `Neighbors of ${focusedResidue ? `${focusedResidue.resName3}${focusedSeqId}` : `Res ${focusedSeqId}`} (${focusedContacts.length})`
                      : 'Click plot or contact map to inspect tertiary neighbors.'}
                  </span>
                  {bridge && focusedContacts.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        const partnerIds = focusedContacts.map(([iSeq, jSeq]) =>
                          iSeq === focusedSeqId ? jSeq : iSeq,
                        );
                        bridge.highlightIn3D(
                          partnerIds,
                          `Cα Contacts of #${focusedSeqId}`,
                          { focusSeqId: focusedSeqId ?? undefined },
                        );
                      }}
                      className="rounded border border-emerald-400/40 bg-emerald-500/15 px-1.5 py-0.5 font-sans text-[0.6875rem] font-medium text-emerald-200 hover:bg-emerald-500/25"
                    >
                      Show in 3D
                    </button>
                  )}
                </div>

                <div className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto pr-0.5 @sm:grid-cols-2">
                  {focusedContacts.slice(0, 24).map(([iSeq, jSeq, dist], idx) => {
                    const partner = iSeq === focusedSeqId ? jSeq : iSeq;
                    const partnerRes = residueBySeqId.get(partner);
                    return (
                      <button
                        key={`${iSeq}-${jSeq}-${idx}`}
                        type="button"
                        onClick={() => selectResidueAndSync3D(partner, true)}
                        className="flex items-center justify-between gap-1.5 rounded-lg border border-white/[0.08] bg-black/30 px-2 py-1 text-left text-[0.6875rem] text-slate-200 hover:border-emerald-400/50 hover:text-emerald-200"
                      >
                        <span className="truncate">
                          {partnerRes ? `${partnerRes.resName3} ${partner}` : `Res ${partner}`}
                        </span>
                        <span className="shrink-0 text-emerald-300">{dist.toFixed(1)} Å</span>
                      </button>
                    );
                  })}
                  {focusedSeqId !== null && focusedContacts.length === 0 && (
                    <span className="col-span-full text-[0.6875rem] text-slate-500">
                      No non-local Cα contacts within {contactCutoff.toFixed(1)} Å.
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
