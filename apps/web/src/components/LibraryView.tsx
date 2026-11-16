import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  Atom,
  Box,
  Copy,
  Download,
  Dna,
  FileUp,
  FolderInput,
  MoreHorizontal,
  Pencil,
  Search,
  Star,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  deleteLibraryItems,
  detectFormat,
  duplicateLibraryItem,
  exportLibrary,
  formatBytes,
  importLibrary,
  listLibrary,
  subscribeLibrary,
  updateLibraryItem,
  addToLibrary,
  type LibraryItem,
  type LibraryKind,
} from '../lib/moleculeLibrary';
import { RUO_DISCLAIMER } from '../lib/reportGenerator';
import { getSettings } from '../lib/appSettings';
import { Badge, Button, cx, EmptyState, IconButton, Input, Menu, Modal, Textarea, useFeedback } from './ui';

export type LibraryOpenTarget = 'reference' | 'mobile' | 'auto';

interface LibraryViewProps {
  compact?: boolean;
  onOpenItem: (item: LibraryItem, target: LibraryOpenTarget) => void;
  /** Labels currently loaded, to show "On screen" state. */
  loadedShas?: Set<string>;
}

const KIND_META: Record<LibraryKind, { label: string; icon: ReactElement; tone: string }> = {
  structure: { label: 'Structure', icon: <Box className="h-4 w-4" />, tone: 'text-sky-300' },
  compound: { label: 'Compound', icon: <Atom className="h-4 w-4" />, tone: 'text-violet-300' },
  sequence: { label: 'Sequence', icon: <Dna className="h-4 w-4" />, tone: 'text-emerald-300' },
};

function download(filename: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function relTime(iso: string | null): string {
  if (!iso) return '—';
  const d = Date.now() - Date.parse(iso);
  if (d < 60_000) return 'just now';
  if (d < 3600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86400_000) return `${Math.floor(d / 3600_000)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function LibraryView({ compact = false, onOpenItem, loadedShas }: LibraryViewProps) {
  const { toast, confirm } = useFeedback();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<LibraryKind | 'all' | 'favorites'>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<LibraryItem | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const importRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const refresh = () =>
      listLibrary()
        .then(setItems)
        .finally(() => setLoading(false));
    void refresh();
    return subscribeLibrary(() => void refresh());
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => {
      if (kind === 'favorites' && !i.favorite) return false;
      if (kind !== 'all' && kind !== 'favorites' && i.kind !== kind) return false;
      if (!q) return true;
      return (
        i.name.toLowerCase().includes(q) ||
        i.tags.some((t) => t.toLowerCase().includes(q)) ||
        i.notes.toLowerCase().includes(q) ||
        (i.source.accession ?? '').toLowerCase().includes(q) ||
        (i.kind === 'compound' && i.content.toLowerCase().includes(q))
      );
    });
  }, [items, query, kind]);

  const addFiles = async (files: FileList | File[]) => {
    let added = 0;
    let dupes = 0;
    for (const f of Array.from(files)) {
      const det = detectFormat(f.name);
      if (!det) {
        toast(`${f.name}: unsupported file type. Use .cif, .pdb, .smi, or .fasta.`, 'warn');
        continue;
      }
      let content = await f.text();
      let name = f.name.replace(/\.[^.]+$/, '');
      if (det.kind === 'compound') {
        const line = content.split(/\r?\n/).find((l) => l.trim()) ?? '';
        const [smi, ...rest] = line.trim().split(/\s+/);
        content = smi ?? '';
        if (rest.length) name = rest.join(' ');
      }
      if (!content.trim()) continue;
      const { duplicate } = await addToLibrary({
        kind: det.kind,
        format: det.format,
        name,
        content,
        source: {
          database: null,
          accession: null,
          sourceUrl: null,
          license: null,
          retrievedAtUtc: null,
          origin: 'local-file',
        },
      });
      if (duplicate) dupes++;
      else added++;
    }
    if (added) toast(`Added ${added} item${added > 1 ? 's' : ''} to your library`, 'success');
    if (dupes) toast(`${dupes} already in library (identical content)`, 'info');
  };

  const removeIds = async (ids: string[]) => {
    if (ids.length === 0) return;
    if (getSettings().confirmDeletes) {
      const ok = await confirm({
        title: ids.length > 1 ? `Delete ${ids.length} items?` : 'Delete item?',
        message:
          'This removes the stored copy from this device. Structures already loaded on screen stay open. This cannot be undone.',
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!ok) return;
    }
    await deleteLibraryItems(ids);
    setSelected(new Set());
    toast(`Deleted ${ids.length} item${ids.length > 1 ? 's' : ''}`, 'success');
  };

  const exportItems = async (ids?: string[]) => {
    const data = await exportLibrary(RUO_DISCLAIMER, ids);
    download(
      `synlexa-library-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(data, null, 2),
      'application/json',
    );
  };

  const itemMenu = (it: LibraryItem) => (
    <Menu
      trigger={(_, toggle) => (
        <IconButton label="More actions" onClick={(e) => (e.stopPropagation(), toggle())}>
          <MoreHorizontal className="h-4 w-4" />
        </IconButton>
      )}
      items={[
        ...(it.kind === 'structure'
          ? [
              { label: 'Load as Reference', icon: <FolderInput className="h-4 w-4" />, onSelect: () => onOpenItem(it, 'reference') },
              { label: 'Load as Comparison (mobile)', icon: <FolderInput className="h-4 w-4" />, onSelect: () => onOpenItem(it, 'mobile') },
            ]
          : [{ label: 'Open in workspace', icon: <FolderInput className="h-4 w-4" />, onSelect: () => onOpenItem(it, 'auto') }]),
        'divider' as const,
        { label: 'Edit details', icon: <Pencil className="h-4 w-4" />, onSelect: () => setEditing(it) },
        {
          label: it.favorite ? 'Remove from favorites' : 'Add to favorites',
          icon: <Star className="h-4 w-4" />,
          onSelect: () => void updateLibraryItem(it.id, { favorite: !it.favorite }),
        },
        { label: 'Duplicate', icon: <Copy className="h-4 w-4" />, onSelect: () => void duplicateLibraryItem(it.id) },
        {
          label: 'Download file',
          icon: <Download className="h-4 w-4" />,
          onSelect: () =>
            download(
              `${it.name}.${it.format === 'smiles' ? 'smi' : it.format}`,
              it.kind === 'compound' ? `${it.content} ${it.name}\n` : it.content,
              'text/plain',
            ),
        },
        'divider' as const,
        { label: 'Delete', icon: <Trash2 className="h-4 w-4" />, danger: true, onSelect: () => void removeIds([it.id]) },
      ]}
    />
  );

  const filters: Array<{ id: typeof kind; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'structure', label: 'Structures' },
    { id: 'compound', label: 'Compounds' },
    { id: 'sequence', label: 'Sequences' },
    { id: 'favorites', label: '★' },
  ];

  return (
    <div
      className={cx('@container relative flex h-full min-h-0 flex-col', !compact && 'bg-[#0f131b]')}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragOver(false);
        void addFiles(e.dataTransfer.files);
      }}
    >
      <input
        ref={fileRef}
        type="file"
        multiple
        accept=".cif,.mmcif,.pdb,.ent,.smi,.fasta,.fa,.faa"
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void addFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={importRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            const n = await importLibrary(await f.text());
            toast(`Imported ${n} new item${n === 1 ? '' : 's'}`, 'success');
          } catch (err) {
            toast(err instanceof Error ? err.message : String(err), 'error');
          }
        }}
      />

      {/* Header */}
      <div className={cx('shrink-0 space-y-2.5', compact ? 'px-3 pt-1 pb-2.5' : 'border-b border-white/[0.06] px-6 pt-5 pb-4')}>
        {!compact && (
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold text-slate-100">Library</h1>
              <p className="mt-0.5 text-sm text-slate-400">
                {items.length} item{items.length === 1 ? '' : 's'} stored on this device ·{' '}
                {formatBytes(items.reduce((s, i) => s + i.sizeBytes, 0))}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" icon={<Upload className="h-3.5 w-3.5" />} onClick={() => importRef.current?.click()}>
                Import library
              </Button>
              <Button size="sm" variant="ghost" icon={<Download className="h-3.5 w-3.5" />} onClick={() => void exportItems()} disabled={!items.length}>
                Export all
              </Button>
              <Button size="sm" variant="primary" icon={<FileUp className="h-3.5 w-3.5" />} onClick={() => fileRef.current?.click()}>
                Add files
              </Button>
            </div>
          </div>
        )}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, tag, accession…"
              className={cx('pl-8', compact && 'h-8 text-[0.8125rem]')}
            />
          </div>
          {compact && (
            <IconButton label="Add files to library" onClick={() => fileRef.current?.click()} className="h-8 w-8">
              <FileUp className="h-4 w-4" />
            </IconButton>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setKind(f.id)}
              className={cx(
                'rounded-md px-2 py-1 text-xs transition-colors',
                kind === f.id ? 'bg-white/[0.1] text-slate-100' : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-200',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        {!compact && selected.size > 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-sky-500/20 bg-sky-500/[0.06] px-3 py-2 text-sm">
            <span className="text-sky-200">{selected.size} selected</span>
            <div className="flex-1" />
            <Button size="sm" variant="ghost" onClick={() => void exportItems(Array.from(selected))}>
              Export
            </Button>
            <Button size="sm" variant="danger" onClick={() => void removeIds(Array.from(selected))}>
              Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        )}
      </div>

      {/* List */}
      <div className={cx('min-h-0 flex-1 overflow-y-auto', compact ? 'px-1.5 pb-3' : 'px-4 py-3')}>
        {loading ? null : filtered.length === 0 ? (
          <EmptyState
            icon={<Box className="h-7 w-7" />}
            title={items.length === 0 ? 'Your library is empty' : 'No matches'}
            description={
              items.length === 0
                ? 'Drop .cif, .pdb, .smi, or .fasta files here, or import from a public database. With auto-save on, every import is saved here.'
                : 'Try a different search or filter.'
            }
            action={
              items.length === 0 ? (
                <Button size="sm" icon={<FileUp className="h-3.5 w-3.5" />} onClick={() => fileRef.current?.click()}>
                  Add files
                </Button>
              ) : undefined
            }
          />
        ) : compact ? (
          <ul className="space-y-0.5">
            {filtered.map((it) => {
              const km = KIND_META[it.kind];
              const onScreen = loadedShas?.has(it.sha256);
              return (
                <li
                  key={it.id}
                  className="group flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-white/[0.04]"
                  onDoubleClick={() => onOpenItem(it, 'auto')}
                  title="Double-click to open"
                >
                  <span className={cx('shrink-0', km.tone)}>{km.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[0.8125rem] text-slate-200">{it.name}</span>
                      {it.favorite && <Star className="h-3 w-3 shrink-0 fill-amber-300 text-amber-300" />}
                    </div>
                    <div className="truncate text-[0.6875rem] text-slate-500">
                      {onScreen ? <span className="text-emerald-400">On screen</span> : km.label} · {formatBytes(it.sizeBytes)}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    {it.kind === 'structure' ? (
                      <>
                        <button
                          type="button"
                          onClick={() => onOpenItem(it, 'reference')}
                          className="rounded px-1.5 py-1 text-[0.6875rem] font-semibold text-sky-300 hover:bg-sky-500/15"
                          title="Load as Reference"
                        >
                          REF
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenItem(it, 'mobile')}
                          className="rounded px-1.5 py-1 text-[0.6875rem] font-semibold text-emerald-300 hover:bg-emerald-500/15"
                          title="Load as Comparison"
                        >
                          CMP
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onOpenItem(it, 'auto')}
                        className="rounded px-1.5 py-1 text-[0.6875rem] font-semibold text-sky-300 hover:bg-sky-500/15"
                      >
                        Open
                      </button>
                    )}
                    {itemMenu(it)}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <table className="w-full table-fixed text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="w-9 pb-2 pl-2">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    className="accent-sky-500"
                    checked={selected.size > 0 && selected.size === filtered.length}
                    onChange={(e) => setSelected(e.target.checked ? new Set(filtered.map((i) => i.id)) : new Set())}
                  />
                </th>
                <th className="pb-2 font-medium">Name</th>
                <th className="hidden w-24 pb-2 font-medium @lg:table-cell">Type</th>
                <th className="hidden w-40 pb-2 font-medium @3xl:table-cell">Source</th>
                <th className="hidden w-20 pb-2 font-medium @xl:table-cell">Size</th>
                <th className="hidden w-24 pb-2 font-medium @2xl:table-cell">Updated</th>
                <th className="w-40 pb-2 @xl:w-52" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((it) => {
                const km = KIND_META[it.kind];
                const onScreen = loadedShas?.has(it.sha256);
                return (
                  <tr
                    key={it.id}
                    className={cx(
                      'group border-t border-white/[0.05] align-middle',
                      selected.has(it.id) ? 'bg-sky-500/[0.05]' : 'hover:bg-white/[0.02]',
                    )}
                    onDoubleClick={() => onOpenItem(it, 'auto')}
                  >
                    <td className="py-2.5 pl-2">
                      <input
                        type="checkbox"
                        aria-label={`Select ${it.name}`}
                        className="accent-sky-500"
                        checked={selected.has(it.id)}
                        onChange={(e) => {
                          const next = new Set(selected);
                          if (e.target.checked) next.add(it.id);
                          else next.delete(it.id);
                          setSelected(next);
                        }}
                      />
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-2.5">
                        <span className={cx('shrink-0', km.tone)}>{km.icon}</span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate font-medium text-slate-100">{it.name}</span>
                            {it.favorite && <Star className="h-3.5 w-3.5 shrink-0 fill-amber-300 text-amber-300" />}
                            {onScreen && <Badge tone="good">On screen</Badge>}
                          </div>
                          {(it.tags.length > 0 || it.notes) && (
                            <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-slate-500">
                              {it.tags.slice(0, 4).map((t) => (
                                <span key={t} className="rounded bg-white/[0.05] px-1.5 py-px text-slate-400">
                                  {t}
                                </span>
                              ))}
                              {it.notes && <span className="truncate">{it.notes}</span>}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="hidden py-2.5 text-slate-400 @lg:table-cell">
                      {km.label}
                      <span className="ml-1 font-mono text-xs text-slate-500 uppercase">{it.format}</span>
                    </td>
                    <td className="hidden truncate py-2.5 pr-3 text-xs text-slate-400 @3xl:table-cell">
                      {it.source.database ?? (it.source.origin === 'local-file' ? 'Local file' : it.source.origin === 'manual' ? 'Edited' : '—')}
                      {it.source.accession && <span className="ml-1 font-mono text-slate-300">{it.source.accession}</span>}
                    </td>
                    <td className="hidden py-2.5 text-xs text-slate-400 tabular-nums @xl:table-cell">{formatBytes(it.sizeBytes)}</td>
                    <td className="hidden py-2.5 text-xs text-slate-400 @2xl:table-cell">{relTime(it.updatedAtUtc)}</td>
                    <td className="py-2.5 pr-1">
                      <div className="flex items-center justify-end gap-1">
                        {it.kind === 'structure' ? (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => onOpenItem(it, 'reference')}>
                              Reference
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => onOpenItem(it, 'mobile')}>
                              Compare
                            </Button>
                          </>
                        ) : (
                          <Button size="sm" variant="ghost" onClick={() => onOpenItem(it, 'auto')}>
                            Open
                          </Button>
                        )}
                        {itemMenu(it)}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {dragOver && (
        <div className="pointer-events-none absolute inset-2 flex items-center justify-center rounded-xl border-2 border-dashed border-sky-400/60 bg-sky-400/10 text-sm font-medium text-sky-200">
          Drop to add to library
        </div>
      )}

      <EditItemModal item={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function EditItemModal({ item, onClose }: { item: LibraryItem | null; onClose: () => void }) {
  const { toast } = useFeedback();
  const [name, setName] = useState('');
  const [tags, setTags] = useState('');
  const [notes, setNotes] = useState('');
  const [content, setContent] = useState('');

  useEffect(() => {
    if (!item) return;
    setName(item.name);
    setTags(item.tags.join(', '));
    setNotes(item.notes);
    setContent(item.content);
  }, [item]);

  if (!item) return null;
  const contentEditable = item.kind !== 'structure';

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast('Name is required', 'warn');
      return;
    }
    await updateLibraryItem(item.id, {
      name: trimmed,
      tags: tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      notes,
      ...(contentEditable ? { content: content.trim() } : {}),
    });
    toast('Saved', 'success');
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit library item"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-400">Name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-400">Tags (comma separated)</span>
          <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. kinase, project-a" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-400">Notes</span>
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        {contentEditable ? (
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-400">
              {item.kind === 'compound' ? 'SMILES' : 'Sequence'}
            </span>
            <Textarea rows={4} value={content} onChange={(e) => setContent(e.target.value)} className="font-mono text-xs" />
            {content.trim() !== item.content && (
              <span className="text-xs text-amber-300">
                Editing content changes its SHA-256 and marks the item as manually edited.
              </span>
            )}
          </label>
        ) : null}
        <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3 text-xs text-slate-400">
          <div className="mb-1 font-medium text-slate-300">Provenance</div>
          <dl className="grid grid-cols-[7rem_1fr] gap-x-2 gap-y-1">
            <dt>Origin</dt>
            <dd className="text-slate-300">{item.source.origin ?? 'unknown'}</dd>
            <dt>Source</dt>
            <dd className="truncate text-slate-300">
              {item.source.sourceUrl ? (
                <a href={item.source.sourceUrl} target="_blank" rel="noreferrer" className="text-sky-300 hover:underline">
                  {item.source.sourceUrl}
                </a>
              ) : (
                'unknown'
              )}
            </dd>
            <dt>License</dt>
            <dd className="text-slate-300">{item.source.license ?? 'unknown'}</dd>
            <dt>Retrieved (UTC)</dt>
            <dd className="text-slate-300">{item.source.retrievedAtUtc ?? 'unknown'}</dd>
            <dt>SHA-256</dt>
            <dd className="truncate font-mono text-slate-300">{item.sha256}</dd>
          </dl>
        </div>
      </div>
    </Modal>
  );
}
