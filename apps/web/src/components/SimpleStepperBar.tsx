import { CheckCircle2, Compass, Database, Download, FlaskConical, SlidersHorizontal } from 'lucide-react';
import { WORKFLOW_STEPS } from '../lib/starterPresets';

interface SimpleStepperBarProps {
  currentStep: 1 | 2 | 3 | 4;
  activeStarterTitle: string;
  onSelectStep: (step: 1 | 2 | 3 | 4) => void;
  onOpenLaunchpad: () => void;
  onOpenDatabaseExplorer: () => void;
  onSwitchToPro: () => void;
}

export function SimpleStepperBar({
  currentStep,
  activeStarterTitle,
  onSelectStep,
  onOpenLaunchpad,
  onOpenDatabaseExplorer,
  onSwitchToPro,
}: SimpleStepperBarProps) {
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 bg-[#0c121d]/95 px-3 py-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {WORKFLOW_STEPS.map((step, idx) => {
          const active = currentStep === step.id;
          const completed = currentStep > step.id;
          return (
            <div key={step.id} className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onSelectStep(step.id)}
                title={step.hint}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.8125rem] font-medium transition ${
                  active
                    ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-100 shadow-xs'
                    : completed
                      ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200'
                      : 'border-slate-800 bg-slate-900/70 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                }`}
              >
                {completed ? (
                  <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                ) : (
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded-full font-mono text-[0.6875rem] font-bold ${
                      active ? 'bg-cyan-400 text-slate-950' : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    {step.id}
                  </span>
                )}
                <span>{step.title}</span>
              </button>
              {idx < WORKFLOW_STEPS.length - 1 && (
                <span className="hidden text-slate-600 md:inline">→</span>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-1.5">
        <span className="hidden items-center gap-1 rounded border border-slate-800 bg-slate-950/70 px-2 py-0.5 font-mono text-[0.75rem] text-slate-300 xl:inline-flex">
          <FlaskConical className="h-3 w-3 text-cyan-300" />
          <span className="max-w-[180px] truncate">{activeStarterTitle}</span>
        </span>
        <button
          type="button"
          onClick={onOpenLaunchpad}
          className="flex items-center gap-1 rounded border border-cyan-500/35 bg-cyan-500/10 px-2 py-1 text-[0.75rem] font-medium text-cyan-200 hover:bg-cyan-500/20"
        >
          <Compass className="h-3 w-3" />
          <span>Starters</span>
        </button>
        <button
          type="button"
          onClick={onOpenDatabaseExplorer}
          className="flex items-center gap-1 rounded border border-emerald-500/35 bg-emerald-500/10 px-2 py-1 text-[0.75rem] font-medium text-emerald-200 hover:bg-emerald-500/20"
        >
          <Database className="h-3 w-3" />
          <span>Public DBs</span>
        </button>
        <button
          type="button"
          onClick={onSwitchToPro}
          className="hidden items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[0.75rem] text-slate-300 hover:border-slate-500 sm:inline-flex"
          title="Open all Pro IDE panels (PAE matrix, 4×4 transform, run history)"
        >
          <SlidersHorizontal className="h-3 w-3 text-amber-300" />
          <span>Pro IDE</span>
        </button>
        <span className="sr-only">
          <Download className="h-3 w-3" />
        </span>
      </div>
    </div>
  );
}
