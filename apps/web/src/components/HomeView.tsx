import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Atom,
  BookOpen,
  Bot,
  Box,
  Cpu,
  Database,
  Dna,
  FileUp,
  FlaskConical,
  FolderOpen,
  FolderPlus,
  GitBranch,
  History,
  Library,
  Puzzle,
  Scissors,
  Trash2,
} from 'lucide-react';
import { listLibrary, subscribeLibrary, type LibraryItem } from '../lib/moleculeLibrary';
import type { ProjectTemplateKind, StudioProject } from '../lib/projectsStore';
import { RUO_DISCLAIMER } from '../lib/reportGenerator';
import type { RunHistoryEntry } from '../lib/runHistory';
import { STARTER_PRESETS, type StarterPreset } from '../lib/starterPresets';
import { Badge, Button, cx, Input, Kbd, Select } from './ui';

interface HomeViewProps {
  activeStarterId: string | null;
  runHistory: RunHistoryEntry[];
  projects?: StudioProject[];
  activeProject?: StudioProject | null;
  onCreateProject?: (input: { name: string; description?: string; template: ProjectTemplateKind }) => void;
  onSwitchProject?: (projectId: string) => void;
  onDeleteProject?: (projectId: string) => void;
  onOpenTutorial?: () => void;
  onImportFile: () => void;
  onSearchDatabases: () => void;
  onOpenLibrary: () => void;
  onOpenAssistant: () => void;
  onOpenChemistry?: () => void;
  onOpenPeptide?: () => void;
  onOpenCrispr?: () => void;
  onOpenWorkflows?: () => void;
  onOpenComputeNodes?: () => void;
  onOpenPlugins?: () => void;
  onLaunchStarter: (p: StarterPreset) => void;
  onOpenLibraryItem: (item: LibraryItem) => void;
}

const KIND_ICON = {
  structure: <Box className="h-4 w-4 text-sky-300" />,
  compound: <Atom className="h-4 w-4 text-violet-300" />,
  sequence: <Dna className="h-4 w-4 text-emerald-300" />,
};

export function HomeView({
  activeStarterId,
  runHistory,
  projects = [],
  activeProject,
  onCreateProject,
  onSwitchProject,
  onDeleteProject,
  onOpenTutorial,
  onImportFile,
  onSearchDatabases,
  onOpenLibrary,
  onOpenAssistant,
  onOpenChemistry,
  onOpenPeptide,
  onOpenCrispr,
  onOpenWorkflows,
  onOpenComputeNodes,
  onOpenPlugins,
  onLaunchStarter,
  onOpenLibraryItem,
}: HomeViewProps) {
  const [recent, setRecent] = useState<LibraryItem[]>([]);
  const [creating, setCreating] = useState(false);
  const [projName, setProjName] = useState('');
  const [projDesc, setProjDesc] = useState('');
  const [projTpl, setProjTpl] = useState<ProjectTemplateKind>('ligand-docking');

  useEffect(() => {
    const load = () => listLibrary().then((items) => setRecent(items.slice(0, 6)));
    void load();
    return subscribeLibrary(() => void load());
  }, []);

  const submitProject = () => {
    if (!onCreateProject) return;
    onCreateProject({
      name: projName.trim() || `Project ${projects.length + 1}`,
      description: projDesc.trim() || undefined,
      template: projTpl,
    });
    setProjName('');
    setProjDesc('');
    setCreating(false);
  };

  const actions = [
    { label: 'Import files', desc: 'mmCIF, PDB, SMILES, FASTA, or project bundle', icon: <FileUp className="h-5 w-5" />, run: onImportFile, kbd: '⌘O' },
    { label: 'Public databases', desc: 'RCSB PDB, AlphaFold DB, UniProt, PubChem', icon: <Database className="h-5 w-5" />, run: onSearchDatabases, kbd: '⌘⇧F' },
    {
      label: onOpenChemistry ? 'Design & 2D Sketcher' : 'Open your library',
      desc: onOpenChemistry ? 'Draw molecules, compute RDKit & PAINS checks' : 'Everything you have saved on this device',
      icon: onOpenChemistry ? <Atom className="h-5 w-5" /> : <Library className="h-5 w-5" />,
      run: onOpenChemistry ?? onOpenLibrary,
    },
    { label: 'AI Copilot (MCP)', desc: 'Autonomous reasoning trace, project & UI control', icon: <Bot className="h-5 w-5" />, run: onOpenAssistant },
  ];

  return (
    <div className="@container h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-8 @3xl:px-8 @3xl:py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-100">Welcome to Synlexa Studio</h1>
            <p className="mt-1.5 max-w-2xl text-sm text-slate-400">
              All-in-one computational biology &amp; chemistry workbench: create multi-molecule projects, split chains, design inhibitors in RDKit, test docking/MD on Colab GPUs, and run peptide &amp; CRISPR edits.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {onOpenTutorial && (
              <Button size="sm" variant="secondary" icon={<BookOpen className="h-4 w-4 text-emerald-400" />} onClick={onOpenTutorial}>
                Interactive Tutorial
              </Button>
            )}
            {onCreateProject && (
              <Button size="sm" variant="primary" icon={<FolderPlus className="h-4 w-4" />} onClick={() => setCreating((v) => !v)}>
                New Project
              </Button>
            )}
          </div>
        </div>

        {/* Create new project drawer */}
        {creating && onCreateProject && (
          <div className="mt-5 rounded-2xl border border-sky-400/35 bg-sky-500/[0.06] p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-100">Create New RUO Project</span>
              <button type="button" onClick={() => setCreating(false)} className="text-xs text-slate-400 hover:text-white">
                Cancel
              </button>
            </div>
            <div className="mt-3 grid gap-3 @lg:grid-cols-3">
              <Input
                value={projName}
                onChange={(e) => setProjName(e.target.value)}
                placeholder="Project name (e.g. CA-II Sulfonamide Series)"
              />
              <Input
                value={projDesc}
                onChange={(e) => setProjDesc(e.target.value)}
                placeholder="Short research objective (optional)"
              />
              <Select value={projTpl} onChange={(e) => setProjTpl(e.target.value as ProjectTemplateKind)}>
                <option value="ligand-docking">Ligand Design &amp; Binding (Vina + RDKit)</option>
                <option value="structure-compare">3D Structure Comparison &amp; Splitting</option>
                <option value="peptide-crispr">Peptide Mutation &amp; CRISPR Editing</option>
                <option value="blank">Blank Workspace</option>
              </Select>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button size="sm" variant="primary" onClick={submitProject}>
                Create &amp; Open Workspace
              </Button>
            </div>
          </div>
        )}

        {/* Active project & project switcher */}
        {projects.length > 0 && activeProject && onSwitchProject && (
          <section className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-slate-300 uppercase">
                <FolderOpen className="h-4 w-4 text-sky-300" />
                Your Projects ({projects.length})
              </div>
              <span className="text-xs text-slate-400">
                Active: <strong className="text-slate-100">{activeProject.name}</strong>
              </span>
            </div>
            <div className="mt-3 grid gap-2.5 @lg:grid-cols-3">
              {projects.map((p) => {
                const isActive = p.id === activeProject.id;
                const counts = `${p.structures.length} struct · ${p.molecules.length} mol · ${p.peptides.length + p.crisprs.length} edits`;
                return (
                  <div
                    key={p.id}
                    className={cx(
                      'flex items-start justify-between gap-2 rounded-xl border p-3 transition-colors',
                      isActive ? 'border-sky-400/50 bg-sky-500/[0.08]' : 'border-white/[0.07] bg-black/20 hover:border-white/20',
                    )}
                  >
                    <button type="button" onClick={() => onSwitchProject(p.id)} className="min-w-0 flex-1 text-left">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-slate-100">{p.name}</span>
                        {isActive && <Badge tone="accent">Active</Badge>}
                      </div>
                      <p className="mt-0.5 line-clamp-1 text-xs text-slate-400">{p.description}</p>
                      <div className="mt-1.5 text-[0.6875rem] text-slate-500">{counts}</div>
                    </button>
                    {projects.length > 1 && onDeleteProject && (
                      <button
                        type="button"
                        onClick={() => onDeleteProject(p.id)}
                        title="Delete project"
                        className="rounded p-1 text-slate-500 hover:bg-white/[0.06] hover:text-rose-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <div className="mt-6 grid gap-3 @lg:grid-cols-2 @4xl:grid-cols-4">
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={a.run}
              className="group flex flex-col items-start rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 text-left transition-colors hover:border-sky-400/40 hover:bg-sky-400/[0.04]"
            >
              <div className="flex w-full items-center justify-between">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.05] text-slate-300 group-hover:text-sky-300">
                  {a.icon}
                </span>
                {a.kbd && <Kbd>{a.kbd}</Kbd>}
              </div>
              <div className="mt-3 text-sm font-medium text-slate-100">{a.label}</div>
              <div className="mt-0.5 text-xs text-slate-400">{a.desc}</div>
            </button>
          ))}
        </div>

        {(onOpenPeptide || onOpenCrispr || onOpenWorkflows || onOpenComputeNodes || onOpenPlugins) && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {onOpenPeptide && (
              <button
                type="button"
                onClick={onOpenPeptide}
                className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-xs text-slate-300 hover:border-sky-400/40 hover:text-sky-200"
              >
                <Scissors className="h-3.5 w-3.5 text-amber-400" />
                Peptide Mutations
              </button>
            )}
            {onOpenCrispr && (
              <button
                type="button"
                onClick={onOpenCrispr}
                className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-xs text-slate-300 hover:border-sky-400/40 hover:text-sky-200"
              >
                <Dna className="h-3.5 w-3.5 text-emerald-400" />
                CRISPR &amp; Base Editing
              </button>
            )}
            {onOpenWorkflows && (
              <button
                type="button"
                onClick={onOpenWorkflows}
                className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-xs text-slate-300 hover:border-sky-400/40 hover:text-sky-200"
              >
                <GitBranch className="h-3.5 w-3.5 text-sky-400" />
                Workflow Canvas (Nextflow / Snakemake)
              </button>
            )}
            {onOpenComputeNodes && (
              <button
                type="button"
                onClick={onOpenComputeNodes}
                className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-xs text-slate-300 hover:border-sky-400/40 hover:text-sky-200"
              >
                <Cpu className="h-3.5 w-3.5 text-emerald-400" />
                Connect Colab / External GPU
              </button>
            )}
            {onOpenPlugins && (
              <button
                type="button"
                onClick={onOpenPlugins}
                className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-xs text-slate-300 hover:border-sky-400/40 hover:text-sky-200"
              >
                <Puzzle className="h-3.5 w-3.5 text-violet-400" />
                Plugins &amp; Add-ons
              </button>
            )}
          </div>
        )}

        <div className="mt-10 grid gap-8 @4xl:grid-cols-[1fr_20rem]">
          <section>
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200">
              <FlaskConical className="h-4 w-4 text-slate-500" /> Example projects
            </div>
            <div className="grid gap-3 @lg:grid-cols-2">
              {STARTER_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onLaunchStarter(p)}
                  className={cx(
                    'group rounded-2xl border p-4 text-left transition-colors',
                    activeStarterId === p.id
                      ? 'border-sky-400/50 bg-sky-400/[0.05]'
                      : 'border-white/[0.08] bg-white/[0.02] hover:border-white/20',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-medium text-slate-100">{p.title}</div>
                    <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-600 transition group-hover:translate-x-0.5 group-hover:text-sky-300" />
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">{p.subtitle}</div>
                  <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-slate-500">{p.blurb}</p>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {p.tags.slice(0, 3).map((t) => (
                      <span key={t} className="rounded-md bg-white/[0.05] px-1.5 py-0.5 text-[0.6875rem] text-slate-400">
                        {t}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </section>

          <aside className="space-y-8">
            <section>
              <div className="mb-3 flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                  <Library className="h-4 w-4 text-slate-500" /> Recent in library
                </span>
                <button type="button" onClick={onOpenLibrary} className="text-xs text-sky-300 hover:text-sky-200">
                  View all
                </button>
              </div>
              {recent.length === 0 ? (
                <p className="text-xs leading-relaxed text-slate-500">
                  Imported structures and compounds will appear here.
                </p>
              ) : (
                <ul className="space-y-0.5">
                  {recent.map((it) => (
                    <li key={it.id}>
                      <button
                        type="button"
                        onClick={() => onOpenLibraryItem(it)}
                        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.04]"
                      >
                        {KIND_ICON[it.kind]}
                        <span className="truncate text-sm text-slate-300">{it.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200">
                <History className="h-4 w-4 text-slate-500" /> Recent comparisons
              </div>
              {runHistory.length === 0 ? (
                <p className="text-xs text-slate-500">No comparisons yet.</p>
              ) : (
                <ul className="space-y-2">
                  {runHistory.slice(0, 5).map((r) => (
                    <li key={r.id} className="rounded-lg px-2 py-1 text-xs">
                      <div className="truncate text-slate-300">
                        {r.refLabel} <span className="text-slate-600">vs</span> {r.mobLabel}
                      </div>
                      <div className="mt-0.5 text-slate-500 tabular-nums">
                        RMSD {r.rmsdAngstrom.toFixed(3)} Å · {r.matchedCaCount} Cα ·{' '}
                        {new Date(r.createdAtUtc).toLocaleDateString()}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </div>

        <p className="mt-12 border-t border-white/[0.06] pt-4 text-xs text-slate-500">{RUO_DISCLAIMER}</p>
      </div>
    </div>
  );
}
