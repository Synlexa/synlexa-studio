import { useEffect, useMemo, useState } from 'react';
import { Command, CornerDownLeft, Search } from 'lucide-react';

export interface PaletteCommand {
  id: string;
  label: string;
  category: string;
  shortcut?: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: PaletteCommand[];
}

export function CommandPalette({ open, onClose, commands }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIdx(0);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q),
    );
  }, [commands, query]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 pt-20 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-lg border border-slate-700 bg-[#0d131f] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2.5">
          <Search className="h-4 w-4 text-cyan-400" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIdx((i) => Math.min(filtered.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIdx((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter' && filtered[selectedIdx]) {
                e.preventDefault();
                filtered[selectedIdx].run();
                onClose();
              }
            }}
            placeholder="Type a command (e.g. 'Zn2+', 'pLDDT', 'H94A', 'AZM', 'HTML report')…"
            className="w-full bg-transparent text-xs text-slate-100 placeholder-slate-500 outline-none"
          />
          <kbd className="rounded border border-slate-700 px-1.5 py-0.5 font-mono text-[0.75rem] text-slate-400">
            ESC
          </kbd>
        </div>

        <div className="max-h-72 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-slate-500">
              No matching commands.
            </div>
          ) : (
            filtered.map((cmd, idx) => (
              <button
                key={cmd.id}
                type="button"
                onClick={() => {
                  cmd.run();
                  onClose();
                }}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition ${
                  idx === selectedIdx
                    ? 'bg-cyan-500/15 text-cyan-100'
                    : 'text-slate-300 hover:bg-slate-800/70'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[0.75rem] text-slate-400">
                    {cmd.category}
                  </span>
                  <span>{cmd.label}</span>
                </div>
                <div className="flex items-center gap-2 font-mono text-[0.75rem] text-slate-500">
                  {cmd.shortcut && <span>{cmd.shortcut}</span>}
                  {idx === selectedIdx && <CornerDownLeft className="h-3 w-3 text-cyan-400" />}
                </div>
              </button>
            ))
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950/60 px-3 py-1.5 text-[0.75rem] text-slate-500">
          <span className="flex items-center gap-1">
            <Command className="h-3 w-3" /> Synlexa Studio Command Palette
          </span>
          <span>Research Use Only (RUO)</span>
        </div>
      </div>
    </div>
  );
}
