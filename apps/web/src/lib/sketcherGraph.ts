export type SketchElement = 'C' | 'N' | 'O' | 'S' | 'P' | 'F' | 'Cl' | 'Br';
export type SketchBondOrder = 1 | 2 | 3;

export interface SketchAtom {
  id: number;
  element: SketchElement;
  x: number;
  y: number;
}

export interface SketchBond {
  from: number;
  to: number;
  order: SketchBondOrder;
}

export interface SketchGraph {
  atoms: SketchAtom[];
  bonds: SketchBond[];
  nextId: number;
}

export type RingTemplateKind =
  | 'benzene'
  | 'cyclohexane'
  | 'cyclopentane'
  | 'pyridine'
  | 'thiophene'
  | 'sulfonamide';

const ALLOWED_ELEMENTS = new Set<SketchElement>(['C', 'N', 'O', 'S', 'P', 'F', 'Cl', 'Br']);

export function createEmptySketch(): SketchGraph {
  return { atoms: [], bonds: [], nextId: 1 };
}

export function normalizeElement(raw: string): SketchElement {
  const t = raw.trim();
  if (ALLOWED_ELEMENTS.has(t as SketchElement)) return t as SketchElement;
  return 'C';
}

export function serializeSketchToMolblock(graph: SketchGraph, title = 'SynlexaSketch'): string {
  const nAtoms = graph.atoms.length;
  const nBonds = graph.bonds.length;
  const idToIdx = new Map<number, number>();
  graph.atoms.forEach((a, idx) => idToIdx.set(a.id, idx + 1));

  // Scale canvas pixels (~48px = 1.5 A) into Angstrom coordinates centered at origin.
  const scale = 1.5 / 48;
  let cx = 0;
  let cy = 0;
  for (const a of graph.atoms) {
    cx += a.x;
    cy += a.y;
  }
  if (nAtoms > 0) {
    cx /= nAtoms;
    cy /= nAtoms;
  }

  const lines: string[] = [
    title.slice(0, 80),
    '  Synlexa2D          2D',
    '',
    `${String(nAtoms).padStart(3, ' ')}${String(nBonds).padStart(3, ' ')}  0  0  0  0  0  0  0  0999 V2000`,
  ];

  for (const a of graph.atoms) {
    const x = ((a.x - cx) * scale).toFixed(4).padStart(10, ' ');
    const y = (-(a.y - cy) * scale).toFixed(4).padStart(10, ' ');
    const z = '    0.0000';
    const sym = a.element.padEnd(3, ' ');
    lines.push(`${x}${y}${z} ${sym} 0  0  0  0  0  0  0  0  0  0  0  0`);
  }

  for (const b of graph.bonds) {
    const i1 = idToIdx.get(b.from);
    const i2 = idToIdx.get(b.to);
    if (!i1 || !i2) continue;
    lines.push(
      `${String(i1).padStart(3, ' ')}${String(i2).padStart(3, ' ')}${String(b.order).padStart(3, ' ')}  0  0  0  0`,
    );
  }

  lines.push('M  END');
  return lines.join('\n');
}

export function parseMolblockToSketch(molblock: string, targetWidth = 480, targetHeight = 300): SketchGraph {
  const lines = molblock.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length < 4) return createEmptySketch();

  const counts = lines[3];
  const nAtoms = Number.parseInt(counts.slice(0, 3).trim(), 10);
  const nBonds = Number.parseInt(counts.slice(3, 6).trim(), 10);
  if (!Number.isFinite(nAtoms) || !Number.isFinite(nBonds) || nAtoms <= 0 || lines.length < 4 + nAtoms + nBonds) {
    return createEmptySketch();
  }

  const rawAtoms: Array<{ x: number; y: number; element: SketchElement }> = [];
  for (let i = 0; i < nAtoms; i++) {
    const line = lines[4 + i];
    const x = Number.parseFloat(line.slice(0, 10).trim());
    const y = Number.parseFloat(line.slice(10, 20).trim());
    const el = normalizeElement(line.slice(31, 34).trim());
    if (!Number.isFinite(x) || !Number.isFinite(y)) return createEmptySketch();
    rawAtoms.push({ x, y, element: el });
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const a of rawAtoms) {
    if (a.x < minX) minX = a.x;
    if (a.x > maxX) maxX = a.x;
    if (a.y < minY) minY = a.y;
    if (a.y > maxY) maxY = a.y;
  }
  const spanX = Math.max(1e-3, maxX - minX);
  const spanY = Math.max(1e-3, maxY - minY);
  const scale = Math.min(34, Math.min((targetWidth - 96) / spanX, (targetHeight - 80) / spanY));
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;

  const atoms: SketchAtom[] = rawAtoms.map((a, idx) => ({
    id: idx + 1,
    element: a.element,
    x: targetWidth / 2 + (a.x - midX) * scale,
    y: targetHeight / 2 - (a.y - midY) * scale,
  }));

  const bonds: SketchBond[] = [];
  for (let i = 0; i < nBonds; i++) {
    const line = lines[4 + nAtoms + i];
    const from = Number.parseInt(line.slice(0, 3).trim(), 10);
    const to = Number.parseInt(line.slice(3, 6).trim(), 10);
    const rawOrder = Number.parseInt(line.slice(6, 9).trim(), 10);
    const order: SketchBondOrder = rawOrder === 2 ? 2 : rawOrder === 3 ? 3 : 1;
    if (from >= 1 && from <= nAtoms && to >= 1 && to <= nAtoms && from !== to) {
      bonds.push({ from, to, order });
    }
  }

  return { atoms, bonds, nextId: nAtoms + 1 };
}

export function stampTemplateIntoSketch(
  graph: SketchGraph,
  kind: RingTemplateKind,
  cx: number,
  cy: number,
  radius = 42,
): SketchGraph {
  let nextId = graph.nextId;
  const newAtoms: SketchAtom[] = [];
  const newBonds: SketchBond[] = [];

  if (kind === 'sulfonamide') {
    const sId = nextId++;
    const o1 = nextId++;
    const o2 = nextId++;
    const nId = nextId++;
    newAtoms.push(
      { id: sId, element: 'S', x: cx, y: cy },
      { id: o1, element: 'O', x: cx, y: cy - 44 },
      { id: o2, element: 'O', x: cx, y: cy + 44 },
      { id: nId, element: 'N', x: cx + 44, y: cy },
    );
    newBonds.push(
      { from: sId, to: o1, order: 2 },
      { from: sId, to: o2, order: 2 },
      { from: sId, to: nId, order: 1 },
    );
  } else {
    const nSides = kind === 'cyclopentane' || kind === 'thiophene' ? 5 : 6;
    const ids: number[] = [];
    for (let i = 0; i < nSides; i++) {
      const theta = (Math.PI * 2 * i) / nSides - Math.PI / 2;
      const el: SketchElement =
        kind === 'pyridine' && i === 0 ? 'N' : kind === 'thiophene' && i === 0 ? 'S' : 'C';
      const id = nextId++;
      ids.push(id);
      newAtoms.push({
        id,
        element: el,
        x: cx + Math.cos(theta) * radius,
        y: cy + Math.sin(theta) * radius,
      });
    }
    for (let i = 0; i < nSides; i++) {
      const a = ids[i];
      const b = ids[(i + 1) % nSides];
      let order: SketchBondOrder = 1;
      if (kind === 'benzene' || kind === 'pyridine') {
        order = i % 2 === 0 ? 2 : 1;
      } else if (kind === 'thiophene') {
        order = i === 1 || i === 3 ? 2 : 1;
      }
      newBonds.push({ from: a, to: b, order });
    }
  }

  return {
    atoms: [...graph.atoms, ...newAtoms],
    bonds: [...graph.bonds, ...newBonds],
    nextId,
  };
}
