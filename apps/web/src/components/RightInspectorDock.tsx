import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Copy,
  Cpu,
  Download,
  FileCode2,
  FileJson,
  PanelRightClose,
  PanelRightOpen,
  Send,
  ShieldAlert,
} from 'lucide-react';
import type {
  AnalyzeMoleculeSmilesResult,
  AnalyzePeptideResult,
  AnalyzeRamachandranResult,
  CompareStructuresResult,
} from '@synlexa/wasm-bridge';
import { paeColorBytes } from '../lib/colorPalettes';
import type { CopilotMessage } from '../lib/copilotEngine';
import type {
  AgentChatMessage,
  GeminiConfig,
  GeminiModelId,
} from '../lib/geminiAgent';
import {
  explainCoverage,
  explainPae,
  explainPlddt,
  explainRmsd,
  meanOf,
  meanPaeFromJson,
} from '../lib/metricInsights';
import type { UiMode } from '../lib/workbenchReducers';
import { GeminiAgentPanel } from './GeminiAgentPanel';
import { MetricInsightBadge } from './MetricInsightBadge';

interface RightInspectorDockProps {
  comparison: CompareStructuresResult | null;
  paeJson: string | null;
  selectedPaePair: [number, number] | null;
  onSelectPaePair: (i1: number, j1: number) => void;
  copilotMessages: CopilotMessage[];
  onSubmitCopilot: (input: string) => void;
  includePngInReport: boolean;
  onToggleIncludePng: (val: boolean) => void;
  onExportHtmlReport: () => void;
  onExportJsonManifest: () => void;
  onExportBundle: () => void;
  uiMode?: UiMode;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  smilesResult?: AnalyzeMoleculeSmilesResult | null;
  peptideResult?: AnalyzePeptideResult | null;
  ramachandranResult?: AnalyzeRamachandranResult | null;
  agentMessages?: AgentChatMessage[];
  agentBusy?: boolean;
  geminiConfig?: GeminiConfig;
  onUpdateGeminiConfig?: (update: { apiKey?: string; model?: GeminiModelId }) => void;
  onSendAgentPrompt?: (prompt: string) => void;
}

export function RightInspectorDock({
  comparison,
  paeJson,
  selectedPaePair,
  onSelectPaePair,
  copilotMessages,
  onSubmitCopilot,
  includePngInReport,
  onToggleIncludePng,
  onExportHtmlReport,
  onExportJsonManifest,
  onExportBundle,
  uiMode = 'pro',
  collapsed = false,
  onToggleCollapse,
  agentMessages,
  agentBusy = false,
  geminiConfig,
  onUpdateGeminiConfig,
  onSendAgentPrompt,
}: RightInspectorDockProps) {
  const [showMatrix, setShowMatrix] = useState(false);
  const [showProDetailsInSimple, setShowProDetailsInSimple] = useState(false);
  const [copilotInput, setCopilotInput] = useState('');
  const [copiedSha, setCopiedSha] = useState<string | null>(null);
  const [paeHover, setPaeHover] = useState<{ i: number; j: number; val: number } | null>(null);

  const paeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const paeBaseCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const parsedPae = useMemo<number[][] | null>(() => {
    if (!paeJson) return null;
    try {
      const parsed = JSON.parse(paeJson);
      const entry = Array.isArray(parsed) ? parsed[0] : parsed;
      const mat = entry?.predicted_aligned_error;
      if (!Array.isArray(mat) || mat.length === 0 || !Array.isArray(mat[0])) {
        return null;
      }
      return mat as number[][];
    } catch {
      return null;
    }
  }, [paeJson]);

  const meanPlddt = useMemo(() => {
    if (!comparison) return null;
    return meanOf(comparison.matchedResidues.map((r) => r.mobPlddt));
  }, [comparison]);

  const meanPae = useMemo(() => meanPaeFromJson(paeJson), [paeJson]);

  // Render PAE base heatmap into cached offscreen canvas
  useEffect(() => {
    if (!parsedPae) {
      paeBaseCanvasRef.current = null;
      return;
    }
    const n = parsedPae.length;
    const off = document.createElement('canvas');
    off.width = n;
    off.height = n;
    const octx = off.getContext('2d');
    if (!octx) return;

    const img = octx.createImageData(n, n);
    for (let y = 0; y < n; y++) {
      const row = parsedPae[y];
      for (let x = 0; x < n; x++) {
        const val = Number(row[x] ?? 30);
        const [r, g, b] = paeColorBytes(val);
        const idx = (y * n + x) * 4;
        img.data[idx] = r;
        img.data[idx + 1] = g;
        img.data[idx + 2] = b;
        img.data[idx + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    paeBaseCanvasRef.current = off;
  }, [parsedPae]);

  // Blit base PAE canvas + hover/selection crosshairs
  useEffect(() => {
    const canvas = paeCanvasRef.current;
    const base = paeBaseCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const size = 260;
    ctx.clearRect(0, 0, size, size);

    if (!base || !parsedPae) {
      ctx.fillStyle = '#070a10';
      ctx.fillRect(0, 0, size, size);
      return;
    }

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(base, 0, 0, size, size);

    const n = parsedPae.length;
    const scale = size / n;

    if (selectedPaePair) {
      const sx = (selectedPaePair[1] - 0.5) * scale;
      const sy = (selectedPaePair[0] - 0.5) * scale;
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.85)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, size);
      ctx.moveTo(0, sy);
      ctx.lineTo(size, sy);
      ctx.stroke();
    }

    if (paeHover) {
      const hx = (paeHover.j - 0.5) * scale;
      const hy = (paeHover.i - 0.5) * scale;
      ctx.strokeStyle = 'rgba(103, 232, 249, 0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hx, 0);
      ctx.lineTo(hx, size);
      ctx.moveTo(0, hy);
      ctx.lineTo(size, hy);
      ctx.stroke();
    }
  }, [parsedPae, paeHover, selectedPaePair, uiMode, showProDetailsInSimple, collapsed]);

  const handlePaePointer = (e: MouseEvent<HTMLCanvasElement>, click: boolean) => {
    if (!parsedPae) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const n = parsedPae.length;
    const j0 = Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - rect.left) / rect.width) * n)));
    const i0 = Math.max(0, Math.min(n - 1, Math.floor(((e.clientY - rect.top) / rect.height) * n)));
    const val = Number(parsedPae[i0]?.[j0] ?? 0);
    setPaeHover({ i: i0 + 1, j: j0 + 1, val });
    if (click) {
      onSelectPaePair(i0 + 1, j0 + 1);
    }
  };

  const copyHash = (sha: string) => {
    navigator.clipboard?.writeText(sha);
    setCopiedSha(sha);
    setTimeout(() => setCopiedSha(null), 1500);
  };

  const sendCopilot = () => {
    const cmd = copilotInput.trim();
    if (!cmd) return;
    onSubmitCopilot(cmd);
    setCopilotInput('');
  };

  if (collapsed) {
    return (
      <aside className="flex h-full w-10 shrink-0 flex-col items-center gap-3 border-l border-slate-800/90 bg-[#0b1019] py-2.5">
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            title="Expand Inspector & Gemini Agent"
            className="rounded border border-slate-700 bg-slate-900 p-1.5 text-slate-300 hover:border-cyan-500/50 hover:text-cyan-200"
          >
            <PanelRightOpen className="h-4 w-4" />
          </button>
        )}
        <Cpu className="h-4 w-4 text-cyan-400" />
        <span className="mt-2 [writing-mode:vertical-rl] font-mono text-[0.6875rem] tracking-widest text-slate-500 uppercase">
          INSPECTOR · GEMINI
        </span>
      </aside>
    );
  }

  const showDetailedPanels = uiMode === 'pro' || showProDetailsInSimple;

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l border-slate-800/90 bg-[#0b1019] text-xs xl:w-[340px]">
      {/* Side Panel RUO Notice + Collapse */}
      <div className="flex items-center justify-between gap-1.5 border-b border-slate-800/80 bg-amber-500/8 px-3 py-1.5 font-mono text-[0.75rem] text-amber-300">
        <span className="flex min-w-0 items-center gap-1.5">
          <ShieldAlert className="h-3 w-3 shrink-0" />
          <span className="truncate">RUO: Computational metrics · Not clinical</span>
        </span>
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            title="Collapse right inspector"
            className="rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          >
            <PanelRightClose className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {/* Simple Mode Plain-English Quality Summary */}
        {uiMode === 'simple' && comparison && (
          <section className="space-y-2 rounded-lg border border-slate-800/90 bg-slate-900/40 p-2.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[0.75rem] font-semibold text-cyan-300">
                PLAIN-ENGLISH QUALITY SUMMARY
              </span>
              <button
                type="button"
                onClick={() => setShowProDetailsInSimple((v) => !v)}
                className="font-mono text-[0.6875rem] text-slate-400 hover:text-cyan-200"
              >
                {showProDetailsInSimple ? 'Hide raw details' : 'Show PAE & SHA-256'}
              </button>
            </div>

            <MetricInsightBadge insight={explainRmsd(comparison.metrics.rmsdAngstrom)} />
            <MetricInsightBadge
              insight={explainCoverage(
                comparison.metrics.refCoverage.ratio,
                comparison.metrics.refCoverage.numerator,
                comparison.metrics.refCoverage.denominator,
              )}
            />
            {meanPlddt !== null && <MetricInsightBadge insight={explainPlddt(meanPlddt)} />}
            {meanPae !== null && <MetricInsightBadge insight={explainPae(meanPae)} />}
          </section>
        )}

        {/* Metrics & SHA-256 Provenance Card (Pro mode or expanded in Simple mode) */}
        {showDetailedPanels && (
          <section className="rounded border border-slate-800 bg-slate-900/45 p-2.5">
            <div className="mb-2 flex items-center justify-between font-mono text-[0.75rem]">
              <span className="font-semibold text-cyan-300">METRICS &amp; PROVENANCE</span>
              {comparison && (
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[0.6875rem] text-slate-300">
                  {comparison.engine.target} · {comparison.engine.floatPrecision}
                </span>
              )}
            </div>

            {!comparison ? (
              <div className="text-[0.8125rem] text-slate-500">
                Awaiting Wasm structural comparison…
              </div>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-1.5 font-mono text-[0.75rem]">
                  <div className="rounded border border-slate-800 bg-slate-950/70 p-1.5">
                    <div className="flex items-center justify-between text-[0.6875rem] text-slate-500">
                      <span>Cα RMSD</span>
                    </div>
                    <div className="text-sm font-bold text-emerald-300">
                      {comparison.metrics.rmsdAngstrom.toFixed(4)} Å
                    </div>
                    <div className="mt-1">
                      <MetricInsightBadge
                        insight={explainRmsd(comparison.metrics.rmsdAngstrom)}
                        compact
                      />
                    </div>
                  </div>
                  <div className="rounded border border-slate-800 bg-slate-950/70 p-1.5">
                    <div className="text-[0.6875rem] text-slate-500">Matched Cα</div>
                    <div className="text-sm font-bold text-slate-100">
                      {comparison.metrics.matchedCaCount}
                    </div>
                    {meanPlddt !== null && (
                      <div className="mt-1">
                        <MetricInsightBadge insight={explainPlddt(meanPlddt)} compact />
                      </div>
                    )}
                  </div>
                  <div className="rounded border border-slate-800 bg-slate-950/70 p-1.5">
                    <div className="text-[0.6875rem] text-slate-500">Ref Coverage</div>
                    <div className="font-semibold text-sky-300">
                      {comparison.metrics.refCoverage.numerator}/
                      {comparison.metrics.refCoverage.denominator} (
                      {(comparison.metrics.refCoverage.ratio * 100).toFixed(1)}%)
                    </div>
                    <div className="truncate text-[0.625rem] text-slate-500">
                      {comparison.metrics.refCoverage.denominatorKind}
                    </div>
                  </div>
                  <div className="rounded border border-slate-800 bg-slate-950/70 p-1.5">
                    <div className="text-[0.6875rem] text-slate-500">Mob Coverage</div>
                    <div className="font-semibold text-emerald-300">
                      {comparison.metrics.mobCoverage.numerator}/
                      {comparison.metrics.mobCoverage.denominator} (
                      {(comparison.metrics.mobCoverage.ratio * 100).toFixed(1)}%)
                    </div>
                    <div className="truncate text-[0.625rem] text-slate-500">
                      {comparison.metrics.mobCoverage.denominatorKind}
                    </div>
                  </div>
                </div>

                {/* SHA-256 & Licenses */}
                <div className="space-y-1 font-mono text-[0.6875rem] text-slate-400">
                  {[
                    { tag: 'REF', rec: comparison.reference, cls: 'text-sky-300' },
                    { tag: 'MOB', rec: comparison.mobile, cls: 'text-emerald-300' },
                  ].map(({ tag, rec, cls }) => (
                    <div
                      key={tag}
                      className="flex items-center justify-between rounded bg-slate-950/70 px-1.5 py-1"
                    >
                      <div className="min-w-0">
                        <span className={`font-semibold ${cls}`}>{tag}</span>{' '}
                        <span className="text-slate-300">{rec.label}</span>{' '}
                        <span className="text-slate-500">
                          ({rec.license ?? 'local'} · {rec.confidenceKind})
                        </span>
                        <div className="truncate text-slate-500">sha256:{rec.sha256}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyHash(rec.sha256)}
                        title="Copy full SHA-256"
                        className="ml-1 shrink-0 rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-cyan-300"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  {copiedSha && (
                    <div className="text-right text-[0.6875rem] text-emerald-400">Copied SHA-256!</div>
                  )}
                </div>

                {/* Collapsible 4x4 Matrix */}
                <div>
                  <button
                    type="button"
                    onClick={() => setShowMatrix((v) => !v)}
                    className="flex items-center gap-1 font-mono text-[0.75rem] text-slate-400 hover:text-slate-200"
                  >
                    {showMatrix ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                    <span>4×4 Transform ({comparison.transform.direction})</span>
                  </button>
                  {showMatrix && (
                    <div className="mt-1 grid grid-cols-4 gap-1 rounded border border-slate-800 bg-slate-950 p-1.5 font-mono text-[0.6875rem] text-slate-300">
                      {comparison.transform.matrixRowMajor4x4.map((v, i) => (
                        <div key={i} className="text-right">
                          {v.toFixed(4)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {/* Interactive 260x260 PAE Heatmap */}
        {showDetailedPanels && (
          <section className="rounded border border-slate-800 bg-slate-900/45 p-2.5">
            <div className="mb-1.5 flex items-center justify-between font-mono text-[0.75rem]">
              <span className="font-semibold text-emerald-300">
                PAE MATRIX ({parsedPae ? `${parsedPae.length}×${parsedPae.length}` : 'n/a'})
              </span>
              <span className="text-slate-400">
                {paeHover
                  ? `(${paeHover.i}, ${paeHover.j}) = ${paeHover.val.toFixed(1)} Å`
                  : selectedPaePair
                    ? `Sel (${selectedPaePair[0]}, ${selectedPaePair[1]})`
                    : comparison?.metrics.paeStatus ?? 'missing'}
              </span>
            </div>

            <div className="flex justify-center">
              <canvas
                ref={paeCanvasRef}
                width={260}
                height={260}
                onMouseMove={(e) => handlePaePointer(e, false)}
                onClick={(e) => handlePaePointer(e, true)}
                onMouseLeave={() => setPaeHover(null)}
                className="h-[220px] w-[220px] cursor-crosshair rounded border border-slate-800"
              />
            </div>
            <div className="mt-1 flex items-center justify-between font-mono text-[0.6875rem] text-slate-500">
              <span>0 Å (Confident)</span>
              <span className="inline-block h-1.5 w-24 rounded-xs bg-gradient-to-r from-[#10d2a0] via-[#2d8c87] to-[#0f172a]" />
              <span>30 Å</span>
            </div>
          </section>
        )}

        {/* Gemini AI Agent (with deterministic local Copilot fallback) */}
        {agentMessages && geminiConfig && onUpdateGeminiConfig && onSendAgentPrompt ? (
          <GeminiAgentPanel
            messages={agentMessages}
            busy={agentBusy}
            config={geminiConfig}
            onUpdateConfig={onUpdateGeminiConfig}
            onSendPrompt={onSendAgentPrompt}
            simpleMode={uiMode === 'simple'}
          />
        ) : (
          <section className="flex flex-col rounded border border-slate-800 bg-slate-900/45 p-2.5">
            <div className="mb-1.5 flex items-center justify-between font-mono text-[0.75rem]">
              <span className="flex items-center gap-1 font-semibold text-cyan-300">
                <Bot className="h-3.5 w-3.5" /> STUDIO COPILOT (DETERMINISTIC)
              </span>
            </div>

            <div className="mb-2 flex flex-wrap gap-1">
              {[
                ['explain_result', 'explain'],
                ['focus_residues 94, 96, 119', 'Zn²⁺ His'],
                ['list_artifacts', 'artifacts'],
                ['mutate H94A', 'H94A'],
              ].map(([cmd, label]) => (
                <button
                  key={cmd}
                  type="button"
                  onClick={() => onSubmitCopilot(cmd)}
                  className="rounded border border-slate-700/80 bg-slate-950 px-1.5 py-0.5 font-mono text-[0.6875rem] text-slate-300 hover:border-cyan-500/50 hover:text-cyan-200"
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="mb-2 max-h-44 space-y-1.5 overflow-y-auto rounded border border-slate-800/80 bg-[#070a10] p-2 font-mono text-[0.75rem]">
              {copilotMessages.map((m) => (
                <div
                  key={m.id}
                  className={`rounded p-1.5 ${
                    m.role === 'user'
                      ? 'bg-cyan-500/10 text-cyan-200'
                      : 'bg-slate-900/80 text-slate-200'
                  }`}
                >
                  <div className="whitespace-pre-wrap break-words leading-relaxed">{m.text}</div>
                  {m.citations && m.citations.length > 0 && (
                    <div className="mt-1 truncate text-[0.625rem] text-slate-500">
                      Verified refs: {m.citations.join(' · ')}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="flex items-center gap-1">
              <input
                value={copilotInput}
                onChange={(e) => setCopilotInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') sendCopilot();
                }}
                placeholder="Run command (e.g. focus_residues 94)…"
                className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[0.75rem] text-slate-100 placeholder-slate-500 outline-none focus:border-cyan-500"
              />
              <button
                type="button"
                onClick={sendCopilot}
                className="rounded border border-cyan-500/40 bg-cyan-500/15 p-1.5 text-cyan-200 hover:bg-cyan-500/25"
              >
                <Send className="h-3 w-3" />
              </button>
            </div>
          </section>
        )}

        {/* Exports & Persistence */}
        <section className="rounded-lg border border-slate-800 bg-slate-900/45 p-2.5">
          <div className="mb-2 font-mono text-[0.75rem] font-semibold text-slate-300">
            EXPORTS &amp; PROJECT BUNDLE (RUO)
          </div>
          <label className="mb-2 flex items-center gap-1.5 text-[0.75rem] text-slate-400">
            <input
              type="checkbox"
              checked={includePngInReport}
              onChange={(e) => onToggleIncludePng(e.target.checked)}
              className="accent-cyan-500"
            />
            <span>Embed 3D viewport PNG in HTML report</span>
          </label>
          <div className="grid grid-cols-1 gap-1.5">
            <button
              type="button"
              disabled={!comparison}
              onClick={onExportHtmlReport}
              className="flex items-center justify-center gap-1.5 rounded border border-cyan-500/40 bg-cyan-500/15 py-1.5 font-mono text-[0.75rem] text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-40"
            >
              <Download className="h-3 w-3" /> Export RUO HTML Report
            </button>
            <button
              type="button"
              disabled={!comparison}
              onClick={onExportJsonManifest}
              className="flex items-center justify-center gap-1.5 rounded border border-slate-700 bg-slate-900 py-1.5 font-mono text-[0.75rem] text-slate-200 hover:border-slate-500 disabled:opacity-40"
            >
              <FileJson className="h-3 w-3" /> Export JSON Manifest
            </button>
            <button
              type="button"
              onClick={onExportBundle}
              className="flex items-center justify-center gap-1.5 rounded border border-emerald-500/40 bg-emerald-500/10 py-1.5 font-mono text-[0.75rem] text-emerald-200 hover:bg-emerald-500/20"
            >
              <FileCode2 className="h-3 w-3" /> Save .synlexa.bundle.json
            </button>
          </div>
        </section>
      </div>
    </aside>
  );
}
