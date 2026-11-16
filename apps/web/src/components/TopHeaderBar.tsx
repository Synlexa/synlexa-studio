import {
  Bot,
  Command,
  Compass,
  Cpu,
  Database,
  Download,
  FileCode2,
  FlaskConical,
  LogIn,
  ShieldAlert,
  UserCheck,
} from 'lucide-react';
import type { CompareStructuresResult } from '@synlexa/wasm-bridge';
import type { StudioSession } from '../lib/studioAuth';
import type { UiMode } from '../lib/workbenchReducers';

interface TopHeaderBarProps {
  comparison: CompareStructuresResult | null;
  busyLabel: string | null;
  wasmReady: boolean;
  rendererMode: 'webgl2' | 'canvas2d-fallback';
  onOpenPalette: () => void;
  onExportHtmlReport: () => void;
  onExportBundle: () => void;
  uiMode?: UiMode;
  onChangeUiMode?: (mode: UiMode) => void;
  onOpenLaunchpad?: () => void;
  onOpenDatabaseExplorer?: () => void;
  authSession?: StudioSession | null;
  onOpenAuth?: () => void;
}

export function TopHeaderBar({
  comparison,
  busyLabel,
  wasmReady,
  rendererMode,
  onOpenPalette,
  onExportHtmlReport,
  onExportBundle,
  uiMode = 'simple',
  onChangeUiMode,
  onOpenLaunchpad,
  onOpenDatabaseExplorer,
  authSession = null,
  onOpenAuth,
}: TopHeaderBarProps) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-slate-800/90 bg-[#0b1019]/95 px-3 select-none backdrop-blur-md">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-cyan-500/40 bg-cyan-500/12 text-cyan-300">
            <FlaskConical className="h-3.5 w-3.5" />
          </div>
          <span className="text-xs font-semibold tracking-wide text-slate-100">
            SYNLEXA STUDIO
          </span>
          <span className="hidden rounded border border-slate-700/80 bg-slate-900 px-1.5 py-0.5 font-mono text-[0.75rem] text-slate-400 xl:inline">
            BIO-CHEM IDE
          </span>
        </div>

        <div
          className="flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[0.75rem] font-semibold tracking-wider text-amber-300"
          title="Research Use Only — Not for clinical diagnosis, treatment, or patient management."
        >
          <ShieldAlert className="h-3 w-3 shrink-0" />
          <span className="hidden sm:inline">RESEARCH USE ONLY (RUO)</span>
          <span className="sm:hidden">RUO</span>
        </div>

        {/* Simple Mode / Pro Mode Toggle */}
        {onChangeUiMode && (
          <div
            className="flex items-center rounded-lg border border-slate-700/80 bg-slate-950/90 p-0.5 text-[0.8125rem]"
            role="group"
            aria-label="Workspace mode"
          >
            <button
              type="button"
              onClick={() => onChangeUiMode('simple')}
              className={`rounded-md px-2.5 py-0.5 font-medium transition ${
                uiMode === 'simple'
                  ? 'bg-cyan-500/20 text-cyan-100 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Simple Mode
            </button>
            <button
              type="button"
              onClick={() => onChangeUiMode('pro')}
              className={`rounded-md px-2.5 py-0.5 font-medium transition ${
                uiMode === 'pro'
                  ? 'bg-violet-500/20 text-violet-100 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Pro IDE
            </button>
          </div>
        )}

        {comparison && (
          <div className="hidden items-center gap-2.5 border-l border-slate-800 pl-3 font-mono text-[0.8125rem] 2xl:flex">
            <span className="text-slate-400">
              Cα RMSD{' '}
              <strong className="text-emerald-300">
                {comparison.metrics.rmsdAngstrom.toFixed(3)} Å
              </strong>
            </span>
            <span className="text-slate-600">·</span>
            <span className="text-slate-400">
              Matched{' '}
              <strong className="text-slate-200">
                {comparison.metrics.matchedCaCount}
              </strong>
            </span>
            <span className="text-slate-600">·</span>
            <span className="text-slate-400">
              PAE{' '}
              <strong className="text-cyan-300">
                {comparison.metrics.paeStatus}
              </strong>
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <div className="hidden items-center gap-1.5 rounded-md border border-slate-800 bg-slate-900/70 px-2 py-1 font-mono text-[0.75rem] text-slate-400 lg:flex">
          <Cpu className="h-3 w-3 text-cyan-400" />
          <span className="max-w-[170px] truncate">
            {busyLabel
              ? busyLabel
              : wasmReady
                ? `Wasm f64 · ${rendererMode === 'webgl2' ? 'WebGL2' : '2D'}`
                : 'Loading Wasm…'}
          </span>
        </div>

        {onOpenLaunchpad && (
          <button
            type="button"
            onClick={onOpenLaunchpad}
            className="flex items-center gap-1 rounded-md border border-cyan-500/35 bg-cyan-500/10 px-2.5 py-1 text-[0.8125rem] font-medium text-cyan-200 transition hover:bg-cyan-500/20"
          >
            <Compass className="h-3 w-3" />
            <span className="hidden md:inline">Quick Start / Tour</span>
            <span className="md:hidden">Tour</span>
          </button>
        )}

        {onOpenDatabaseExplorer && (
          <button
            type="button"
            onClick={onOpenDatabaseExplorer}
            className="flex items-center gap-1 rounded-md border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1 text-[0.8125rem] font-medium text-emerald-200 transition hover:bg-emerald-500/20"
            title="Search live RCSB PDB, AlphaFold DB, UniProtKB & PubChem"
          >
            <Database className="h-3 w-3" />
            <span className="hidden md:inline">Databases</span>
          </button>
        )}

        <button
          type="button"
          onClick={onOpenPalette}
          className="flex items-center gap-1.5 rounded-md border border-slate-700/80 bg-slate-900 px-2 py-1 text-[0.8125rem] text-slate-300 transition hover:border-cyan-500/50 hover:text-cyan-200"
          title="Command Palette (⌘K / Ctrl+K)"
        >
          <Command className="h-3 w-3" />
          <kbd className="rounded bg-slate-800 px-1 font-mono text-[0.75rem] text-slate-400">
            ⌘K
          </kbd>
        </button>

        {uiMode === 'pro' && (
          <button
            type="button"
            onClick={onExportBundle}
            className="hidden items-center gap-1 rounded-md border border-slate-700/80 bg-slate-900 px-2 py-1 text-[0.8125rem] text-slate-300 transition hover:border-emerald-500/50 hover:text-emerald-200 sm:flex"
            title="Save versioned .synlexa.bundle.json"
          >
            <FileCode2 className="h-3 w-3" />
            <span>Bundle</span>
          </button>
        )}

        <button
          type="button"
          onClick={onExportHtmlReport}
          disabled={!comparison}
          className="flex items-center gap-1 rounded-md border border-cyan-500/40 bg-cyan-500/15 px-2.5 py-1 text-[0.8125rem] font-medium text-cyan-200 transition hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Download className="h-3 w-3" />
          <span className="hidden sm:inline">RUO Report</span>
        </button>

        {onOpenAuth && (
          <button
            type="button"
            onClick={onOpenAuth}
            className={`flex items-center gap-1 rounded-md border px-2.5 py-1 text-[0.8125rem] font-medium transition ${
              authSession
                ? 'border-emerald-500/40 bg-emerald-500/12 text-emerald-200 hover:bg-emerald-500/20'
                : 'border-slate-700/80 bg-slate-900 text-slate-200 hover:border-cyan-500/40 hover:text-cyan-100'
            }`}
            title={
              authSession
                ? `Connected (${authSession.verification})`
                : 'Sign in or Sign up via synlexa.com (PKCE)'
            }
          >
            {authSession ? (
              <>
                <UserCheck className="h-3 w-3 text-emerald-300" />
                <span className="hidden max-w-[110px] truncate lg:inline">
                  {authSession.email ?? authSession.displayName ?? 'Connected'}
                </span>
              </>
            ) : (
              <>
                <LogIn className="h-3 w-3" />
                <span className="hidden lg:inline">Sign in</span>
              </>
            )}
          </button>
        )}

        <span className="sr-only">
          <Bot className="h-3 w-3" />
        </span>
      </div>
    </header>
  );
}
