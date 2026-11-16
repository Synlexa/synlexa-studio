import { TONE_CLASSES, type MetricInsight } from '../lib/metricInsights';

interface MetricInsightBadgeProps {
  insight: MetricInsight;
  compact?: boolean;
}

export function MetricInsightBadge({ insight, compact = false }: MetricInsightBadgeProps) {
  const toneClass = TONE_CLASSES[insight.tone];

  if (compact) {
    return (
      <span
        title={`${insight.label} (${insight.rule}): ${insight.explanation}`}
        className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[0.6875rem] font-medium ${toneClass}`}
      >
        <span>{insight.label}</span>
      </span>
    );
  }

  return (
    <div className="rounded-lg border border-slate-800/90 bg-slate-950/75 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[0.75rem] text-slate-400">{insight.metric}</span>
        <span className={`rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium ${toneClass}`}>
          {insight.label}
        </span>
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className="font-mono text-sm font-bold text-slate-100">{insight.value}</span>
        <span className="font-mono text-[0.6875rem] text-slate-500">{insight.rule}</span>
      </div>
      <p className="mt-1 text-[0.75rem] leading-relaxed text-slate-400">{insight.explanation}</p>
    </div>
  );
}
