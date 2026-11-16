import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Columns2, Maximize2, X } from 'lucide-react';
import {
  PINNED_TABS,
  type LayoutAction,
  type ToolTabId,
  type WorkspaceLayout,
} from '../../lib/workspaceLayout';
import { cx } from '../ui';

export interface TabMeta {
  title: string;
  icon: ReactNode;
  /** Small status dot / count shown after the title. */
  badge?: ReactNode;
}

interface EditorAreaProps {
  layout: WorkspaceLayout;
  dispatch: (a: LayoutAction) => void;
  meta: Record<ToolTabId, TabMeta>;
  renderTab: (id: ToolTabId) => ReactNode;
  /** Tabs kept mounted while hidden (e.g. the WebGL viewer). */
  keepAlive?: ReadonlySet<ToolTabId>;
}

const DND_TYPE = 'application/x-synlexa-tab';

export function EditorArea({ layout, dispatch, meta, renderTab, keepAlive }: EditorAreaProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState<ToolTabId | null>(null);
  const [menu, setMenu] = useState<{ tab: ToolTabId; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
    };
  }, [menu]);

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const onMove = (ev: PointerEvent) => {
      dispatch({ type: 'set_split', split: (ev.clientX - rect.left) / rect.width });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onDropToGroup = (e: DragEvent, groupIndex: number, index?: number) => {
    const tab = e.dataTransfer.getData(DND_TYPE) as ToolTabId;
    setDragging(null);
    if (!tab) return;
    e.preventDefault();
    dispatch({ type: 'move', tab, toGroup: groupIndex, index });
  };

  const split = layout.groups.length === 2;

  return (
    <div ref={containerRef} className="relative flex min-h-0 min-w-0 flex-1">
      {layout.groups.map((group, gi) => (
        <div
          key={gi}
          style={split ? { width: `${(gi === 0 ? layout.split : 1 - layout.split) * 100}%` } : undefined}
          className={cx('relative flex min-h-0 min-w-0 flex-col', !split && 'flex-1')}
          onMouseDownCapture={() => layout.focused !== gi && dispatch({ type: 'focus_group', group: gi })}
        >
          {/* Tab strip */}
          <div
            role="tablist"
            className={cx(
              'flex h-10 shrink-0 items-stretch border-b border-white/[0.06] bg-[#0d1119]',
              layout.focused === gi && split && 'shadow-[inset_0_-1px_0_0_rgba(56,189,248,0.25)]',
            )}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(DND_TYPE)) e.preventDefault();
            }}
            onDrop={(e) => onDropToGroup(e, gi)}
          >
            <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:none]">
              {group.tabs.map((tab, ti) => {
                const m = meta[tab];
                const active = group.active === tab;
                const closable = !PINNED_TABS.has(tab);
                return (
                  <div
                    key={tab}
                    role="tab"
                    aria-selected={active}
                    tabIndex={0}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DND_TYPE, tab);
                      e.dataTransfer.effectAllowed = 'move';
                      setDragging(tab);
                    }}
                    onDragEnd={() => setDragging(null)}
                    onDragOver={(e) => {
                      if (e.dataTransfer.types.includes(DND_TYPE)) e.preventDefault();
                    }}
                    onDrop={(e) => {
                      e.stopPropagation();
                      onDropToGroup(e, gi, ti);
                    }}
                    onClick={() => dispatch({ type: 'activate', tab })}
                    onAuxClick={(e) => {
                      if (e.button === 1 && closable) dispatch({ type: 'close', tab });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') dispatch({ type: 'activate', tab });
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenu({ tab, x: e.clientX, y: e.clientY });
                    }}
                    className={cx(
                      'group relative flex max-w-56 min-w-0 shrink-0 cursor-pointer items-center gap-2 border-r border-white/[0.05] pr-1.5 pl-3 text-[0.8125rem] transition-colors select-none',
                      active
                        ? 'bg-[#121722] text-slate-100'
                        : 'text-slate-400 hover:bg-white/[0.03] hover:text-slate-200',
                      dragging === tab && 'opacity-40',
                    )}
                  >
                    {active && (
                      <span
                        className={cx(
                          'absolute inset-x-0 top-0 h-0.5',
                          layout.focused === gi ? 'bg-sky-400' : 'bg-slate-600',
                        )}
                      />
                    )}
                    <span className={cx('shrink-0', active ? 'text-sky-300' : 'text-slate-500')}>{m.icon}</span>
                    <span className="truncate">{m.title}</span>
                    {m.badge}
                    {closable ? (
                      <button
                        type="button"
                        aria-label={`Close ${m.title}`}
                        title="Close (middle-click)"
                        onClick={(e) => {
                          e.stopPropagation();
                          dispatch({ type: 'close', tab });
                        }}
                        className={cx(
                          'flex h-5 w-5 items-center justify-center rounded text-slate-500 hover:bg-white/10 hover:text-slate-100',
                          active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                        )}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <span className="w-1" />
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex shrink-0 items-center gap-0.5 px-1.5">
              {group.active && (
                <button
                  type="button"
                  title={split ? 'Move tab to the other side' : 'Split editor right'}
                  aria-label="Split editor"
                  onClick={() =>
                    group.active && dispatch({ type: 'open', tab: group.active, toSide: true })
                  }
                  disabled={!split && group.tabs.length < 2}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-white/[0.07] hover:text-slate-200 disabled:opacity-30"
                >
                  <Columns2 className="h-4 w-4" />
                </button>
              )}
              {split && (
                <button
                  type="button"
                  title="Merge split panes into single full-width view"
                  aria-label="Merge split panes"
                  onClick={() => dispatch({ type: 'merge_split' })}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-white/[0.07] hover:text-sky-300"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Tab content */}
          <div
            className="relative min-h-0 flex-1 bg-[#0f131b]"
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(DND_TYPE)) e.preventDefault();
            }}
            onDrop={(e) => onDropToGroup(e, gi)}
          >
            {group.tabs.map((tab) => {
              const visible = group.active === tab;
              if (!visible && !keepAlive?.has(tab)) return null;
              return (
                <div
                  key={tab}
                  role="tabpanel"
                  className={cx('absolute inset-0 overflow-hidden', !visible && 'invisible')}
                  aria-hidden={!visible}
                >
                  {renderTab(tab)}
                </div>
              );
            })}
            {dragging && (
              <div className="pointer-events-none absolute inset-2 rounded-xl border-2 border-dashed border-sky-400/30 bg-sky-400/[0.03]" />
            )}
          </div>
        </div>
      ))}

      {/* Splitter */}
      {split && (
        <div
          onPointerDown={startResize}
          onDoubleClick={() => dispatch({ type: 'set_split', split: 0.6 })}
          style={{ left: `calc(${layout.split * 100}% - 3px)` }}
          className="absolute top-0 bottom-0 z-20 w-1.5 cursor-col-resize bg-transparent transition-colors hover:bg-sky-400/40"
          title="Drag to resize · double-click to reset"
        />
      )}
      {split && (
        <div
          style={{ left: `${layout.split * 100}%` }}
          className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-white/[0.08]"
        />
      )}

      {/* Drop zone to create a split when only one group exists */}
      {!split && dragging && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => onDropToGroup(e, 1)}
          className="absolute top-10 right-0 bottom-0 z-30 flex w-1/3 items-center justify-center rounded-l-xl border-2 border-dashed border-sky-400/50 bg-sky-400/10 text-sm font-medium text-sky-200"
        >
          Drop to open on the side
        </div>
      )}

      {/* Context menu */}
      {menu && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          style={{ left: menu.x, top: menu.y }}
          className="fixed z-[75] min-w-52 overflow-hidden rounded-xl border border-white/10 bg-[#161c28] py-1 text-sm shadow-2xl"
        >
          {[
            {
              label: split ? 'Move to other side' : 'Open to the side',
              run: () => dispatch({ type: 'open', tab: menu.tab, toSide: true }),
              disabled: !split && layout.groups[0].tabs.length < 2,
            },
            ...(split
              ? [
                  {
                    label: 'Merge split panes',
                    run: () => dispatch({ type: 'merge_split' }),
                    disabled: false,
                  },
                ]
              : []),
            {
              label: 'Close',
              run: () => dispatch({ type: 'close', tab: menu.tab }),
              disabled: PINNED_TABS.has(menu.tab),
            },
            { label: 'Close others', run: () => dispatch({ type: 'close_others', tab: menu.tab }) },
          ].map((it) => (
            <button
              key={it.label}
              type="button"
              disabled={it.disabled}
              onClick={() => {
                it.run();
                setMenu(null);
              }}
              className="flex w-full px-3 py-2 text-left text-slate-200 hover:bg-white/[0.06] disabled:opacity-40"
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
