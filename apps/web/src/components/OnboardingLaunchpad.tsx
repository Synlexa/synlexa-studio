import { useState } from 'react';
import {
  ArrowRight,
  Atom,
  BookOpen,
  CheckCircle2,
  Cpu,
  Database,
  Dna,
  FlaskConical,
  Layers,
  ShieldAlert,
  X,
} from 'lucide-react';
import { STARTER_PRESETS, WORKFLOW_STEPS, type StarterPreset } from '../lib/starterPresets';

interface OnboardingLaunchpadProps {
  open: boolean;
  onClose: () => void;
  activeStarterId: string | null;
  onLaunchStarter: (preset: StarterPreset) => void;
  onOpenDatabaseExplorer: () => void;
  onJumpToStep: (step: 1 | 2 | 3 | 4) => void;
}

const STEP_ICONS = {
  1: Database,
  2: Layers,
  3: Dna,
  4: Cpu,
} as const;

export function OnboardingLaunchpad({
  open,
  onClose,
  activeStarterId,
  onLaunchStarter,
  onOpenDatabaseExplorer,
  onJumpToStep,
}: OnboardingLaunchpadProps) {
  const [selectedStep, setSelectedStep] = useState<1 | 2 | 3 | 4>(1);

  if (!open) return null;

  const currentStep = WORKFLOW_STEPS.find((s) => s.id === selectedStep) ?? WORKFLOW_STEPS[0];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Synlexa Studio Quick-Start Launchpad"
    >
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-700/80 bg-[#0b1019] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-[#0e1522] px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-500/40 bg-cyan-500/15 text-cyan-300">
              <FlaskConical className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                Synlexa Studio Quick-Start Launchpad
              </h2>
              <p className="text-[0.8125rem] text-slate-400">
                Effortless computational biology &amp; chemistry — local Wasm f64 engine + live public databases
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[0.75rem] font-semibold text-amber-300 sm:inline-flex">
              <ShieldAlert className="h-3 w-3" />
              RESEARCH USE ONLY (RUO)
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Quick-Start Launchpad"
              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {/* Interactive 4-Step Walkthrough */}
          <section className="rounded-lg border border-slate-800 bg-slate-900/45 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-mono text-[0.75rem] font-semibold tracking-wider text-cyan-300">
                <BookOpen className="h-3.5 w-3.5" />
                4-STEP INTERACTIVE TOUR
              </span>
              <button
                type="button"
                onClick={() => {
                  onJumpToStep(selectedStep);
                  onClose();
                }}
                className="flex items-center gap-1 rounded border border-cyan-500/40 bg-cyan-500/15 px-2.5 py-1 font-mono text-[0.75rem] text-cyan-200 hover:bg-cyan-500/25"
              >
                <span>Go to Step {selectedStep}</span>
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
              {WORKFLOW_STEPS.map((step) => {
                const Icon = STEP_ICONS[step.id];
                const active = selectedStep === step.id;
                return (
                  <button
                    key={step.id}
                    type="button"
                    onClick={() => setSelectedStep(step.id)}
                    className={`flex flex-col items-start rounded-lg border p-2.5 text-left transition ${
                      active
                        ? 'border-cyan-500/60 bg-cyan-500/12 text-slate-100'
                        : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                    }`}
                  >
                    <div className="mb-1.5 flex w-full items-center justify-between">
                      <span className="font-mono text-[0.75rem] font-bold text-cyan-300">
                        STEP {step.id}
                      </span>
                      <Icon className="h-3.5 w-3.5 text-cyan-300" />
                    </div>
                    <div className="text-xs font-medium leading-snug">{step.title}</div>
                  </button>
                );
              })}
            </div>

            <div className="mt-3 rounded border border-slate-800/80 bg-[#070b12] px-3 py-2 text-xs text-slate-300">
              <strong className="text-cyan-200">Step {currentStep.id}:</strong> {currentStep.hint}
            </div>
          </section>

          {/* 1-Click Starter Cards */}
          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
                  1-Click Pinned Starter Projects
                </h3>
                <p className="text-[0.8125rem] text-slate-400">
                  Every fixture carries a verified SHA-256 digest, revision, and public license in the manifest.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenDatabaseExplorer();
                }}
                className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-[0.8125rem] font-medium text-emerald-200 transition hover:bg-emerald-500/20"
              >
                <Database className="h-3.5 w-3.5" />
                <span>Search Live Public Databases</span>
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {STARTER_PRESETS.map((preset) => {
                const isActive = activeStarterId === preset.id;
                const isChem = preset.kind === 'chemistry-panel';
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      onLaunchStarter(preset);
                      onClose();
                    }}
                    className={`group flex flex-col justify-between rounded-xl border p-3.5 text-left transition ${
                      isActive
                        ? 'border-cyan-500/60 bg-cyan-500/10'
                        : 'border-slate-800 bg-slate-900/45 hover:border-cyan-500/40 hover:bg-slate-900/80'
                    }`}
                  >
                    <div>
                      <div className="mb-1 flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-100 group-hover:text-cyan-200">
                            {isChem ? (
                              <Atom className="h-4 w-4 text-emerald-300" />
                            ) : (
                              <FlaskConical className="h-4 w-4 text-cyan-300" />
                            )}
                            <span>{preset.title}</span>
                          </div>
                          <div className="mt-0.5 font-mono text-[0.75rem] text-cyan-300/90">
                            {preset.subtitle}
                          </div>
                        </div>

                        {isActive ? (
                          <span className="flex items-center gap-1 rounded border border-cyan-500/40 bg-cyan-500/15 px-1.5 py-0.5 font-mono text-[0.6875rem] text-cyan-200">
                            <CheckCircle2 className="h-2.5 w-2.5" />
                            Active
                          </span>
                        ) : (
                          <span className="rounded border border-slate-700 bg-slate-950 px-2 py-0.5 font-mono text-[0.6875rem] text-slate-300 group-hover:border-cyan-500/40 group-hover:text-cyan-200">
                            Load →
                          </span>
                        )}
                      </div>

                      <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-slate-400">
                        {preset.blurb}
                      </p>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-1">
                      {preset.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded border border-slate-800 bg-slate-950 px-1.5 py-0.5 font-mono text-[0.6875rem] text-slate-400"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 bg-[#080c13] px-5 py-2.5 text-[0.75rem] text-slate-400">
          <span className="flex items-center gap-1.5 font-mono text-amber-300/90">
            <ShieldAlert className="h-3 w-3 shrink-0" />
            Research Use Only (RUO) — Not for clinical diagnosis, treatment selection, or patient care.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-700 bg-slate-900 px-3 py-1 font-mono text-[0.75rem] text-slate-200 hover:border-slate-500"
          >
            Continue to Workspace
          </button>
        </div>
      </div>
    </div>
  );
}
