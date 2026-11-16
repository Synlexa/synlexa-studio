import { useMemo, useRef, useState, type PointerEvent } from 'react';
import { Atom, Eraser, Hexagon, RotateCcw, Trash2 } from 'lucide-react';
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

const TEMPLATES: Array<{ id: RingTemplateKind; label: string }> = [
  { id: 'benzene', label: 'Benzene' },
  { id: 'pyridine', label: 'Pyridine' },
  { id: 'thiophene', label: 'Thiophene' },
  { id: 'cyclohexane', label: 'Cyclohexane' },
  { id: 'cyclopentane', label: 'Cyclopentane' },
  { id: 'sulfonamide', label: '-SO₂NH₂' },
];

export function MoleculeSketcher2D({
  initialMolblock,
  onCommitMolblock,
}: MoleculeSketcher2DProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [graph, setGraph] = useState<SketchGraph>(() =>
    initialMolblock ? parseMolblockToSketch(initialMolblock) : stampTemplateIntoSketch(createEmptySketch(), 'benzene', 240, 150),
  );
  const [activeElement, setActiveElement] = useState<SketchElement>('C');
  const [activeOrder, setActiveOrder] = useState<SketchBondOrder>(1);
  const [tool, setTool] = useState<'draw' | 'erase' | RingTemplateKind>('draw');
  const [dragFromAtom, setDragFromAtom] = useState<SketchAtom | null>(null);
  const [cursorPt, setCursorPt] = useState<{ x: number; y: number } | null>(null);

  const atomById = useMemo(() => {
    const m = new Map<number, SketchAtom>();
    for (const a of graph.atoms) m.set(a.id, a);
    return m;
  }, [graph.atoms]);

  const commit = (next: SketchGraph) => {
    setGraph(next);
    if (next.atoms.length > 0) {
      onCommitMolblock(serializeSketchToMolblock(next));
    }
  };

  const clientToSvg = (e: PointerEvent<SVGSVGElement>): { x: number; y: number } => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 240, y: 150 };
    return {
      x: ((e.clientX - rect.left) / rect.width) * 480,
      y: ((e.clientY - rect.top) / rect.height) * 300,
    };
  };

  const findNearestAtom = (x: number, y: number, maxDist = 16): SketchAtom | null => {
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

  const findNearestBond = (x: number, y: number, maxDist = 10): number => {
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
      const stamped = stampTemplateIntoSketch(graph, tool, pt.x, pt.y);
      commit(stamped);
      setTool('draw');
      return;
    }

    const hitAtom = findNearestAtom(pt.x, pt.y);
    if (tool === 'erase') {
      if (hitAtom) {
        commit({
          ...graph,
          atoms: graph.atoms.filter((a) => a.id !== hitAtom.id),
          bonds: graph.bonds.filter((b) => b.from !== hitAtom.id && b.to !== hitAtom.id),
        });
        return;
      }
      const hitBondIdx = findNearestBond(pt.x, pt.y);
      if (hitBondIdx >= 0) {
        commit({
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
      commit({ ...graph, bonds: nextBonds });
      return;
    }

    // Place standalone atom on empty space
    const newId = graph.nextId;
    commit({
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
      // Single click on existing atom: set its element
      if (dragFromAtom.element !== activeElement) {
        commit({
          ...graph,
          atoms: graph.atoms.map((a) =>
            a.id === dragFromAtom.id ? { ...a, element: activeElement } : a,
          ),
        });
      }
    } else if (hitEnd && hitEnd.id !== dragFromAtom.id) {
      // Connect or cycle existing bond
      const existingIdx = graph.bonds.findIndex(
        (b) =>
          (b.from === dragFromAtom.id && b.to === hitEnd.id) ||
          (b.to === dragFromAtom.id && b.from === hitEnd.id),
      );
      if (existingIdx >= 0) {
        commit({
          ...graph,
          bonds: graph.bonds.map((b, idx) =>
            idx === existingIdx ? { ...b, order: ((b.order % 3) + 1) as SketchBondOrder } : b,
          ),
        });
      } else {
        commit({
          ...graph,
          bonds: [...graph.bonds, { from: dragFromAtom.id, to: hitEnd.id, order: activeOrder }],
        });
      }
    } else {
      // Sprout a new atom snapped to a clean 48px bond length
      const angle = Math.atan2(pt.y - dragFromAtom.y, pt.x - dragFromAtom.x);
      const snappedAngle = Math.round(angle / (Math.PI / 6)) * (Math.PI / 6);
      const nx = Math.max(20, Math.min(460, dragFromAtom.x + Math.cos(snappedAngle) * 48));
      const ny = Math.max(20, Math.min(280, dragFromAtom.y + Math.sin(snappedAngle) * 48));
      const newId = graph.nextId;
      commit({
        atoms: [...graph.atoms, { id: newId, element: activeElement, x: nx, y: ny }],
        bonds: [...graph.bonds, { from: dragFromAtom.id, to: newId, order: activeOrder }],
        nextId: newId + 1,
      });
    }

    setDragFromAtom(null);
    setCursorPt(null);
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-[#0b1018] p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Elements */}
        <div className="flex flex-wrap items-center gap-1">
          {ELEMENTS.map((el) => (
            <button
              key={el}
              type="button"
              onClick={() => {
                setActiveElement(el);
                setTool('draw');
              }}
              className={`rounded border px-2 py-0.5 font-mono text-xs font-semibold transition ${
                tool === 'draw' && activeElement === el
                  ? 'border-sky-400/60 bg-sky-500/20 text-sky-200'
                  : 'border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-600'
              }`}
              style={{ color: ELEMENT_COLORS[el] }}
            >
              {el}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-slate-800" />
          {([1, 2, 3] as const).map((ord) => (
            <button
              key={ord}
              type="button"
              onClick={() => {
                setActiveOrder(ord);
                setTool('draw');
              }}
              className={`rounded border px-2 py-0.5 font-mono text-xs transition ${
                tool === 'draw' && activeOrder === ord
                  ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200'
                  : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-600'
              }`}
            >
              {ord === 1 ? 'Single' : ord === 2 ? 'Double' : 'Triple'}
            </button>
          ))}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => setTool(tool === 'erase' ? 'draw' : 'erase')}
            className={`flex items-center gap-1 rounded border px-2 py-0.5 text-xs transition ${
              tool === 'erase'
                ? 'border-rose-400/60 bg-rose-500/20 text-rose-200'
                : 'border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-600'
            }`}
          >
            <Eraser className="h-3 w-3" /> Erase
          </button>
          {initialMolblock && (
            <button
              type="button"
              onClick={() => setGraph(parseMolblockToSketch(initialMolblock))}
              className="flex items-center gap-1 rounded border border-slate-800 bg-slate-900 px-2 py-0.5 text-xs text-slate-300 hover:border-slate-600"
              title="Import active molecule into sketcher"
            >
              <RotateCcw className="h-3 w-3" /> Sync from Active
            </button>
          )}
          <button
            type="button"
            onClick={() => setGraph(createEmptySketch())}
            className="flex items-center gap-1 rounded border border-slate-800 bg-slate-900 px-2 py-0.5 text-xs text-slate-400 hover:border-rose-500/40 hover:text-rose-200"
          >
            <Trash2 className="h-3 w-3" /> Clear
          </button>
        </div>
      </div>

      {/* Ring / Functional Templates */}
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 flex items-center gap-1 text-[0.6875rem] text-slate-500">
          <Hexagon className="h-3 w-3" /> Stamps:
        </span>
        {TEMPLATES.map((tpl) => (
          <button
            key={tpl.id}
            type="button"
            onClick={() => setTool(tool === tpl.id ? 'draw' : tpl.id)}
            className={`rounded border px-2 py-0.5 text-[0.75rem] transition ${
              tool === tpl.id
                ? 'border-violet-400/60 bg-violet-500/20 text-violet-200'
                : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-600 hover:text-slate-200'
            }`}
          >
            {tpl.label}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-1 text-[0.6875rem] text-slate-500">
          <Atom className="h-3 w-3 text-sky-400" />
          Drag from atom to sprout bond · click bond to cycle order
        </span>
      </div>

      {/* Interactive SVG Canvas */}
      <div className="relative overflow-hidden rounded-lg border border-slate-800/90 bg-[#070b12]">
        <svg
          ref={svgRef}
          viewBox="0 0 480 300"
          className="h-64 w-full touch-none select-none cursor-crosshair"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {/* Subtle grid */}
          <defs>
            <pattern id="synlexa-sketch-grid" width="24" height="24" patternUnits="userSpaceOnUse">
              <path d="M 24 0 L 0 0 0 24" fill="none" stroke="rgba(148,163,184,0.06)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="480" height="300" fill="url(#synlexa-sketch-grid)" />

          {/* Preview bond during drag */}
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

          {/* Bonds */}
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

          {/* Atoms */}
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
      </div>
    </div>
  );
}
