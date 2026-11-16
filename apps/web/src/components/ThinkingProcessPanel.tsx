import { useEffect, useMemo, useState } from 'react';
import {
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  ShieldAlert,
  Sparkles,
  Wrench,
  XCircle,
} from 'lucide-react';
import type { AgentStepTrace, ExecutedToolRecord } from '../lib/geminiAgent';
import { MarkdownContent, stripMarkdownForPreview } from './MarkdownContent';
import { cx } from './ui';

export interface ThinkingProcessPanelProps {
  thinkingTrace?: string[];
  stepTrace?: AgentStepTrace[];
  executedTools?: ExecutedToolRecord[];
  defaultOpen?: boolean;
  running?: boolean;
  durationMs?: number;
  compact?: boolean;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function ToolArgsDisplay({ args }: { args: Record<string, unknown> }) {
  const [showRaw, setShowRaw] = useState(false);
  const entries = Object.entries(args);
  if (entries.length === 0) return null;

  const isSimpleScalar = (v: unknown) =>
    typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null;

  const allSimple = entries.length <= 4 && entries.every(([, v]) => isSimpleScalar(v));

  if (!allSimple || showRaw) {
    return (
      <div className="mt-1.5">
        {allSimple && (
          <button
            type="button"
            onClick={() => setShowRaw(false)}
            className="mb-1 text-[0.625rem] font-medium text-slate-400 hover:text-slate-200"
          >
            Compact view
          </button>
        )}
        <pre className="overflow-x-auto rounded-lg border border-white/[0.06] bg-black/40 px-2.5 py-1.5 font-mono text-[0.6875rem] leading-snug text-slate-400">
          {JSON.stringify(args, null, 2)}
        </pre>
      </div>
    );
  }

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {entries.map(([k, v]) => {
        const rendered = typeof v === 'string' ? v : JSON.stringify(v);
        const clipped = rendered.length > 56 ? `${rendered.slice(0, 53)}…` : rendered;
        return (
          <span
            key={k}
            className="inline-flex max-w-full items-center gap-1 rounded-md border border-white/[0.07] bg-white/[0.03] px-1.5 py-0.5 font-mono text-[0.6875rem]"
            title={`${k}: ${rendered}`}
          >
            <span className="text-slate-500">{k}:</span>
            <span className="truncate text-sky-200/90">{clipped}</span>
          </span>
        );
      })}
      <button
        type="button"
        onClick={() => setShowRaw(true)}
        className="text-[0.625rem] text-slate-500 hover:text-slate-300"
      >
        JSON
      </button>
    </div>
  );
}

export function ThinkingProcessPanel({
  thinkingTrace,
  stepTrace,
  executedTools,
  defaultOpen = false,
  running = false,
  durationMs,
  compact = false,
}: ThinkingProcessPanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [liveElapsedMs, setLiveElapsedMs] = useState(0);

  useEffect(() => {
    if (!running) {
      setLiveElapsedMs(0);
      return;
    }
    const start = Date.now();
    const timer = window.setInterval(() => {
      setLiveElapsedMs(Date.now() - start);
    }, 120);
    return () => window.clearInterval(timer);
  }, [running]);

  const steps = useMemo<AgentStepTrace[]>(() => {
    if (stepTrace && stepTrace.length > 0) {
      return stepTrace;
    }
    return [
      ...(thinkingTrace ?? []).map((t, idx) => ({
        round: idx + 1,
        phase: 'thinking' as const,
        title: `Model reasoning (round ${idx + 1})`,
        detail: t,
        status: 'done' as const,
      })),
      ...(executedTools ?? []).map((t, idx) => ({
        round: idx + 1,
        phase: t.ok ? ('tool' as const) : ('error' as const),
        title: `${String(t.name)} · ${t.ok ? 'ok' : 'failed'}`,
        detail: t.summary,
        toolName: String(t.name),
        args: t.args,
        durationMs: t.durationMs,
        ok: t.ok,
        status: t.ok ? ('done' as const) : ('error' as const),
      })),
    ];
  }, [stepTrace, thinkingTrace, executedTools]);

  if (steps.length === 0 && !running) return null;

  const thoughtSteps = steps.filter((s) => s.phase === 'thinking' && Boolean(s.detail) && s.status !== 'running');
  const toolSteps = steps.filter((s) => s.phase === 'tool' || s.phase === 'error');
  const toolCount = executedTools?.length ?? toolSteps.length;
  const thoughtCount = Math.max(thinkingTrace?.length ?? 0, thoughtSteps.length);

  const activeStep = [...steps].reverse().find((s) => s.status === 'running');
  const activeStatusText = activeStep
    ? activeStep.phase === 'tool'
      ? `Running ${activeStep.toolName ?? 'tool'}…`
      : activeStep.phase === 'permission'
        ? 'Waiting for permission…'
        : 'Reasoning…'
    : 'Reasoning…';

  const totalDurationMs =
    running
      ? liveElapsedMs
      : durationMs ??
        steps.reduce((acc, s) => acc + (typeof s.durationMs === 'number' && s.durationMs > 0 ? s.durationMs : 0), 0);

  const formattedTotal = formatDuration(totalDurationMs);

  const previewThought = thoughtSteps.find((s) => Boolean(s.detail?.trim()))?.detail ?? thinkingTrace?.[0];
  const previewText = previewThought ? stripMarkdownForPreview(previewThought) : '';

  const toolPills = (executedTools && executedTools.length > 0
    ? executedTools.map((t) => ({ name: String(t.name), ok: t.ok }))
    : toolSteps.map((s) => ({ name: s.toolName ?? s.title.split(' · ')[0], ok: s.ok !== false }))
  ).slice(0, 3);
  const extraToolsCount = Math.max(0, toolCount - toolPills.length);

  const headerTitle = running
    ? 'Live thinking & tool trace'
    : toolCount > 0
      ? 'Thinking & tool process'
      : 'Thought process';

  return (
    <div
      className={cx(
        'overflow-hidden rounded-xl border text-xs transition-colors',
        running
          ? 'border-sky-500/30 bg-gradient-to-b from-sky-500/[0.07] to-black/30'
          : 'border-white/[0.08] bg-black/25',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full flex-col gap-1 px-3 py-2 text-left transition-colors hover:bg-white/[0.03]"
      >
        <div className="flex w-full items-center gap-2">
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          )}
          {running ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-sky-300" />
          ) : (
            <Brain className="h-3.5 w-3.5 shrink-0 text-sky-300" />
          )}
          <span className="font-medium text-slate-200">{headerTitle}</span>
          {running && (
            <span className="rounded-full border border-sky-400/25 bg-sky-500/15 px-2 py-0.5 text-[0.625rem] font-medium text-sky-200">
              {activeStatusText}
            </span>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-2 text-[0.6875rem] text-slate-400 tabular-nums">
            {formattedTotal && (
              <span className="inline-flex items-center gap-1 text-slate-400">
                <Clock className="h-2.5 w-2.5 text-slate-500" />
                {formattedTotal}
              </span>
            )}
            {thoughtCount > 0 && (
              <span>
                {thoughtCount} thought{thoughtCount === 1 ? '' : 's'}
              </span>
            )}
            {toolCount > 0 && (
              <span>
                {toolCount} tool{toolCount === 1 ? '' : 's'}
              </span>
            )}
          </span>
        </div>

        {!open && !running && (previewText || toolPills.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 pl-5.5">
            {previewText && (
              <span className="line-clamp-1 max-w-full text-[0.71875rem] text-slate-400">
                {previewText}
              </span>
            )}
            {toolPills.length > 0 && (
              <span className="flex flex-wrap items-center gap-1">
                {toolPills.map((tp, idx) => (
                  <span
                    key={`${tp.name}-${idx}`}
                    className={cx(
                      'inline-flex items-center gap-1 rounded border px-1.5 py-px font-mono text-[0.625rem]',
                      tp.ok
                        ? 'border-emerald-500/20 bg-emerald-500/[0.07] text-emerald-300/90'
                        : 'border-rose-500/25 bg-rose-500/[0.08] text-rose-300',
                    )}
                  >
                    {tp.ok ? <CheckCircle2 className="h-2.5 w-2.5" /> : <XCircle className="h-2.5 w-2.5" />}
                    {tp.name}
                  </span>
                ))}
                {extraToolsCount > 0 && (
                  <span className="text-[0.625rem] text-slate-500">+{extraToolsCount} more</span>
                )}
              </span>
            )}
          </div>
        )}
      </button>

      {open && (
        <div className={cx('border-t border-white/[0.06]', compact ? 'px-2.5 py-2' : 'px-3.5 py-2.5')}>
          {steps.length === 0 && running ? (
            <div className="flex items-center gap-2 py-1 text-xs text-slate-400">
              <Sparkles className="h-3.5 w-3.5 animate-pulse text-sky-300" />
              <span>Planning next MCP steps…</span>
            </div>
          ) : (
            <div className="relative space-y-2.5 pl-5 before:absolute before:top-2 before:bottom-2 before:left-[0.5rem] before:w-px before:bg-white/[0.08]">
              {steps.map((st, idx) => {
                const isRunningStep = st.status === 'running';
                const stepDuration = typeof st.durationMs === 'number' && st.durationMs > 0 ? formatDuration(st.durationMs) : '';
                const isThinking = st.phase === 'thinking';
                const isPermission = st.phase === 'permission';
                const isFailed = st.phase === 'error' || st.ok === false;

                return (
                  <div key={`${st.round}-${st.phase}-${idx}`} className="relative">
                    {/* Timeline node dot */}
                    <span
                      className={cx(
                        'absolute top-1 -left-5 flex h-4 w-4 items-center justify-center rounded-full border',
                        isRunningStep
                          ? 'border-sky-400/50 bg-[#0d1522] text-sky-300'
                          : isThinking
                            ? 'border-sky-400/30 bg-sky-500/15 text-sky-300'
                            : isPermission
                              ? st.ok === true
                                ? 'border-emerald-400/30 bg-emerald-500/15 text-emerald-300'
                                : st.ok === false
                                  ? 'border-rose-400/35 bg-rose-500/15 text-rose-400'
                                  : 'border-amber-400/40 bg-amber-500/15 text-amber-300'
                              : isFailed
                                ? 'border-rose-400/35 bg-rose-500/15 text-rose-400'
                                : 'border-emerald-400/30 bg-emerald-500/15 text-emerald-300',
                      )}
                    >
                      {isRunningStep ? (
                        <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      ) : isThinking ? (
                        <Sparkles className="h-2.5 w-2.5" />
                      ) : isPermission ? (
                        <ShieldAlert className="h-2.5 w-2.5" />
                      ) : isFailed ? (
                        <XCircle className="h-2.5 w-2.5" />
                      ) : (
                        <Wrench className="h-2.5 w-2.5" />
                      )}
                    </span>

                    <div
                      className={cx(
                        'rounded-lg border px-2.5 py-2',
                        isRunningStep
                          ? 'border-sky-500/25 bg-sky-500/[0.04]'
                          : isThinking
                            ? 'border-white/[0.06] bg-white/[0.02]'
                            : isFailed
                              ? 'border-rose-500/20 bg-rose-500/[0.04]'
                              : 'border-white/[0.06] bg-white/[0.02]',
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        {st.toolName ? (
                          <>
                            <span className="font-mono text-[0.71875rem] font-semibold text-sky-200">
                              {st.toolName}
                            </span>
                            <span
                              className={cx(
                                'rounded px-1.5 py-px text-[0.625rem] font-medium',
                                isRunningStep
                                  ? 'bg-sky-500/15 text-sky-300'
                                  : isFailed
                                    ? 'bg-rose-500/15 text-rose-300'
                                    : 'bg-emerald-500/15 text-emerald-300',
                              )}
                            >
                              {isRunningStep ? 'running' : isFailed ? 'failed' : 'ok'}
                            </span>
                          </>
                        ) : (
                          <span className="text-[0.71875rem] font-medium text-slate-200">
                            {st.title}
                          </span>
                        )}

                        {stepDuration && (
                          <span className="ml-auto inline-flex items-center gap-1 text-[0.625rem] text-slate-500 tabular-nums">
                            <Clock className="h-2.5 w-2.5" />
                            {stepDuration}
                          </span>
                        )}
                      </div>

                      {st.args && Object.keys(st.args).length > 0 && <ToolArgsDisplay args={st.args} />}

                      {st.detail && (
                        <div className="mt-1.5 text-slate-300">
                          {isThinking && !isRunningStep ? (
                            <MarkdownContent text={st.detail} compact className="text-[0.75rem] text-slate-300/95" />
                          ) : (
                            <p
                              className={cx(
                                'text-[0.75rem] leading-snug whitespace-pre-wrap',
                                isRunningStep ? 'animate-pulse text-sky-200/80' : 'text-slate-400',
                              )}
                            >
                              {st.detail}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
