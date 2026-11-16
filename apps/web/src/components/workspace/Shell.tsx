import { useRef, useState, type ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  Atom,
  BookOpen,
  BookmarkPlus,
  Bot,
  Box,
  ChevronDown,
  Cpu,
  Database,
  Dna,
  Download,
  FileCode2,
  FileJson,
  FileUp,
  FlaskConical,
  FolderOpen,
  FolderPlus,
  GitBranch,
  GitCompareArrows,
  History,
  Home,
  Layers,
  Library,
  Loader2,
  Plus,
  Puzzle,
  Scissors,
  Search,
  Server,
  Settings,
  Split,
  Trash2,
  User,
  Wrench,
} from 'lucide-react';
import type { InspectStructureResult } from '@synlexa/wasm-bridge';
import type {
  ProjectMoleculeItem,
  ProjectStructureItem,
  ProjectTemplateKind,
  StudioProject,
} from '../../lib/projectsStore';
import type { RunHistoryEntry } from '../../lib/runHistory';
import type { StudioSession } from '../../lib/studioAuth';
import type { ToolTabId } from '../../lib/workspaceLayout';
import { Button, cx, IconButton, Input, Kbd, Menu, Select } from '../ui';

export type SidebarView = 'explorer' | 'library' | 'tools' | 'history';

// ---------------------------------------------------------------- Title bar

export function TitleBar({
  projectTitle,
  session,
  onOpenPalette,
  onOpenFile,
  onSearchDatabases,
  onOpenMcp,
  onOpenTutorial,
  onExportHtml,
  onExportJson,
  onExportBundle,
  canExport,
  onOpenAccount,
}: {
  projectTitle: string;
  session: StudioSession | null;
  onOpenPalette: () => void;
  onOpenFile: () => void;
  onSearchDatabases: () => void;
  onOpenMcp?: () => void;
  onOpenTutorial?: () => void;
  onExportHtml: () => void;
  onExportJson: () => void;
  onExportBundle: () => void;
  canExport: boolean;
  onOpenAccount: () => void;
}) {
  const initials = (session?.displayName ?? session?.email ?? '')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('');
  return (
    <header className="relative flex h-12 shrink-0 items-center gap-3 border-b border-white/[0.06] bg-[#0a0d13] px-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="text-sm font-semibold tracking-tight text-slate-100">Synlexa Studio</span>
        <span className="hidden text-slate-700 md:inline">/</span>
        <span className="hidden max-w-[18rem] truncate text-sm text-slate-400 md:inline" title={projectTitle}>
          {projectTitle}
        </span>
      </div>

      <button
        type="button"
        onClick={onOpenPalette}
        className="absolute left-1/2 hidden h-8 w-[min(25rem,30vw)] -translate-x-1/2 items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-slate-500 transition-colors hover:border-white/15 hover:text-slate-300 xl:flex"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 text-left">Search commands, tools, MCP, settings…</span>
        <Kbd>⌘K</Kbd>
      </button>

      <div className="ml-auto flex items-center gap-1.5">
        <Button size="sm" variant="ghost" icon={<FolderOpen className="h-4 w-4" />} onClick={onOpenFile}>
          <span className="hidden sm:inline">Open</span>
        </Button>
        <Button size="sm" variant="ghost" icon={<Database className="h-4 w-4" />} onClick={onSearchDatabases}>
          <span className="hidden sm:inline">Databases</span>
        </Button>
        {onOpenTutorial && (
          <Button size="sm" variant="ghost" icon={<BookOpen className="h-4 w-4 text-emerald-400" />} onClick={onOpenTutorial}>
            <span className="hidden sm:inline">Guide</span>
          </Button>
        )}
        {onOpenMcp && (
          <Button size="sm" variant="ghost" icon={<Server className="h-4 w-4 text-sky-400" />} onClick={onOpenMcp}>
            <span className="hidden sm:inline">MCP</span>
          </Button>
        )}
        <Menu
          trigger={(open, toggle) => (
            <Button size="sm" variant="secondary" onClick={toggle} icon={<Download className="h-4 w-4" />}>
              <span className="hidden sm:inline">Export</span>
              <ChevronDown className={cx('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
            </Button>
          )}
          items={[
            { label: 'HTML report', icon: <Download className="h-4 w-4" />, onSelect: onExportHtml, disabled: !canExport },
            { label: 'JSON manifest', icon: <FileJson className="h-4 w-4" />, onSelect: onExportJson, disabled: !canExport },
            { label: 'Project bundle', icon: <FileCode2 className="h-4 w-4" />, onSelect: onExportBundle },
          ]}
        />
        <button
          type="button"
          onClick={onOpenAccount}
          title={session ? `Signed in as ${session.email ?? session.displayName ?? 'user'}` : 'Account & Settings'}
          className={cx(
            'ml-1 flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition',
            session
              ? 'bg-gradient-to-br from-blue-500 to-blue-700 text-white'
              : 'border border-white/10 bg-white/[0.04] text-slate-400 hover:text-slate-200',
          )}
        >
          {session ? initials || <User className="h-4 w-4" /> : <User className="h-4 w-4" />}
        </button>
      </div>
    </header>
  );
}

// ------------------------------------------------------------- Activity rail

export function ActivityRail({
  view,
  sidebarOpen,
  onSelect,
  onOpenSettings,
  onOpenAssistant,
  onOpenMcp,
  libraryCount,
}: {
  view: SidebarView;
  sidebarOpen: boolean;
  onSelect: (v: SidebarView) => void;
  onOpenSettings: () => void;
  onOpenAssistant: () => void;
  onOpenMcp?: () => void;
  libraryCount: number;
}) {
  const items: Array<{ id: SidebarView; label: string; icon: ReactNode }> = [
    { id: 'explorer', label: 'Workspace', icon: <Layers className="h-5 w-5" /> },
    { id: 'library', label: 'Library', icon: <Library className="h-5 w-5" /> },
    { id: 'tools', label: 'Tools', icon: <Wrench className="h-5 w-5" /> },
    { id: 'history', label: 'History', icon: <History className="h-5 w-5" /> },
  ];
  return (
    <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-white/[0.06] bg-[#0a0d13] py-2">
      {items.map((it) => {
        const active = sidebarOpen && view === it.id;
        return (
          <button
            key={it.id}
            type="button"
            title={it.label}
            aria-label={it.label}
            onClick={() => onSelect(it.id)}
            className={cx(
              'relative flex h-11 w-11 flex-col items-center justify-center rounded-xl transition-colors',
              active ? 'bg-white/[0.08] text-slate-100' : 'text-slate-500 hover:bg-white/[0.04] hover:text-slate-200',
            )}
          >
            {active && <span className="absolute top-2 bottom-2 -left-1.5 w-0.5 rounded-full bg-sky-400" />}
            {it.icon}
            {it.id === 'library' && libraryCount > 0 && (
              <span className="absolute top-1 right-1 min-w-4 rounded-full bg-sky-500 px-1 text-[0.625rem] leading-4 font-semibold text-slate-950">
                {libraryCount > 99 ? '99+' : libraryCount}
              </span>
            )}
          </button>
        );
      })}
      <div className="flex-1" />
      {onOpenMcp && (
        <button
          type="button"
          title="In-App MCP Server"
          aria-label="In-App MCP Server"
          onClick={onOpenMcp}
          className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-white/[0.04] hover:text-sky-300"
        >
          <Server className="h-5 w-5" />
        </button>
      )}
      <button
        type="button"
        title="AI Assistant"
        aria-label="AI Assistant"
        onClick={onOpenAssistant}
        className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-white/[0.04] hover:text-sky-300"
      >
        <Bot className="h-5 w-5" />
      </button>
      <button
        type="button"
        title="Settings (⌘,)"
        aria-label="Settings"
        onClick={onOpenSettings}
        className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-white/[0.04] hover:text-slate-200"
      >
        <Settings className="h-5 w-5" />
      </button>
    </nav>
  );
}

// ------------------------------------------------------------ Sidebar frame

export function SidebarFrame({ title, actions, children, width }: { title: string; actions?: ReactNode; children: ReactNode; width: number }) {
  return (
    <aside style={{ width }} className="flex shrink-0 flex-col border-r border-white/[0.06] bg-[#0c1017]">
      <div className="flex h-10 shrink-0 items-center justify-between px-3">
        <span className="text-xs font-semibold tracking-wide text-slate-400 uppercase">{title}</span>
        <div className="flex items-center gap-0.5">{actions}</div>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </aside>
  );
}

// ---------------------------------------------------------- Explorer panel

interface StructureSlotProps {
  role: 'reference' | 'mobile';
  label: string;
  inspect: InspectStructureResult | null;
  chain: string;
  onChangeChain: (c: string) => void;
  onReplace: () => void;
  onSaveToLibrary: () => void;
  hasContent: boolean;
}

function StructureSlot({ role, label, inspect, chain, onChangeChain, onReplace, onSaveToLibrary, hasContent }: StructureSlotProps) {
  const isRef = role === 'reference';
  const needsChain = inspect && inspect.chains.length > 1 && !chain;
  return (
    <div className={cx('rounded-xl border p-3', needsChain ? 'border-amber-500/40 bg-amber-500/[0.04]' : 'border-white/[0.07] bg-white/[0.02]')}>
      <div className="flex items-center justify-between">
        <span className={cx('text-[0.6875rem] font-semibold tracking-wide uppercase', isRef ? 'text-sky-300' : 'text-emerald-300')}>
          {isRef ? 'Reference' : 'Comparison'}
        </span>
        <div className="flex items-center">
          {hasContent && (
            <IconButton label="Save to library" onClick={onSaveToLibrary}>
              <BookmarkPlus className="h-4 w-4" />
            </IconButton>
          )}
          <IconButton label={`Replace ${isRef ? 'reference' : 'comparison'} file`} onClick={onReplace}>
            <FileUp className="h-4 w-4" />
          </IconButton>
        </div>
      </div>
      {hasContent ? (
        <>
          <div className="mt-1 truncate text-sm font-medium text-slate-100" title={label}>
            {label}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">
            {inspect
              ? `${inspect.format.toUpperCase()} · ${inspect.chains.length} chain${inspect.chains.length === 1 ? '' : 's'} · ${inspect.confidenceKind === 'prediction_plddt' ? 'predicted' : inspect.confidenceKind === 'experimental_b_factor' ? 'experimental' : 'unknown confidence'}`
              : 'Reading…'}
          </div>
          {inspect && inspect.chains.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1">
              {inspect.chains.map((c) => (
                <button
                  key={c.chainId}
                  type="button"
                  onClick={() => onChangeChain(c.chainId)}
                  title={`${c.observedCaCount} observed Cα`}
                  className={cx(
                    'rounded-md border px-2 py-1 font-mono text-xs transition-colors',
                    chain === c.chainId
                      ? isRef
                        ? 'border-sky-400/50 bg-sky-400/15 text-sky-200'
                        : 'border-emerald-400/50 bg-emerald-400/15 text-emerald-200'
                      : 'border-white/10 text-slate-400 hover:border-white/25 hover:text-slate-200',
                  )}
                >
                  {c.chainId}
                </button>
              ))}
            </div>
          )}
          {needsChain && <div className="mt-2 text-xs text-amber-300">Pick a chain to run the comparison.</div>}
        </>
      ) : (
        <button type="button" onClick={onReplace} className="mt-1.5 text-sm text-slate-400 hover:text-sky-300">
          Load a structure…
        </button>
      )}
    </div>
  );
}

export function ExplorerPanel(props: {
  refLabel: string;
  mobLabel: string;
  refInspect: InspectStructureResult | null;
  mobInspect: InspectStructureResult | null;
  refChain: string;
  mobChain: string;
  hasRef: boolean;
  hasMob: boolean;
  paePresent: boolean;
  chainError: string | null;
  onChangeRefChain: (c: string) => void;
  onChangeMobChain: (c: string) => void;
  onUploadFiles: (files: FileList, role: 'reference' | 'mobile' | 'auto') => void;
  onSaveToLibrary: (role: 'reference' | 'mobile') => void;
  onSearchDatabases: () => void;
  onLoadExample: () => void;
  projects?: StudioProject[];
  activeProject?: StudioProject | null;
  onCreateProject?: (input: { name: string; template: ProjectTemplateKind }) => void;
  onSwitchProject?: (projectId: string) => void;
  onSplitStructure?: (role: 'reference' | 'mobile') => void;
  onLoadProjectStructure?: (item: ProjectStructureItem, role: 'reference' | 'mobile') => void;
  onOpenProjectMolecule?: (mol: ProjectMoleculeItem) => void;
  onDockMolecule?: (mol: ProjectMoleculeItem) => void;
  onRemoveProjectAsset?: (kind: 'structure' | 'molecule' | 'peptide' | 'crispr', id: string) => void;
  onOpenChemistry?: () => void;
  onOpenPeptide?: () => void;
  onOpenCrispr?: () => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const roleRef = useRef<'reference' | 'mobile' | 'auto'>('auto');
  const [dragOver, setDragOver] = useState(false);
  const [creatingProj, setCreatingProj] = useState(false);
  const [newProjName, setNewProjName] = useState('');
  const [newProjTpl, setNewProjTpl] = useState<ProjectTemplateKind>('ligand-docking');

  const pick = (role: 'reference' | 'mobile' | 'auto') => {
    roleRef.current = role;
    fileRef.current?.click();
  };

  const handleCreate = () => {
    if (!props.onCreateProject) return;
    props.onCreateProject({ name: newProjName.trim() || 'Untitled Research Project', template: newProjTpl });
    setNewProjName('');
    setCreatingProj(false);
  };

  return (
    <div
      className="relative flex h-full flex-col overflow-y-auto px-3 pb-4"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragOver(false);
        props.onUploadFiles(e.dataTransfer.files, 'auto');
      }}
    >
      <input
        ref={fileRef}
        type="file"
        multiple
        accept=".cif,.mmcif,.pdb,.ent,.json,.fasta,.fa,.smi"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) props.onUploadFiles(e.target.files, roleRef.current);
          e.target.value = '';
        }}
      />

      {props.projects && props.activeProject && props.onSwitchProject && (
        <div className="mb-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-2.5">
          <div className="flex items-center justify-between gap-1.5">
            <span className="text-[0.6875rem] font-semibold tracking-wide text-slate-400 uppercase">Project</span>
            {props.onCreateProject && (
              <button
                type="button"
                onClick={() => setCreatingProj((v) => !v)}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.6875rem] text-sky-300 hover:bg-sky-500/10"
              >
                <FolderPlus className="h-3 w-3" />
                New
              </button>
            )}
          </div>
          <Select
            value={props.activeProject.id}
            onChange={(e) => props.onSwitchProject?.(e.target.value)}
            className="mt-1.5 h-8 text-xs"
          >
            {props.projects.map((proj) => (
              <option key={proj.id} value={proj.id}>
                {proj.name}
              </option>
            ))}
          </Select>

          {creatingProj && (
            <div className="mt-2 space-y-1.5 border-t border-white/[0.06] pt-2">
              <Input
                value={newProjName}
                onChange={(e) => setNewProjName(e.target.value)}
                placeholder="Project name…"
                className="h-7 text-xs"
              />
              <Select
                value={newProjTpl}
                onChange={(e) => setNewProjTpl(e.target.value as ProjectTemplateKind)}
                className="h-7 text-xs"
              >
                <option value="structure-compare">Structure Compare</option>
                <option value="ligand-docking">Ligand Design & Binding</option>
                <option value="peptide-crispr">Peptide & CRISPR Test</option>
                <option value="blank">Blank Workspace</option>
              </Select>
              <div className="flex gap-1.5">
                <Button size="sm" variant="primary" className="flex-1" onClick={handleCreate}>
                  Create
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setCreatingProj(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        <StructureSlot
          role="reference"
          label={props.refLabel}
          inspect={props.refInspect}
          chain={props.refChain}
          onChangeChain={props.onChangeRefChain}
          onReplace={() => pick('reference')}
          onSaveToLibrary={() => props.onSaveToLibrary('reference')}
          hasContent={props.hasRef}
        />
        <StructureSlot
          role="mobile"
          label={props.mobLabel}
          inspect={props.mobInspect}
          chain={props.mobChain}
          onChangeChain={props.onChangeMobChain}
          onReplace={() => pick('mobile')}
          onSaveToLibrary={() => props.onSaveToLibrary('mobile')}
          hasContent={props.hasMob}
        />
        {(props.hasRef || props.hasMob) && props.onSplitStructure && (
          <div className="flex gap-1.5">
            {props.hasRef && (
              <Button
                size="sm"
                variant="secondary"
                className="flex-1 text-[0.6875rem]"
                icon={<Split className="h-3 w-3" />}
                onClick={() => props.onSplitStructure?.('reference')}
                title="Split Reference chains & non-water HETATM ligands into project assets"
              >
                Split Ref
              </Button>
            )}
            {props.hasMob && (
              <Button
                size="sm"
                variant="secondary"
                className="flex-1 text-[0.6875rem]"
                icon={<Split className="h-3 w-3" />}
                onClick={() => props.onSplitStructure?.('mobile')}
                title="Split Comparison chains & non-water HETATM ligands into project assets"
              >
                Split Comp
              </Button>
            )}
          </div>
        )}
        <div className="flex items-center gap-2 px-1 pt-1 text-xs text-slate-500">
          <span className={cx('h-1.5 w-1.5 rounded-full', props.paePresent ? 'bg-emerald-400' : 'bg-slate-600')} />
          {props.paePresent ? 'PAE matrix loaded' : 'No PAE matrix'}
        </div>
        {props.chainError && (
          <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-2.5 text-xs leading-relaxed text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {props.chainError}
          </div>
        )}
      </div>

      <div className="mt-3 space-y-1.5">
        <Button className="w-full" variant="primary" size="sm" icon={<FileUp className="h-3.5 w-3.5" />} onClick={() => pick('auto')}>
          Import structures / files
        </Button>
        <Button className="w-full" size="sm" icon={<Database className="h-3.5 w-3.5" />} onClick={props.onSearchDatabases}>
          Search public databases
        </Button>
        <div className="grid grid-cols-3 gap-1 pt-0.5">
          {props.onOpenChemistry && (
            <Button size="sm" variant="secondary" className="text-[0.6875rem]" icon={<Plus className="h-3 w-3" />} onClick={props.onOpenChemistry}>
              Mol
            </Button>
          )}
          {props.onOpenPeptide && (
            <Button size="sm" variant="secondary" className="text-[0.6875rem]" icon={<Scissors className="h-3 w-3" />} onClick={props.onOpenPeptide}>
              Pep
            </Button>
          )}
          {props.onOpenCrispr && (
            <Button size="sm" variant="secondary" className="text-[0.6875rem]" icon={<Dna className="h-3 w-3" />} onClick={props.onOpenCrispr}>
              CRISPR
            </Button>
          )}
        </div>
      </div>

      {props.activeProject &&
        (props.activeProject.structures.length > 0 ||
          props.activeProject.molecules.length > 0 ||
          props.activeProject.peptides.length > 0 ||
          props.activeProject.crisprs.length > 0) && (
          <div className="mt-4 space-y-2 border-t border-white/[0.06] pt-3">
            <div className="text-[0.6875rem] font-semibold tracking-wide text-slate-400 uppercase">
              Project Assets ({props.activeProject.structures.length + props.activeProject.molecules.length + props.activeProject.peptides.length + props.activeProject.crisprs.length})
            </div>

            {props.activeProject.structures.map((s) => (
              <div key={s.id} className="flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1.5 text-xs">
                <Box className="h-3.5 w-3.5 shrink-0 text-sky-300" />
                <span className="min-w-0 flex-1 truncate text-slate-200" title={s.label}>
                  {s.label}
                </span>
                {props.onLoadProjectStructure && (
                  <>
                    <button
                      type="button"
                      onClick={() => props.onLoadProjectStructure?.(s, 'reference')}
                      className="rounded px-1 py-0.5 text-[0.625rem] text-sky-300 hover:bg-sky-500/15"
                      title="Load as Reference"
                    >
                      Ref
                    </button>
                    <button
                      type="button"
                      onClick={() => props.onLoadProjectStructure?.(s, 'mobile')}
                      className="rounded px-1 py-0.5 text-[0.625rem] text-emerald-300 hover:bg-emerald-500/15"
                      title="Load as Comparison"
                    >
                      Comp
                    </button>
                  </>
                )}
              </div>
            ))}

            {props.activeProject.molecules.map((m) => (
              <div key={m.id} className="flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1.5 text-xs">
                <Atom className="h-3.5 w-3.5 shrink-0 text-violet-300" />
                <button
                  type="button"
                  onClick={() => props.onOpenProjectMolecule?.(m)}
                  className="min-w-0 flex-1 truncate text-left text-slate-200 hover:text-sky-300"
                  title={m.smiles}
                >
                  {m.name}
                </button>
                {props.onDockMolecule && (
                  <button
                    type="button"
                    onClick={() => props.onDockMolecule?.(m)}
                    className="inline-flex items-center gap-0.5 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[0.625rem] text-emerald-300 hover:bg-emerald-500/20"
                    title="Test binding / AutoDock Vina against active protein"
                  >
                    <FlaskConical className="h-2.5 w-2.5" />
                    Bind
                  </button>
                )}
                {props.onRemoveProjectAsset && (
                  <button
                    type="button"
                    onClick={() => props.onRemoveProjectAsset?.('molecule', m.id)}
                    className="text-slate-500 hover:text-rose-400"
                    aria-label={`Remove ${m.name}`}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}

            {props.activeProject.peptides.map((pep) => (
              <div key={pep.id} className="flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1.5 text-xs">
                <Scissors className="h-3.5 w-3.5 shrink-0 text-amber-300" />
                <button
                  type="button"
                  onClick={() => props.onOpenPeptide?.()}
                  className="min-w-0 flex-1 truncate text-left text-slate-200 hover:text-sky-300"
                >
                  {pep.name}
                </button>
              </div>
            ))}

            {props.activeProject.crisprs.map((cr) => (
              <div key={cr.id} className="flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1.5 text-xs">
                <Dna className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
                <button
                  type="button"
                  onClick={() => props.onOpenCrispr?.()}
                  className="min-w-0 flex-1 truncate text-left text-slate-200 hover:text-sky-300"
                >
                  {cr.name}
                </button>
              </div>
            ))}
          </div>
        )}

      <div
        className={cx(
          'mt-4 rounded-xl border border-dashed px-3 py-4 text-center text-xs leading-relaxed transition-colors',
          dragOver ? 'border-sky-400/70 bg-sky-400/10 text-sky-200' : 'border-white/10 text-slate-500',
        )}
      >
        Drop .cif / .pdb / PAE .json / .fasta / .smi / .synlexa.bundle.json here
      </div>

      <button type="button" onClick={props.onLoadExample} className="mt-3 text-xs text-slate-500 hover:text-sky-300">
        Load example comparison (CA II)
      </button>
    </div>
  );
}

// ------------------------------------------------------------- Tools panel

export const TOOL_ENTRIES: Array<{
  id: ToolTabId;
  group: 'Structures & 3D' | 'Design & Editing' | 'Pipelines & GPU' | 'Agent & Workspace';
  label: string;
  desc: string;
  icon: ReactNode;
}> = [
  { id: 'viewer', group: 'Structures & 3D', label: '3D Viewer', desc: 'Superposed structures, residue picking, distances', icon: <Box className="h-4 w-4" /> },
  { id: 'results', group: 'Structures & 3D', label: 'Results', desc: 'RMSD, coverage, confidence, PAE, exports', icon: <Layers className="h-4 w-4" /> },
  { id: 'sequence', group: 'Structures & 3D', label: 'Sequence deviation', desc: 'Per-residue Δd along the alignment', icon: <GitCompareArrows className="h-4 w-4" /> },
  { id: 'ramachandran', group: 'Structures & 3D', label: 'Ramachandran', desc: 'Backbone φ/ψ and Cα contacts', icon: <Activity className="h-4 w-4" /> },
  { id: 'chemistry', group: 'Design & Editing', label: 'Ligands & 2D Sketcher', desc: 'RDKit WASM, PAINS alerts, 2D editor', icon: <Atom className="h-4 w-4" /> },
  { id: 'peptide', group: 'Design & Editing', label: 'Peptide engineering', desc: 'Point mutations, pI, charge, 3D contacts', icon: <Scissors className="h-4 w-4" /> },
  { id: 'crispr', group: 'Design & Editing', label: 'Gene & CRISPR', desc: 'Codon edits and PAM sites', icon: <Dna className="h-4 w-4" /> },
  { id: 'workflow', group: 'Pipelines & GPU', label: 'Workflow Canvas', desc: 'DAG pipelines + Nextflow/Snakemake', icon: <GitBranch className="h-4 w-4" /> },
  { id: 'compute', group: 'Pipelines & GPU', label: 'GPU & Compute Nodes', desc: 'Colab, Vina, OpenMM, Boltz-2, PySCF', icon: <Cpu className="h-4 w-4" /> },
  { id: 'plugins', group: 'Pipelines & GPU', label: 'Plugins & Add-ons', desc: 'Open-source tools & license ledger', icon: <Puzzle className="h-4 w-4" /> },
  { id: 'assistant', group: 'Agent & Workspace', label: 'AI Assistant', desc: 'Reasoning trace, octopus tools, search', icon: <Bot className="h-4 w-4" /> },
  { id: 'mcp', group: 'Agent & Workspace', label: 'MCP Server', desc: 'In-app MCP & Claude/Codex bridge', icon: <Server className="h-4 w-4" /> },
  { id: 'library', group: 'Agent & Workspace', label: 'Library manager', desc: 'Organize saved molecules', icon: <Library className="h-4 w-4" /> },
  { id: 'home', group: 'Agent & Workspace', label: 'Start page', desc: 'Projects, tutorial, quick actions', icon: <Home className="h-4 w-4" /> },
];

const TOOL_GROUPS: Array<ToolEntryGroup> = [
  'Structures & 3D',
  'Design & Editing',
  'Pipelines & GPU',
  'Agent & Workspace',
];
type ToolEntryGroup = 'Structures & 3D' | 'Design & Editing' | 'Pipelines & GPU' | 'Agent & Workspace';

export function ToolsPanel({
  openTabs,
  onOpen,
}: {
  openTabs: Set<ToolTabId>;
  onOpen: (id: ToolTabId, toSide: boolean) => void;
}) {
  return (
    <div className="h-full overflow-y-auto px-2 pb-4">
      <p className="px-2 pb-2 text-xs text-slate-500">Click to open a tab. Alt-click splits side-by-side.</p>
      <div className="space-y-3">
        {TOOL_GROUPS.map((groupName) => (
          <div key={groupName}>
            <div className="px-2.5 pb-1 text-[0.6875rem] font-semibold tracking-wider text-slate-500 uppercase">
              {groupName}
            </div>
            <ul className="space-y-0.5">
              {TOOL_ENTRIES.filter((t) => t.group === groupName).map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={(e) => onOpen(t.id, e.altKey)}
                    className="group flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-white/[0.04]"
                  >
                    <span className="mt-0.5 text-slate-500 group-hover:text-sky-300">{t.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-[0.8125rem] text-slate-200">
                        {t.label}
                        {openTabs.has(t.id) && <span className="h-1.5 w-1.5 rounded-full bg-sky-400" title="Open" />}
                      </span>
                      <span className="block truncate text-xs text-slate-500">{t.desc}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

// ----------------------------------------------------------- History panel

export function HistoryPanel({ runs, onClear }: { runs: RunHistoryEntry[]; onClear: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {runs.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-slate-500">Comparisons you run appear here.</p>
        ) : (
          <ul className="space-y-1">
            {runs.map((r) => (
              <li key={r.id} className="rounded-lg px-2.5 py-2 hover:bg-white/[0.03]">
                <div className="truncate text-[0.8125rem] text-slate-200">
                  {r.refLabel} <span className="text-slate-600">vs</span> {r.mobLabel}
                </div>
                <div className="mt-0.5 flex justify-between text-xs text-slate-500 tabular-nums">
                  <span>
                    {r.rmsdAngstrom.toFixed(3)} Å · {r.matchedCaCount} Cα · {r.refChain}/{r.mobChain}
                  </span>
                  <span>{new Date(r.createdAtUtc).toLocaleDateString()}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {runs.length > 0 && (
        <div className="border-t border-white/[0.06] p-2">
          <Button size="sm" variant="ghost" className="w-full" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={onClear}>
            Clear history
          </Button>
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------- Status bar

export function StatusBar({
  busyLabel,
  wasmReady,
  rendererMode,
  rmsd,
  focusedSeqId,
  computeNodeLabel,
  computeOnline,
  onOpenComputeNodes,
  aiLabel,
  aiReady,
  onOpenAiSettings,
}: {
  busyLabel: string | null;
  wasmReady: boolean;
  rendererMode: 'webgl2' | 'canvas2d-fallback';
  rmsd: number | null;
  focusedSeqId: number | null;
  computeNodeLabel?: string | null;
  computeOnline?: boolean;
  onOpenComputeNodes?: () => void;
  aiLabel: string;
  aiReady: boolean;
  onOpenAiSettings: () => void;
}) {
  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-white/[0.06] bg-[#0a0d13] px-3 text-[0.6875rem] text-slate-500">
      <span className="flex items-center gap-1.5">
        {busyLabel ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin text-sky-400" />
            <span className="text-slate-300">{busyLabel}</span>
          </>
        ) : (
          <>
            <span className={cx('h-1.5 w-1.5 rounded-full', wasmReady ? 'bg-emerald-400' : 'bg-amber-400')} />
            {wasmReady ? 'Engine ready' : 'Starting engine…'}
          </>
        )}
      </span>
      <span className="hidden items-center gap-1 sm:flex">
        <Cpu className="h-3 w-3" /> {rendererMode === 'webgl2' ? 'WebGL2' : 'Canvas fallback'}
      </span>
      {onOpenComputeNodes && (
        <button type="button" onClick={onOpenComputeNodes} className="hidden items-center gap-1.5 hover:text-slate-300 md:flex">
          <span className={cx('h-1.5 w-1.5 rounded-full', computeOnline ? 'bg-emerald-400' : 'bg-slate-600')} />
          {computeNodeLabel ? `GPU: ${computeNodeLabel}` : 'Connect Colab / GPU'}
        </button>
      )}
      {rmsd !== null && <span className="tabular-nums">RMSD {rmsd.toFixed(3)} Å</span>}
      {focusedSeqId !== null && <span className="tabular-nums">Residue {focusedSeqId}</span>}
      <div className="flex-1" />
      <button type="button" onClick={onOpenAiSettings} className="flex items-center gap-1.5 hover:text-slate-300">
        <Bot className={cx('h-3 w-3', aiReady ? 'text-sky-400' : 'text-slate-600')} />
        {aiLabel}
      </button>
      <span className="font-medium text-amber-400/80">Research use only</span>
    </footer>
  );
}
