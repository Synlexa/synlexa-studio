import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import {
  Activity,
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Crosshair,
  Download,
  FileCode2,
  FileJson,
  GitCompareArrows,
  Layers,
} from 'lucide-react';
import type { CompareStructuresResult } from '@synlexa/wasm-bridge';
import { paeColorBytes } from '../lib/colorPalettes';
import {
  explainCoverage,
  explainPae,
  explainPlddt,
  explainRmsd,
  meanOf,
  meanPaeFromJson,
} from '../lib/metricInsights';
import { RUO_DISCLAIMER } from '../lib/reportGenerator';
import type { Studio3DBridge } from '../lib/studioBridge';
import { MetricInsightBadge } from './MetricInsightBadge';
import { Badge, Button, Card, EmptyState, Toggle } from './ui';
import { Project3DContextBanner, ToolGuideCard } from './WorkbenchShared';

interface ResultsViewProps {
  comparison: CompareStructuresResult | null;
  paeJson: string | null;
  busy: boolean;
  guided: boolean;
  selectedPaePair: [number, number] | null;
  onSelectPaePair: (i1: number, j1: number) => void;
  includePng: boolean;
  onToggleIncludePng: (v: boolean) => void;
  onExportHtml: () => void;
  onExportJson: () => void;
  onExportBundle: () => void;
  bridge?: Studio3DBridge;
}

export function ResultsView({
  comparison,
  paeJson,
  busy,
  guided,
  selectedPaePair,
  onSelectPaePair,
  includePng,
  onToggleIncludePng,
  onExportHtml,
  onExportJson,
  onExportBundle,
  bridge,
}: ResultsViewProps) {
  const [copied, setCopied] = useState<string | null>(null);
  const [showMatrix, setShowMatrix] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

  const meanPlddt = useMemo(
    () => (comparison ? meanOf(comparison.matchedResidues.map((r) => r.mobPlddt)) : null),
    [comparison],
  );
  const meanPae = useMemo(() => meanPaeFromJson(paeJson), [paeJson]);

  const topDeviations = useMemo(() => {
    if (!comparison) return [];
    return [...comparison.matchedResidues]
      .sort((a, b) => b.distanceAngstrom - a.distanceAngstrom)
      .slice(0, 8);
  }, [comparison]);

  if (!comparison) {
    return (
      <div className="@container flex h-full min-h-0 flex-col p-3 @xl:p-4">
        <Project3DContextBanner
          bridge={bridge}
          title="Comparison Results & Provenance"
          subtitle="Quantitative RMSD, coverage, PAE matrix, top deviation hotspots, and RUO exports."
          icon={<Layers className="h-4 w-4" />}
          guideOpen={guideOpen}
          onToggleGuide={() => setGuideOpen((v) => !v)}
        />
        <div className="flex-1">
          <EmptyState
            icon={<Layers className="h-8 w-8" />}
            title={busy ? 'Running comparison…' : 'No comparison yet'}
            description="Load a reference and a comparison structure (from a file, your library, or a public database) to see RMSD, coverage, confidence, and provenance here."
          />
        </div>
      </div>
    );
  }

  const m = comparison.metrics;
  const copy = (sha: string) => {
    void navigator.clipboard?.writeText(sha);
    setCopied(sha);
    setTimeout(() => setCopied(null), 1500);
  };

  const stats: Array<{ label: string; value: string; sub?: string; tone?: string }> = [
    { label: 'Cα RMSD', value: `${m.rmsdAngstrom.toFixed(3)} Å`, sub: 'after rigid superposition', tone: 'text-emerald-300' },
    { label: 'Matched Cα', value: String(m.matchedCaCount), sub: 'aligned residue pairs' },
    {
      label: 'Reference coverage',
      value: `${(m.refCoverage.ratio * 100).toFixed(1)}%`,
      sub: `${m.refCoverage.numerator} / ${m.refCoverage.denominator}`,
    },
    {
      label: 'Comparison coverage',
      value: `${(m.mobCoverage.ratio * 100).toFixed(1)}%`,
      sub: `${m.mobCoverage.numerator} / ${m.mobCoverage.denominator}`,
    },
  ];
  if (meanPlddt !== null) stats.push({ label: 'Mean pLDDT', value: meanPlddt.toFixed(1), sub: 'prediction confidence (0–100)' });
  if (meanPae !== null) stats.push({ label: 'Mean PAE', value: `${meanPae.toFixed(1)} Å`, sub: 'predicted aligned error' });

  return (
    <div className="@container h-full min-h-0 overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-4 p-3 @xl:px-5 @xl:py-5">
        <Project3DContextBanner
          bridge={bridge}
          title={`${comparison.reference.label} (${comparison.reference.chainId}) vs ${comparison.mobile.label} (${comparison.mobile.chainId})`}
          subtitle="Deterministic Kabsch rigid superposition metrics, PAE domain confidence, top deviation hotspots & RUO exports."
          icon={<Layers className="h-4 w-4" />}
          guideOpen={guideOpen}
          onToggleGuide={() => setGuideOpen((v) => !v)}
          actions={
            bridge && (
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => {
                    bridge.setColorMode3D('deviation');
                    bridge.openTab('viewer', false);
                  }}
                  className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[0.6875rem] text-slate-200 hover:border-sky-400/40"
                >
                  Color 3D by Δd
                </button>
                <button
                  type="button"
                  onClick={() => {
                    bridge.setColorMode3D('plddt');
                    bridge.openTab('viewer', false);
                  }}
                  className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[0.6875rem] text-slate-200 hover:border-emerald-400/40"
                >
                  Color 3D by pLDDT
                </button>
              </div>
            )
          }
        />

        <ToolGuideCard
          open={guideOpen}
          title="How to Read Comparison Results"
          summary="Results summarize deterministic Cα Kabsch superposition between your reference and comparison structures, paired with AlphaFold PAE uncertainty when available."
          steps={[
            'Check Cα RMSD and Coverage cards to see global fold similarity and whether termini/loops were excluded.',
            'Inspect Highest Deviation Residues below and click any residue to jump directly to it in 3D.',
            'Click any cell on the PAE heatmap to verify inter-residue domain confidence and focus residue i in 3D.',
          ]}
          connectionTip="Use 'Color 3D by Δd' or click any residue in the deviation table or PAE heatmap to synchronize the 3D Viewer, Sequence Track, and Ramachandran plot."
        />

        <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-3">
          {stats.map((s) => (
            <div key={s.label} className="min-w-0 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3.5">
              <div className="truncate text-xs text-slate-400">{s.label}</div>
              <div className={`mt-1 truncate text-xl font-semibold tabular-nums @2xl:text-2xl ${s.tone ?? 'text-slate-100'}`}>
                {s.value}
              </div>
              {s.sub && <div className="mt-0.5 truncate text-xs text-slate-500">{s.sub}</div>}
            </div>
          ))}
        </div>

        {(guided || true) && (
          <Card title="Plain-English Summary" description="Deterministic metric interpretations (RUO heuristics).">
            <div className="grid gap-2 @2xl:grid-cols-2">
              <MetricInsightBadge insight={explainRmsd(m.rmsdAngstrom)} />
              <MetricInsightBadge
                insight={explainCoverage(m.refCoverage.ratio, m.refCoverage.numerator, m.refCoverage.denominator)}
              />
              {meanPlddt !== null && <MetricInsightBadge insight={explainPlddt(meanPlddt)} />}
              {meanPae !== null && <MetricInsightBadge insight={explainPae(meanPae)} />}
            </div>
          </Card>
        )}

        {/* Highest Structural Deviation Hotspots */}
        {topDeviations.length > 0 && (
          <Card
            title="Highest Structural Deviations (Top Δd Residues)"
            description="Residues with the largest Cα-to-Cα offset after rigid superposition — click any chip to inspect in 3D."
            actions={
              bridge && (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      bridge.highlightIn3D(
                        topDeviations.map((r) => r.refSeqId),
                        'Top Δd Hotspots',
                        { focusSeqId: topDeviations[0]?.refSeqId },
                      )
                    }
                    className="inline-flex items-center gap-1 rounded-md border border-rose-400/40 bg-rose-500/15 px-2 py-1 text-xs font-medium text-rose-200 hover:bg-rose-500/25"
                  >
                    <Box className="h-3 w-3" /> Highlight Top {topDeviations.length} in 3D
                  </button>
                  <button
                    type="button"
                    onClick={() => bridge.openTab('sequence')}
                    className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-slate-200 hover:border-sky-400/40"
                  >
                    <GitCompareArrows className="h-3 w-3" /> Sequence Track
                  </button>
                  <button
                    type="button"
                    onClick={() => bridge.openTab('ramachandran')}
                    className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-slate-200 hover:border-cyan-400/40"
                  >
                    <Activity className="h-3 w-3" /> Ramachandran
                  </button>
                </div>
              )
            }
          >
            <div className="grid grid-cols-2 gap-2 @xl:grid-cols-4">
              {topDeviations.map((r) => (
                <button
                  key={`${r.refSeqId}-${r.mobSeqId}`}
                  type="button"
                  onClick={() => {
                    onSelectPaePair(r.mobSeqId, r.mobSeqId);
                    bridge?.focusIn3D(r.refSeqId, { centerCamera: true });
                  }}
                  className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.08] bg-black/25 px-2.5 py-2 text-left font-mono text-xs transition hover:border-amber-400/50"
                >
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-slate-100">
                      {r.resName3} {r.refSeqId}
                    </div>
                    <div className="truncate text-[0.6875rem] text-slate-500">
                      {r.mobPlddt != null ? `pLDDT ${r.mobPlddt.toFixed(0)}` : 'Exp/Model'}
                    </div>
                  </div>
                  <span className="shrink-0 font-semibold text-amber-300">
                    {r.distanceAngstrom.toFixed(2)} Å
                  </span>
                </button>
              ))}
            </div>
          </Card>
        )}

        <PaeCard
          paeJson={paeJson}
          selected={selectedPaePair}
          onSelect={(i, j) => {
            onSelectPaePair(i, j);
            bridge?.focusIn3D(i, { centerCamera: true });
          }}
          status={m.paeStatus}
          onFocusIn3D={bridge ? (seq) => bridge.focusIn3D(seq, { centerCamera: true, openViewer: 'activate' }) : undefined}
        />

        <Card title="Provenance" description="Exact inputs used for this result.">
          <div className="space-y-2">
            {[
              { tag: 'Reference', rec: comparison.reference, tone: 'text-sky-300' },
              { tag: 'Comparison', rec: comparison.mobile, tone: 'text-emerald-300' },
            ].map(({ tag, rec, tone }) => (
              <div key={tag} className="flex items-start gap-3 rounded-lg border border-white/[0.06] bg-black/20 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className={`font-medium ${tone}`}>{tag}</span>
                    <span className="text-slate-200">{rec.label}</span>
                    <Badge>{rec.confidenceKind}</Badge>
                    <Badge>{rec.license ?? 'license unknown'}</Badge>
                  </div>
                  <div className="mt-1 truncate font-mono text-xs text-slate-500">sha256 {rec.sha256}</div>
                </div>
                <button
                  type="button"
                  onClick={() => copy(rec.sha256)}
                  title="Copy SHA-256"
                  className="rounded-md p-1.5 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200"
                >
                  {copied === rec.sha256 ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
            ))}
            <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs text-slate-500">
              <span>Engine {comparison.engine.target} · {comparison.engine.floatPrecision}</span>
              <span>Result {comparison.resultId.slice(0, 16)}…</span>
              <span>{new Date(comparison.createdAtUtc).toLocaleString()}</span>
            </div>
            <button
              type="button"
              onClick={() => setShowMatrix((v) => !v)}
              className="flex items-center gap-1 pt-1 text-xs text-slate-400 hover:text-slate-200"
            >
              {showMatrix ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              4×4 transform ({comparison.transform.direction})
            </button>
            {showMatrix && (
              <div className="grid grid-cols-4 gap-1 rounded-lg bg-black/30 p-3 font-mono text-xs text-slate-300">
                {comparison.transform.matrixRowMajor4x4.map((v, i) => (
                  <div key={i} className="text-right tabular-nums">
                    {v.toFixed(4)}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card title="Export" description="Every export carries provenance and the research-use-only notice.">
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon={<Download className="h-4 w-4" />} onClick={onExportHtml}>
              HTML report
            </Button>
            <Button icon={<FileJson className="h-4 w-4" />} onClick={onExportJson}>
              JSON manifest
            </Button>
            <Button icon={<FileCode2 className="h-4 w-4" />} onClick={onExportBundle}>
              Project bundle
            </Button>
          </div>
          <label className="mt-4 flex items-center gap-3 text-sm text-slate-300">
            <Toggle checked={includePng} onChange={onToggleIncludePng} label="Embed 3D image" />
            Embed the current 3D view in the HTML report
          </label>
        </Card>

        <p className="text-xs text-slate-500">{RUO_DISCLAIMER}</p>
      </div>
    </div>
  );
}

function PaeCard({
  paeJson,
  selected,
  onSelect,
  status,
  onFocusIn3D,
}: {
  paeJson: string | null;
  selected: [number, number] | null;
  onSelect: (i: number, j: number) => void;
  status: string;
  onFocusIn3D?: (seqId: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const [hover, setHover] = useState<{ i: number; j: number; val: number } | null>(null);

  const matrix = useMemo<number[][] | null>(() => {
    if (!paeJson) return null;
    try {
      const parsed = JSON.parse(paeJson);
      const entry = Array.isArray(parsed) ? parsed[0] : parsed;
      const mat = entry?.predicted_aligned_error;
      return Array.isArray(mat) && Array.isArray(mat[0]) ? (mat as number[][]) : null;
    } catch {
      return null;
    }
  }, [paeJson]);

  useEffect(() => {
    if (!matrix) {
      baseRef.current = null;
      return;
    }
    const n = matrix.length;
    const off = document.createElement('canvas');
    off.width = n;
    off.height = n;
    const ctx = off.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(n, n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const [r, g, b] = paeColorBytes(Number(matrix[y][x] ?? 30));
        const idx = (y * n + x) * 4;
        img.data[idx] = r;
        img.data[idx + 1] = g;
        img.data[idx + 2] = b;
        img.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    baseRef.current = off;
  }, [matrix]);

  useEffect(() => {
    const c = canvasRef.current;
    const base = baseRef.current;
    if (!c || !base || !matrix) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const size = c.width;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(base, 0, 0, size, size);
    const scale = size / matrix.length;
    const cross = (i: number, j: number, color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo((j - 0.5) * scale, 0);
      ctx.lineTo((j - 0.5) * scale, size);
      ctx.moveTo(0, (i - 0.5) * scale);
      ctx.lineTo(size, (i - 0.5) * scale);
      ctx.stroke();
    };
    if (selected) cross(selected[0], selected[1], 'rgba(251,191,36,0.9)');
    if (hover) cross(hover.i, hover.j, 'rgba(125,211,252,0.75)');
  }, [matrix, hover, selected]);

  const handle = (e: MouseEvent<HTMLCanvasElement>, click: boolean) => {
    if (!matrix) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const n = matrix.length;
    const j = Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - rect.left) / rect.width) * n)));
    const i = Math.max(0, Math.min(n - 1, Math.floor(((e.clientY - rect.top) / rect.height) * n)));
    setHover({ i: i + 1, j: j + 1, val: Number(matrix[i][j] ?? 0) });
    if (click) onSelect(i + 1, j + 1);
  };

  return (
    <Card
      title="Predicted aligned error (PAE)"
      description={
        matrix
          ? `${matrix.length} × ${matrix.length} residues · click a cell to focus residue i in 3D`
          : `No PAE matrix loaded (${status}). AlphaFold DB imports include it automatically.`
      }
      actions={
        <div className="flex items-center gap-2">
          {hover ? (
            <span className="font-mono text-xs text-slate-300 tabular-nums">
              ({hover.i}, {hover.j}) = {hover.val.toFixed(1)} Å
            </span>
          ) : selected ? (
            <span className="font-mono text-xs text-amber-300">
              selected ({selected[0]}, {selected[1]})
            </span>
          ) : null}
          {selected && onFocusIn3D && (
            <button
              type="button"
              onClick={() => onFocusIn3D(selected[0])}
              className="inline-flex items-center gap-1 rounded-md border border-sky-400/40 bg-sky-500/15 px-2 py-0.5 text-xs text-sky-200 hover:bg-sky-500/25"
            >
              <Crosshair className="h-3 w-3" /> View in 3D
            </button>
          )}
        </div>
      }
    >
      {matrix ? (
        <div className="flex flex-col items-center gap-3 @lg:flex-row @lg:items-end">
          <canvas
            ref={canvasRef}
            width={520}
            height={520}
            onMouseMove={(e) => handle(e, false)}
            onClick={(e) => handle(e, true)}
            onMouseLeave={() => setHover(null)}
            className="aspect-square w-full max-w-[22rem] cursor-crosshair rounded-lg border border-white/[0.08]"
          />
          <div className="flex items-center gap-2 text-xs text-slate-400 @lg:flex-col @lg:items-start">
            <span>0 Å · confident</span>
            <span className="inline-block h-2 w-28 rounded-sm bg-gradient-to-r from-[#10d2a0] via-[#2d8c87] to-[#0f172a] @lg:h-28 @lg:w-2 @lg:bg-gradient-to-b" />
            <span>30 Å · uncertain</span>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
