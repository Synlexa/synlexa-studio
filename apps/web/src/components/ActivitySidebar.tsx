import { useState, type DragEvent } from 'react';
import {
  Activity,
  AlertTriangle,
  Atom,
  Box,
  Compass,
  Database,
  Dna,
  FileUp,
  History,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  RefreshCw,
  Scissors,
  Trash2,
} from 'lucide-react';
import type { InspectStructureResult } from '@synlexa/wasm-bridge';
import type { ActivityMode, WorkbenchTab } from '../lib/workbenchReducers';
import type { RunHistoryEntry } from '../lib/runHistory';

interface ActivitySidebarProps {
  activeMode: ActivityMode;
  onSelectMode: (mode: ActivityMode) => void;
  refLabel: string;
  mobLabel: string;
  refInspect: InspectStructureResult | null;
  mobInspect: InspectStructureResult | null;
  refChain: string;
  mobChain: string;
  chainError: string | null;
  onChangeRefChain: (chain: string) => void;
  onChangeMobChain: (chain: string) => void;
  onResetPinnedDemo: () => void;
  onUploadFiles: (files: FileList, targetRole?: 'reference' | 'mobile' | 'auto') => void;
  runHistory: RunHistoryEntry[];
  onClearHistory: () => void;
  onSwitchWorkbenchTab: (tab: WorkbenchTab) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onOpenLaunchpad?: () => void;
  onOpenDatabaseExplorer?: () => void;
  paePresent?: boolean;
}

export function ActivitySidebar({
  activeMode,
  onSelectMode,
  refLabel,
  mobLabel,
  refInspect,
  mobInspect,
  refChain,
  mobChain,
  chainError,
  onChangeRefChain,
  onChangeMobChain,
  onResetPinnedDemo,
  onUploadFiles,
  runHistory,
  onClearHistory,
  onSwitchWorkbenchTab,
  collapsed = false,
  onToggleCollapse,
  onOpenLaunchpad,
  onOpenDatabaseExplorer,
  paePresent = false,
}: ActivitySidebarProps) {
  const [dragOver, setDragOver] = useState(false);

  const navItems: Array<{
    id: ActivityMode;
    label: string;
    icon: typeof Box;
    tab?: WorkbenchTab;
  }> = [
    { id: 'structures', label: 'Structures', icon: Box, tab: 'sequence' },
    { id: 'peptides', label: 'Peptides', icon: Scissors, tab: 'peptide' },
    { id: 'genomics', label: 'CRISPR', icon: Dna, tab: 'crispr' },
    { id: 'chemistry', label: 'Ligands', icon: Atom, tab: 'chemistry' },
    { id: 'history', label: 'History', icon: History },
  ];

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onUploadFiles(e.dataTransfer.files, 'auto');
    }
  };

  return (
    <aside className="flex h-full shrink-0 border-r border-slate-800/90 bg-[#0b1019]">
      {/* Activity Icon Rail */}
      <div className="flex w-11 flex-col items-center justify-between border-r border-slate-800/80 bg-[#080c13] py-2">
        <div className="flex flex-col items-center gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeMode === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelectMode(item.id);
                  if (item.tab) onSwitchWorkbenchTab(item.tab);
                }}
                title={item.label}
                className={`relative flex h-9 w-9 items-center justify-center rounded-lg transition ${
                  active
                    ? 'bg-cyan-500/15 text-cyan-300'
                    : 'text-slate-500 hover:bg-slate-800/60 hover:text-slate-300'
                }`}
              >
                {active && (
                  <span className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-r bg-cyan-400" />
                )}
                <Icon className="h-4 w-4" />
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => onSwitchWorkbenchTab('ramachandran')}
            title="Ramachandran (φ, ψ) & Cα Contact Map"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-800/60 hover:text-cyan-300"
          >
            <Activity className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col items-center gap-1.5">
          {onOpenLaunchpad && (
            <button
              type="button"
              onClick={onOpenLaunchpad}
              title="Quick Start & Starter Projects"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-cyan-400/80 hover:bg-slate-800/70 hover:text-cyan-200"
            >
              <Compass className="h-4 w-4" />
            </button>
          )}
          {onOpenDatabaseExplorer && (
            <button
              type="button"
              onClick={onOpenDatabaseExplorer}
              title="Public Database Explorer"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-emerald-400/80 hover:bg-slate-800/70 hover:text-emerald-200"
            >
              <Database className="h-4 w-4" />
            </button>
          )}
          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            >
              {collapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Explorer Drawer */}
      {!collapsed && (
        <div className="flex w-64 flex-col overflow-y-auto p-3 text-xs">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[0.75rem] font-semibold tracking-wider text-slate-400 uppercase">
              {activeMode === 'history' ? 'Run History' : 'Project Explorer'}
            </span>
            <div className="flex items-center gap-1">
              {onOpenDatabaseExplorer && (
                <button
                  type="button"
                  onClick={onOpenDatabaseExplorer}
                  className="flex items-center gap-1 rounded border border-emerald-500/35 bg-emerald-500/10 px-1.5 py-0.5 text-[0.75rem] text-emerald-200 hover:bg-emerald-500/20"
                  title="Search live RCSB, AlphaFold, UniProt & PubChem"
                >
                  <Database className="h-2.5 w-2.5" />
                  <span>Fetch</span>
                </button>
              )}
              <button
                type="button"
                onClick={onResetPinnedDemo}
                className="flex items-center gap-1 rounded border border-slate-800 bg-slate-900 px-1.5 py-0.5 text-[0.75rem] text-slate-300 hover:border-cyan-500/40 hover:text-cyan-200"
                title="Reload pinned 3HS4 + AF-P00918-F1 v6 offline fixtures"
              >
                <RefreshCw className="h-2.5 w-2.5" />
                <span>Demo</span>
              </button>
            </div>
          </div>

          {activeMode === 'history' ? (
            <div className="flex flex-col gap-2">
              {runHistory.length > 0 && (
                <button
                  type="button"
                  onClick={onClearHistory}
                  className="flex items-center justify-center gap-1 rounded border border-slate-800 bg-slate-900/70 py-1 text-[0.75rem] text-slate-400 hover:border-rose-500/40 hover:text-rose-300"
                >
                  <Trash2 className="h-3 w-3" /> Clear Saved Runs
                </button>
              )}
              {runHistory.length === 0 ? (
                <div className="rounded border border-slate-800/80 bg-slate-900/40 p-3 text-[0.8125rem] text-slate-500">
                  No persisted comparison runs yet.
                </div>
              ) : (
                runHistory.map((item) => (
                  <div
                    key={item.id}
                    className="rounded border border-slate-800 bg-slate-900/60 p-2 font-mono text-[0.75rem]"
                  >
                    <div className="flex items-center justify-between text-slate-200">
                      <span className="truncate font-semibold">
                        {item.refLabel} ↔ {item.mobLabel}
                      </span>
                      <span className="text-emerald-300">{item.rmsdAngstrom.toFixed(2)}Å</span>
                    </div>
                    <div className="mt-1 text-slate-400">
                      Chains {item.refChain}/{item.mobChain} · {item.matchedCaCount} Cα · PAE:{' '}
                      {item.paeStatus}
                    </div>
                    <div className="mt-0.5 truncate text-[0.6875rem] text-slate-500">
                      {item.createdAtUtc}
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {/* Active Artifacts */}
              <div className="rounded-lg border border-slate-800/90 bg-slate-900/40 p-2">
                <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[0.75rem] text-cyan-300">
                  <Pin className="h-3 w-3" />
                  <span>LOADED STRUCTURES</span>
                </div>
                <div className="space-y-1.5 text-[0.8125rem]">
                  <div className="rounded bg-slate-950/70 p-1.5">
                    <div className="flex items-center justify-between gap-1">
                      <span className="truncate font-medium text-sky-300">{refLabel}</span>
                      <span className="shrink-0 rounded bg-slate-800 px-1 font-mono text-[0.6875rem] text-slate-300">
                        {refInspect?.format.toUpperCase() ?? 'REF'}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[0.75rem] text-slate-500">
                      {refInspect?.confidenceKind ?? 'awaiting inspect'}
                    </div>
                  </div>
                  <div className="rounded bg-slate-950/70 p-1.5">
                    <div className="flex items-center justify-between gap-1">
                      <span className="truncate font-medium text-emerald-300">{mobLabel}</span>
                      <span className="shrink-0 rounded bg-slate-800 px-1 font-mono text-[0.6875rem] text-slate-300">
                        {mobInspect?.format.toUpperCase() ?? 'MOB'}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[0.75rem] text-slate-500">
                      {mobInspect?.confidenceKind ?? 'awaiting inspect'}
                      {paePresent ? ' · PAE loaded' : ''}
                    </div>
                  </div>
                </div>
              </div>

              {/* Chain Selectors */}
              <div className="rounded-lg border border-slate-800/90 bg-slate-900/40 p-2">
                <div className="mb-2 flex items-center gap-1.5 font-mono text-[0.75rem] text-slate-400">
                  <Layers className="h-3 w-3 text-cyan-400" />
                  <span>EXPLICIT CHAIN SELECTION</span>
                </div>

                {chainError && (
                  <div className="mb-2 flex items-start gap-1.5 rounded border border-amber-500/50 bg-amber-500/10 p-2 text-[0.75rem] text-amber-200">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
                    <span>{chainError}</span>
                  </div>
                )}

                <label className="block">
                  <span className="text-[0.75rem] text-slate-400">Reference Chain</span>
                  <select
                    value={refChain}
                    onChange={(e) => onChangeRefChain(e.target.value)}
                    className="mt-0.5 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[0.8125rem] text-slate-200 outline-none focus:border-cyan-500"
                  >
                    <option value="">-- Select chain --</option>
                    {(refInspect?.chains ?? []).map((c) => (
                      <option key={c.chainId} value={c.chainId}>
                        Chain {c.chainId} (auth {c.authChainId}) · {c.observedCaCount} Cα
                      </option>
                    ))}
                  </select>
                </label>

                <label className="mt-2 block">
                  <span className="text-[0.75rem] text-slate-400">Mobile / Prediction Chain</span>
                  <select
                    value={mobChain}
                    onChange={(e) => onChangeMobChain(e.target.value)}
                    className="mt-0.5 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[0.8125rem] text-slate-200 outline-none focus:border-emerald-500"
                  >
                    <option value="">-- Select chain --</option>
                    {(mobInspect?.chains ?? []).map((c) => (
                      <option key={c.chainId} value={c.chainId}>
                        Chain {c.chainId} (auth {c.authChainId}) · {c.observedCaCount} Cα
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {/* Drag-and-Drop / File Picker */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                className={`rounded-lg border border-dashed p-3 text-center transition ${
                  dragOver
                    ? 'border-cyan-400 bg-cyan-500/10'
                    : 'border-slate-700 bg-slate-900/30 hover:border-slate-600'
                }`}
              >
                <FileUp className="mx-auto mb-1.5 h-4 w-4 text-slate-400" />
                <div className="text-[0.8125rem] text-slate-300">Drop local bio/chem files</div>
                <div className="mt-0.5 font-mono text-[0.6875rem] text-slate-500">
                  .cif · .pdb · .fasta · .smi · .synlexa.bundle.json
                </div>
                <div className="mt-2 flex flex-wrap justify-center gap-1">
                  <label className="cursor-pointer rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[0.75rem] text-sky-300 hover:border-sky-500/50">
                    Load Ref
                    <input
                      type="file"
                      className="hidden"
                      accept=".cif,.mmcif,.pdb,.ent,.json,.fasta,.fa,.smi"
                      onChange={(e) => {
                        if (e.target.files?.length) onUploadFiles(e.target.files, 'reference');
                        e.target.value = '';
                      }}
                    />
                  </label>
                  <label className="cursor-pointer rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[0.75rem] text-emerald-300 hover:border-emerald-500/50">
                    Load Mob / File
                    <input
                      type="file"
                      className="hidden"
                      accept=".cif,.mmcif,.pdb,.ent,.json,.fasta,.fa,.smi"
                      onChange={(e) => {
                        if (e.target.files?.length) onUploadFiles(e.target.files, 'mobile');
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>
              </div>

              {/* Pinned Ligands detected */}
              {refInspect && refInspect.ligands.length > 0 && (
                <div className="rounded-lg border border-slate-800/90 bg-slate-900/40 p-2">
                  <div className="mb-1 font-mono text-[0.75rem] text-slate-400">
                    DETECTED HETATM LIGANDS ({refInspect.ligands.length})
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {refInspect.ligands.slice(0, 8).map((l) => (
                      <span
                        key={`${l.chainId}-${l.seqId}-${l.resName}`}
                        className="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-[0.75rem] text-violet-300"
                      >
                        {l.resName} {l.chainId}:{l.seqId}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
