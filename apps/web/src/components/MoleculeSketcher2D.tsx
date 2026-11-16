import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import {
  Atom,
  Check,
  Eraser,
  Hexagon,
  Redo2,
  RotateCcw,
  Trash2,
  Undo2,
} from 'lucide-react';
import {
  createEmptySketch,
  parseMolblockToSketch,
  serializeSketchToMolblock,
  stampTemplateIntoSketch,
  type RingTemplateKind,
  type SketchAtom,
  type SketchBondOrder,
  type SketchElement,
  type SketchGraph,
} from '../lib/sketcherGraph';

interface MoleculeSketcher2DProps {
  initialMolblock?: string | null;
  activeSmiles?: string;
  activeName?: string;
  onCommitMolblock: (molblock: string) => void;
}

const ELEMENTS: SketchElement[] = ['C', 'N', 'O', 'S', 'P', 'F', 'Cl', 'Br'];

const ELEMENT_COLORS: Record<SketchElement, string> = {
  C: '#cbd5e1',
  N: '#60a5fa',
  O: '#f87171',
  S: '#facc15',
  P: '#fb923c',
  F: '#34d399',
  Cl: '#34d399',
  Br: '#fb7185',
};

const TEMPLATES: Array<{ id: RingTemplateKind; label: string; tip: string }> = [
  { id: 'benzene', label: 'Benzene', tip: 'Stamp a 6-membered aromatic benzene ring' },
  { id: 'pyridine', label: 'Pyridine', tip: 'Stamp an N-heteroaromatic pyridine ring' },
  { id: 'thiophene', label: 'Thiophene', tip: 'Stamp a 5-membered S-aromatic ring' },
  { id: 'cyclohexane', label: 'Cyclohexane', tip: 'Stamp a saturated 6-membered ring' },
  { id: 'cyclopentane', label: 'Cyclopentane', tip: 'Stamp a saturated 5-membered ring' },
  { id: 'sulfonamide', label: '-SO₂NH₂', tip: 'Stamp a zinc-binding sulfonamide group' },
  { id: 'carboxyl', label: '-COOH', tip: 'Stamp a carboxylic acid group' },
  { id: 'amide', label: '-CONH₂', tip: 'Stamp a primary amide group' },
];

export function MoleculeSketcher2D({
  initialMolblock,
  activeSmiles,
  activeName,
  onCommitMolblock,
}: MoleculeSketcher2DProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const initialGraph = useMemo(
    () =>
      initialMolblock
        ? parseMolblockToSketch(initialMolblock)
        : stampTemplateIntoSketch(createEmptySketch(), 'benzene', 240, 150),
    // Only seed once on mount; external updates offer a clear Sync banner/auto-sync
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [history, setHistory] = useState<SketchGraph[]>([initialGraph]);
  const [historyIdx, setHistoryIdx] = useState(0);
  const [syncedMolblock, setSyncedMolblock] = useState<string | null>(initialMolblock ?? null);
  const [hasLocalEdits, setHasLocalEdits] = useState(false);

  const graph = history[historyIdx] ?? initialGraph;

  const [activeElement, setActiveElement] = useState<SketchElement>('C');
  const [activeOrder, setActiveOrder] = useState<SketchBondOrder>(1);
  const [tool, setTool] = useState<'draw' | 'erase' | RingTemplateKind>('draw');
  const [dragFromAtom, setDragFromAtom] = useState<SketchAtom | null>(null);
  const [cursorPt, setCursorPt] = useState<{ x: number; y: number } | null>(null);

  // When an external preset or SMILES is selected and the user hasn't drawn local strokes since syncing, keep sketcher fresh.
  useEffect(() => {
    if (!initialMolblock || initialMolblock === syncedMolblock) return;
    if (!hasLocalEdits) {
      const parsed = parseMolblockToSketch(initialMolblock);
      setHistory([parsed]);
      setHistoryIdx(0);
      setSyncedMolblock(initialMolblock);
    }
  }, [initialMolblock, syncedMolblock, hasLocalEdits]);

  const atomById = useMemo(() => {
    const m = new Map<number, SketchAtom>();
    for (const a of graph.atoms) m.set(a.id, a);
    return m;
  }, [graph.atoms]);

  const pushGraph = (next: SketchGraph, commitToEngine = true) => {
    const sliced = history.slice(0, historyIdx + 1);
    const updated = [...sliced, next].slice(-30);
    setHistory(updated);
    setHistoryIdx(updated.length - 1);
    setHasLocalEdits(true);
    if (commitToEngine && next.atoms.length > 0) {
      onCommitMolblock(serializeSketchToMolblock(next));
    }
  };

  const canUndo = historyIdx > 0;
  const canRedo = historyIdx < history.length - 1;

  const handleUndo = () => {
    if (!canUndo) return;
    const nextIdx = historyIdx - 1;
    setHistoryIdx(nextIdx);
    const g = history[nextIdx];
    if (g && g.atoms.length > 0) onCommitMolblock(serializeSketchToMolblock(g));
  };

  const handleRedo = () => {
    if (!canRedo) return;
    const nextIdx = historyIdx + 1;
    setHistoryIdx(nextIdx);
    const g = history[nextIdx];
    if (g && g.atoms.length > 0) onCommitMolblock(serializeSketchToMolblock(g));
  };

  const syncFromActive = () => {
    if (!initialMolblock) return;
    const parsed = parseMolblockToSketch(initialMolblock);
    setHistory([parsed]);
    setHistoryIdx(0);
    setSyncedMolblock(initialMolblock);
    setHasLocalEdits(false);
  };

  const clientToSvg = (e: PointerEvent<SVGSVGElement>): { x: number; y: number } => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 240, y: 150 };
    return {
      x: ((e.clientX - rect.left) / rect.width) * 480,
      y: ((e.clientY - rect.top) / rect.height) * 300,
    };
  };

  const findNearestAtom = (x: number, y: number, maxDist = 18): SketchAtom | null => {
    let best: SketchAtom | null = null;
    let bestD = maxDist;
    for (const a of graph.atoms) {
      const d = Math.hypot(a.x - x, a.y - y);
      if (d < bestD) {
        best = a;
        bestD = d;
      }
    }
    return best;
  };

  const findNearestBond = (x: number, y: number, maxDist = 11): number => {
    for (let i = 0; i < graph.bonds.length; i++) {
      const b = graph.bonds[i];
      const a1 = atomById.get(b.from);
      const a2 = atomById.get(b.to);
      if (!a1 || !a2) continue;
      const dx = a2.x - a1.x;
      const dy = a2.y - a1.y;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) continue;
      const t = Math.max(0.1, Math.min(0.9, ((x - a1.x) * dx + (y - a1.y) * dy) / len2));
      const px = a1.x + t * dx;
      const py = a1.y + t * dy;
      if (Math.hypot(x - px, y - py) <= maxDist) return i;
    }
    return -1;
  };

  const handlePointerDown = (e: PointerEvent<SVGSVGElement>) => {
    const pt = clientToSvg(e);

    if (tool !== 'draw' && tool !== 'erase') {
      const hitAtom = findNearestAtom(pt.x, pt.y, 20);
      const cx = hitAtom ? hitAtom.x : pt.x;
      const cy = hitAtom ? hitAtom.y : pt.y;
      const stamped = stampTemplateIntoSketch(graph, tool, cx, cy);
      pushGraph(stamped);
      setTool('draw');
      return;
    }

    const hitAtom = findNearestAtom(pt.x, pt.y);
    if (tool === 'erase') {
      if (hitAtom) {
        pushGraph({
          ...graph,
          atoms: graph.atoms.filter((a) => a.id !== hitAtom.id),
          bonds: graph.bonds.filter((b) => b.from !== hitAtom.id && b.to !== hitAtom.id),
        });
        return;
      }
      const hitBondIdx = findNearestBond(pt.x, pt.y);
      if (hitBondIdx >= 0) {
        pushGraph({
          ...graph,
          bonds: graph.bonds.filter((_, idx) => idx !== hitBondIdx),
        });
      }
      return;
    }

    if (hitAtom) {
      setDragFromAtom(hitAtom);
      setCursorPt(pt);
      return;
    }

    const hitBondIdx = findNearestBond(pt.x, pt.y);
    if (hitBondIdx >= 0) {
      const nextBonds = graph.bonds.map((b, idx) =>
        idx === hitBondIdx ? { ...b, order: ((b.order % 3) + 1) as SketchBondOrder } : b,
      );
      pushGraph({ ...graph, bonds: nextBonds });
      return;
    }

    // Place standalone atom on empty space
    const newId = graph.nextId;
    pushGraph({
      atoms: [...graph.atoms, { id: newId, element: activeElement, x: pt.x, y: pt.y }],
      bonds: graph.bonds,
      nextId: newId + 1,
    });
  };

  const handlePointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!dragFromAtom) return;
    setCursorPt(clientToSvg(e));
  };

  const handlePointerUp = (e: PointerEvent<SVGSVGElement>) => {
    if (!dragFromAtom) return;
    const pt = clientToSvg(e);
    const dist = Math.hypot(pt.x - dragFromAtom.x, pt.y - dragFromAtom.y);
    const hitEnd = findNearestAtom(pt.x, pt.y);

    if (dist < 10) {
      if (dragFromAtom.element !== activeElement) {
        pushGraph({
          ...graph,
          atoms: graph.atoms.map((a) =>
            a.id === dragFromAtom.id ? { ...a, element: activeElement } : a,
          ),
        });
      }
    } else if (hitEnd && hitEnd.id !== dragFromAtom.id) {
      const existingIdx = graph.bonds.findIndex(
        (b) =>
          (b.from === dragFromAtom.id && b.to === hitEnd.id) ||
          (b.to === dragFromAtom.id && b.from === hitEnd.id),
      );
      if (existingIdx >= 0) {
        pushGraph({
          ...graph,
          bonds: graph.bonds.map((b, idx) =>
            idx === existingIdx ? { ...b, order: ((b.order % 3) + 1) as SketchBondOrder } : b,
          ),
        });
      } else {
        pushGraph({
          ...graph,
          bonds: [...graph.bonds, { from: dragFromAtom.id, to: hitEnd.id, order: activeOrder }],
        });
      }
    } else {
      const angle = Math.atan2(pt.y - dragFromAtom.y, pt.x - dragFromAtom.x);
      const snappedAngle = Math.round(angle / (Math.PI / 6)) * (Math.PI / 6);
      const nx = Math.max(20, Math.min(460, dragFromAtom.x + Math.cos(snappedAngle) * 48));
      const ny = Math.max(20, Math.min(280, dragFromAtom.y + Math.sin(snappedAngle) * 48));
      const newId = graph.nextId;
      pushGraph({
        atoms: [...graph.atoms, { id: newId, element: activeElement, x: nx, y: ny }],
        bonds: [...graph.bonds, { from: dragFromAtom.id, to: newId, order: activeOrder }],
        nextId: newId + 1,
      });
    }

    setDragFromAtom(null);
    setCursorPt(null);
  };

  const outOfSync = Boolean(initialMolblock && initialMolblock !== syncedMolblock && hasLocalEdits);

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-white/[0.08] bg-[#0b1018] p-3">
      {/* Elements, Bond Orders & History Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          {ELEMENTS.map((el) => (
            <button
              key={el}
              type="button"
              title={`Select element ${el} (click an atom to replace, or drag to sprout)`}
              onClick={() => {
                setActiveElement(el);
                setTool('draw');
              }}
              className={`rounded-md border px-2 py-1 font-mono text-xs font-semibold transition ${
                tool === 'draw' && activeElement === el
                  ? 'border-sky-400/60 bg-sky-500/20'
                  : 'border-white/10 bg-slate-900/80 hover:border-white/25'
              }`}
              style={{ color: ELEMENT_COLORS[el] }}
            >
              {el}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-white/10" />
          {([1, 2, 3] as const).map((ord) => (
            <button
              key={ord}
              type="button"
              title={`Draw ${ord === 1 ? 'single' : ord === 2 ? 'double' : 'triple'} bond (or click existing bond to cycle)`}
              onClick={() => {
                setActiveOrder(ord);
                setTool('draw');
              }}
              className={`rounded-md border px-2 py-1 font-mono text-xs transition ${
                tool === 'draw' && activeOrder === ord
                  ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200'
                  : 'border-white/10 bg-slate-900/80 text-slate-400 hover:border-white/25 hover:text-slate-200'
              }`}
            >
              {ord === 1 ? 'Single' : ord === 2 ? 'Double' : 'Triple'}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={handleUndo}
            disabled={!canUndo}
            title="Undo last stroke"
            className="flex items-center gap-1 rounded-md border border-white/10 bg-slate-900/80 px-2 py-1 text-xs text-slate-300 hover:border-white/25 disabled:opacity-35"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={handleRedo}
            disabled={!canRedo}
            title="Redo stroke"
            className="flex items-center gap-1 rounded-md border border-white/10 bg-slate-900/80 px-2 py-1 text-xs text-slate-300 hover:border-white/25 disabled:opacity-35"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setTool(tool === 'erase' ? 'draw' : 'erase')}
            className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition ${
              tool === 'erase'
                ? 'border-rose-400/60 bg-rose-500/20 text-rose-200'
                : 'border-white/10 bg-slate-900/80 text-slate-300 hover:border-white/25'
            }`}
          >
            <Eraser className="h-3.5 w-3.5" /> Erase
          </button>
          {initialMolblock && (
            <button
              type="button"
              onClick={syncFromActive}
              className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition ${
                outOfSync
                  ? 'border-amber-400/50 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25'
                  : 'border-white/10 bg-slate-900/80 text-slate-300 hover:border-white/25'
              }`}
              title="Import the active analyzed molecule into the sketcher canvas"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Load Active
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              pushGraph(createEmptySketch(), false);
            }}
            className="flex items-center gap-1 rounded-md border border-white/10 bg-slate-900/80 px-2 py-1 text-xs text-slate-400 hover:border-rose-500/40 hover:text-rose-200"
          >
            <Trash2 className="h-3.5 w-3.5" /> Clear
          </button>
          {graph.atoms.length > 0 && (
            <button
              type="button"
              onClick={() => onCommitMolblock(serializeSketchToMolblock(graph))}
              className="flex items-center gap-1 rounded-md border border-emerald-400/40 bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-200 hover:bg-emerald-500/25"
              title="Re-analyze this 2D sketch in RDKit WASM"
            >
              <Check className="h-3.5 w-3.5" /> Apply Sketch
            </button>
          )}
        </div>
      </div>

      {/* Ring / Functional Templates */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="flex items-center gap-1 text-[0.6875rem] font-medium text-slate-400">
          <Hexagon className="h-3.5 w-3.5 text-violet-300" /> Stamps:
        </span>
        {TEMPLATES.map((tpl) => (
          <button
            key={tpl.id}
            type="button"
            title={tpl.tip}
            onClick={() => setTool(tool === tpl.id ? 'draw' : tpl.id)}
            className={`rounded-md border px-2 py-0.5 text-[0.75rem] transition ${
              tool === tpl.id
                ? 'border-violet-400/60 bg-violet-500/20 text-violet-200'
                : 'border-white/10 bg-slate-950/70 text-slate-300 hover:border-white/25 hover:text-white'
            }`}
          >
            {tpl.label}
          </button>
        ))}
      </div>

      {/* Interactive SVG Canvas */}
      <div className="relative overflow-hidden rounded-lg border border-white/[0.08] bg-[#070b12]">
        <svg
          ref={svgRef}
          viewBox="0 0 480 300"
          className="aspect-[16/10] w-full max-h-[380px] min-h-[220px] touch-none select-none cursor-crosshair"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <defs>
            <pattern id="synlexa-sketch-grid" width="24" height="24" patternUnits="userSpaceOnUse">
              <path d="M 24 0 L 0 0 0 24" fill="none" stroke="rgba(148,163,184,0.06)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="480" height="300" fill="url(#synlexa-sketch-grid)" />

          {dragFromAtom && cursorPt && (
            <line
              x1={dragFromAtom.x}
              y1={dragFromAtom.y}
              x2={cursorPt.x}
              y2={cursorPt.y}
              stroke="#38bdf8"
              strokeWidth={2}
              strokeDasharray="4 4"
            />
          )}

          {graph.bonds.map((b, idx) => {
            const a1 = atomById.get(b.from);
            const a2 = atomById.get(b.to);
            if (!a1 || !a2) return null;
            const dx = a2.x - a1.x;
            const dy = a2.y - a1.y;
            const len = Math.hypot(dx, dy) || 1;
            const nx = (-dy / len) * 3.5;
            const ny = (dx / len) * 3.5;
            if (b.order === 2) {
              return (
                <g key={idx} stroke="#94a3b8" strokeWidth={2.2} strokeLinecap="round">
                  <line x1={a1.x + nx} y1={a1.y + ny} x2={a2.x + nx} y2={a2.y + ny} />
                  <line x1={a1.x - nx} y1={a1.y - ny} x2={a2.x - nx} y2={a2.y - ny} />
                </g>
              );
            }
            if (b.order === 3) {
              return (
                <g key={idx} stroke="#94a3b8" strokeWidth={2} strokeLinecap="round">
                  <line x1={a1.x} y1={a1.y} x2={a2.x} y2={a2.y} />
                  <line x1={a1.x + nx * 1.4} y1={a1.y + ny * 1.4} x2={a2.x + nx * 1.4} y2={a2.y + ny * 1.4} />
                  <line x1={a1.x - nx * 1.4} y1={a1.y - ny * 1.4} x2={a2.x - nx * 1.4} y2={a2.y - ny * 1.4} />
                </g>
              );
            }
            return (
              <line
                key={idx}
                x1={a1.x}
                y1={a1.y}
                x2={a2.x}
                y2={a2.y}
                stroke="#94a3b8"
                strokeWidth={2.3}
                strokeLinecap="round"
              />
            );
          })}

          {graph.atoms.map((a) => (
            <g key={a.id}>
              <circle
                cx={a.x}
                cy={a.y}
                r={a.element === 'C' ? 5.5 : 10}
                fill={a.element === 'C' ? '#1e293b' : '#070b12'}
                stroke={dragFromAtom?.id === a.id ? '#38bdf8' : 'rgba(148,163,184,0.35)'}
                strokeWidth={1.2}
              />
              {a.element !== 'C' && (
                <text
                  x={a.x}
                  y={a.y + 4}
                  textAnchor="middle"
                  fill={ELEMENT_COLORS[a.element]}
                  fontSize="12"
                  fontWeight="700"
                  fontFamily="ui-monospace, monospace"
                >
                  {a.element}
                </text>
              )}
            </g>
          ))}
        </svg>

        {graph.atoms.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-slate-500">
            Click anywhere to place an atom, or select a Stamp above and click on the grid.
          </div>
        )}
      </div>

      {/* Live Canvas Readout & Instructions */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[0.6875rem] text-slate-400">
        <span className="flex items-center gap-1.5">
          <Atom className="h-3.5 w-3.5 text-sky-400" />
          <span>
            {tool === 'erase'
              ? 'Erase mode: click any atom or bond to remove it'
              : tool !== 'draw'
                ? `Stamp mode (${tool}): click canvas to place group`
                : 'Drag from an atom to sprout a 30°-snapped bond · Click a bond to cycle 1/2/3 · Click atom to swap element'}
          </span>
        </span>
        <span className="font-mono text-slate-300">
          {graph.atoms.length} atoms · {graph.bonds.length} bonds
          {activeSmiles ? ` · ${activeName ? `${activeName}: ` : ''}${activeSmiles.slice(0, 36)}${activeSmiles.length > 36 ? '…' : ''}` : ''}
        </span>
      </div>
    </div>
  );
}
