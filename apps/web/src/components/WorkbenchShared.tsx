import { useState, type ReactNode } from 'react';
import {
  Box,
  ChevronDown,
  ChevronRight,
  Columns2,
  Crosshair,
  Database,
  FlaskConical,
  FolderOpen,
  HelpCircle,
  X,
} from 'lucide-react';
import type { Studio3DBridge } from '../lib/studioBridge';
import { cx } from './ui';

interface Project3DContextBannerProps {
  bridge?: Studio3DBridge;
  title: string;
  subtitle?: string;
  icon: ReactNode;
  guideOpen: boolean;
  onToggleGuide: () => void;
  actions?: ReactNode;
}

export function Project3DContextBanner({
  bridge,
  title,
  subtitle,
  icon,
  guideOpen,
  onToggleGuide,
  actions,
}: Project3DContextBannerProps) {
  const has3D = Boolean(bridge && (bridge.hasRef || bridge.hasMob));

  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#0c111b] px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-sky-400/25 bg-sky-500/10 text-sky-300">
            {icon}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
              {bridge?.activeProjectName && (
                <span className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[0.6875rem] text-slate-300">
                  <FolderOpen className="h-3 w-3 text-sky-300" />
                  <span className="max-w-44 truncate">{bridge.activeProjectName}</span>
                </span>
              )}
            </div>
            {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {actions}
          <button
            type="button"
            onClick={onToggleGuide}
            aria-expanded={guideOpen}
            className={cx(
              'inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium transition-colors',
              guideOpen
                ? 'border-sky-400/50 bg-sky-500/15 text-sky-200'
                : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/20 hover:text-white',
            )}
          >
            <HelpCircle className="h-3.5 w-3.5 text-sky-300" />
            <span>Guide</span>
          </button>
        </div>
      </div>

      {bridge && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-white/[0.06] pt-2 text-[0.6875rem]">
          {has3D ? (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.07] bg-black/25 px-2 py-0.5 text-slate-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span className="text-slate-500">3D:</span>
                {bridge.hasRef && (
                  <span className="font-mono text-sky-300">
                    {bridge.refLabel} ({bridge.refChain || '?'})
                  </span>
                )}
                {bridge.hasRef && bridge.hasMob && <span className="text-slate-600">vs</span>}
                {bridge.hasMob && (
                  <span className="font-mono text-emerald-300">
                    {bridge.mobLabel} ({bridge.mobChain || '?'})
                  </span>
                )}
              </span>

              {bridge.focusedSeqId !== null && (
                <button
                  type="button"
                  onClick={() =>
                    bridge.focusIn3D(bridge.focusedSeqId!, {
                      centerCamera: true,
                      openViewer: 'none',
                    })
                  }
                  title="Center 3D camera on this residue"
                  className="inline-flex items-center gap-1 rounded-md border border-amber-400/35 bg-amber-500/10 px-2 py-0.5 font-mono text-amber-200 hover:bg-amber-500/20"
                >
                  <Crosshair className="h-3 w-3" />
                  <span>Focus #{bridge.focusedSeqId}</span>
                </button>
              )}

              {bridge.activeHighlight && bridge.activeHighlight.seqIds.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md border border-pink-400/35 bg-pink-500/10 px-2 py-0.5 text-pink-200">
                  <span>
                    3D Highlight: {bridge.activeHighlight.seqIds.length} res ({bridge.activeHighlight.source})
                  </span>
                  <button
                    type="button"
                    onClick={bridge.clearHighlights3D}
                    title="Clear 3D highlights"
                    className="rounded p-0.5 hover:bg-white/10"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              )}

              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => bridge.openTab('viewer', false)}
                  className="inline-flex items-center gap-1 rounded-md border border-sky-400/30 bg-sky-500/10 px-2 py-0.5 font-medium text-sky-200 hover:bg-sky-500/20"
                  title="Switch to 3D Viewer tab"
                >
                  <Box className="h-3 w-3" />
                  <span>Open 3D</span>
                </button>
                <button
                  type="button"
                  onClick={() => bridge.openTab('viewer', true)}
                  className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-slate-300 hover:border-sky-400/40 hover:text-sky-200"
                  title="Open 3D Viewer side-by-side next to this tool"
                >
                  <Columns2 className="h-3 w-3" />
                  <span>Split 3D</span>
                </button>
              </div>
            </>
          ) : (
            <div className="flex w-full flex-wrap items-center justify-between gap-2 text-slate-400">
              <span>No 3D protein structure loaded yet — load one to enable 3D pocket &amp; residue synchronization.</span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={bridge.loadExample}
                  className="inline-flex items-center gap-1 rounded-md border border-sky-400/40 bg-sky-500/15 px-2 py-0.5 font-medium text-sky-200 hover:bg-sky-500/25"
                >
                  <FlaskConical className="h-3 w-3" /> Load CA II Example
                </button>
                <button
                  type="button"
                  onClick={bridge.openDatabases}
                  className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-slate-200 hover:bg-white/[0.08]"
                >
                  <Database className="h-3 w-3" /> Public Databases
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ToolGuideCard({
  open,
  title,
  summary,
  steps,
  connectionTip,
  glossary,
}: {
  open: boolean;
  title: string;
  summary: string;
  steps: string[];
  connectionTip: string;
  glossary?: Array<{ term: string; desc: string }>;
}) {
  const [showGlossary, setShowGlossary] = useState(false);
  if (!open) return null;

  return (
    <div className="rounded-xl border border-sky-400/25 bg-sky-500/[0.05] p-3 text-xs">
      <div className="font-semibold text-sky-200">{title}</div>
      <p className="mt-1 leading-relaxed text-slate-300">{summary}</p>
      <div className="mt-2.5 grid gap-2 @2xl:grid-cols-2">
        <div className="rounded-lg border border-white/[0.06] bg-black/25 p-2.5">
          <div className="text-[0.6875rem] font-semibold tracking-wide text-slate-400 uppercase">What to do</div>
          <ol className="mt-1.5 list-inside list-decimal space-y-1 text-slate-300">
            {steps.map((s, idx) => (
              <li key={idx} className="leading-relaxed">
                {s}
              </li>
            ))}
          </ol>
        </div>
        <div className="rounded-lg border border-white/[0.06] bg-black/25 p-2.5">
          <div className="text-[0.6875rem] font-semibold tracking-wide text-emerald-300 uppercase">
            3D Project Connection
          </div>
          <p className="mt-1.5 leading-relaxed text-slate-300">{connectionTip}</p>
        </div>
      </div>

      {glossary && glossary.length > 0 && (
        <div className="mt-2 border-t border-white/[0.06] pt-2">
          <button
            type="button"
            onClick={() => setShowGlossary((v) => !v)}
            className="inline-flex items-center gap-1 text-[0.6875rem] font-medium text-sky-300 hover:text-sky-200"
          >
            {showGlossary ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Metric &amp; Parameter Definitions ({glossary.length})
          </button>
          {showGlossary && (
            <div className="mt-2 grid gap-1.5 @xl:grid-cols-2">
              {glossary.map((g) => (
                <div key={g.term} className="rounded-lg border border-white/[0.06] bg-black/25 px-2.5 py-1.5">
                  <div className="font-mono text-[0.6875rem] font-semibold text-slate-200">{g.term}</div>
                  <div className="mt-0.5 text-[0.6875rem] leading-relaxed text-slate-400">{g.desc}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function MetricInfoCell({
  label,
  value,
  hint,
  tooltip,
  accent = 'text-slate-100',
}: {
  label: string;
  value: string;
  hint?: string;
  tooltip?: string;
  accent?: string;
}) {
  return (
    <div
      title={tooltip ?? (hint ? `${label}: ${hint}` : label)}
      className="min-w-0 rounded-lg border border-white/[0.07] bg-black/25 px-2.5 py-2"
    >
      <div className="truncate text-[0.6875rem] text-slate-400">{label}</div>
      <div className={cx('mt-0.5 truncate font-mono text-sm font-semibold tabular-nums', accent)}>{value}</div>
      {hint && <div className="mt-0.5 truncate text-[0.625rem] text-slate-500">{hint}</div>}
    </div>
  );
}
