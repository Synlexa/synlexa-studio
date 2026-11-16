import type {
  CompareStructuresResult,
  InspectLigand,
  InspectStructureResult,
  RefContactRecord,
  RefPocketAtom,
} from '@synlexa/wasm-bridge';
import {
  bFactorColor,
  deviationColor,
  elementColor,
  plddtColor,
  type ColorMode,
} from './colorPalettes';

export interface SceneResidueNode {
  kind: 'ref' | 'mob';
  seqId: number;
  insCode: string;
  resName3: string;
  resCode1: string;
  xyz: [number, number, number];
  bFactor: number | null;
  plddt: number | null;
  deviationA: number | null;
  color: [number, number, number];
}

export interface SceneAtom {
  id: string;
  label: string;
  seqId: number;
  resName: string;
  atomName: string;
  element: string;
  xyz: [number, number, number];
  radius: number;
  color: [number, number, number];
  isLigand: boolean;
  isMetal: boolean;
}

export interface SceneBond {
  a: [number, number, number];
  b: [number, number, number];
  colorA: [number, number, number];
  colorB: [number, number, number];
  radius: number;
  dashed?: boolean;
}

export interface MolecularSceneData {
  refResidues: SceneResidueNode[];
  mobResidues: SceneResidueNode[];
  pocketAtoms: SceneAtom[];
  pocketBonds: SceneBond[];
  ligandAtoms: SceneAtom[];
  ligandBonds: SceneBond[];
  coordinationBonds: SceneBond[];
  center: [number, number, number];
  radius: number;
  activeSiteCenter: [number, number, number] | null;
  nTermCenter: [number, number, number] | null;
}

function dist3(a: [number, number, number], b: [number, number, number]): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function transformPoint4x4(
  m: number[],
  p: [number, number, number],
): [number, number, number] {
  if (m.length !== 16) return p;
  return [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
    m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
    m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
  ];
}

function inferCovalentBonds(atoms: SceneAtom[], maxDist: number, radius: number): SceneBond[] {
  const bonds: SceneBond[] = [];
  for (let i = 0; i < atoms.length; i++) {
    for (let j = i + 1; j < atoms.length; j++) {
      const a = atoms[i];
      const b = atoms[j];
      if (a.isMetal || b.isMetal) continue;
      if (a.seqId !== b.seqId || a.resName !== b.resName) continue;
      const d = dist3(a.xyz, b.xyz);
      const limit = a.element === 'S' || b.element === 'S' ? maxDist + 0.35 : maxDist;
      if (d > 0.4 && d <= limit) {
        bonds.push({
          a: a.xyz,
          b: b.xyz,
          colorA: a.color,
          colorB: b.color,
          radius,
        });
      }
    }
  }
  return bonds;
}

export function buildMolecularScene(params: {
  comparison: CompareStructuresResult | null;
  refInspect: InspectStructureResult | null;
  mobInspect: InspectStructureResult | null;
  refChainId: string;
  mobChainId: string;
  colorMode: ColorMode;
  highlightedSeqIds?: Set<number>;
}): MolecularSceneData {
  const {
    comparison,
    refInspect,
    mobInspect,
    refChainId,
    mobChainId,
    colorMode,
  } = params;

  const deviationByRefSeq = new Map<number, number>();
  const deviationByMobSeq = new Map<number, number>();
  const refBBySeq = new Map<number, number | null>();
  const mobPlddtBySeq = new Map<number, number | null>();

  if (comparison) {
    for (const m of comparison.matchedResidues) {
      deviationByRefSeq.set(m.refSeqId, m.distanceAngstrom);
      deviationByMobSeq.set(m.mobSeqId, m.distanceAngstrom);
      refBBySeq.set(m.refSeqId, m.refBFactor);
      mobPlddtBySeq.set(m.mobSeqId, m.mobPlddt);
    }
  }

  // Reference residues
  const refResidues: SceneResidueNode[] = [];
  const rawRefResidues = comparison?.refDisplayAtoms?.residues;
  if (rawRefResidues && rawRefResidues.length > 0) {
    for (const r of rawRefResidues) {
      const dev = deviationByRefSeq.get(r.seqId) ?? null;
      const bVal = r.bFactor ?? refBBySeq.get(r.seqId) ?? null;
      let color: [number, number, number] = [56, 189, 248]; // sky/cyan
      if (colorMode === 'bfactor') {
        color = bFactorColor(bVal);
      } else if (colorMode === 'plddt') {
        color = [100, 116, 139]; // dim reference when inspecting AlphaFold pLDDT
      } else if (colorMode === 'deviation') {
        color = dev != null ? deviationColor(dev) : [100, 116, 139];
      }
      refResidues.push({
        kind: 'ref',
        seqId: r.seqId,
        insCode: r.insCode,
        resName3: r.resName3,
        resCode1: r.resCode1,
        xyz: r.ca,
        bFactor: bVal,
        plddt: null,
        deviationA: dev,
        color,
      });
    }
  } else if (refInspect) {
    const chain =
      refInspect.chains.find((c) => c.chainId === refChainId) ??
      refInspect.chains[0];
    if (chain) {
      for (const r of chain.residues) {
        if (!r.ca) continue;
        const dev = deviationByRefSeq.get(r.seqId) ?? null;
        let color: [number, number, number] = [56, 189, 248];
        if (colorMode === 'bfactor') color = bFactorColor(r.bOrPlddt);
        else if (colorMode === 'plddt') color = [100, 116, 139];
        else if (colorMode === 'deviation') color = deviationColor(dev);
        refResidues.push({
          kind: 'ref',
          seqId: r.seqId,
          insCode: r.insCode,
          resName3: r.resName3,
          resCode1: r.resCode1,
          xyz: r.ca,
          bFactor: r.bOrPlddt,
          plddt: null,
          deviationA: dev,
          color,
        });
      }
    }
  }

  // Mobile transformed residues
  const mobResidues: SceneResidueNode[] = [];
  if (comparison?.mobTransformedResidues && comparison.mobTransformedResidues.length > 0) {
    for (const r of comparison.mobTransformedResidues) {
      const dev = deviationByMobSeq.get(r.seqId) ?? null;
      const plddt = r.plddt ?? mobPlddtBySeq.get(r.seqId) ?? null;
      let color: [number, number, number] = [52, 211, 153]; // emerald
      if (colorMode === 'plddt') {
        color = plddtColor(plddt);
      } else if (colorMode === 'bfactor') {
        color = [100, 116, 139]; // dim mobile when inspecting experimental B-factor
      } else if (colorMode === 'deviation') {
        color = dev != null ? deviationColor(dev) : [100, 116, 139];
      }
      mobResidues.push({
        kind: 'mob',
        seqId: r.seqId,
        insCode: r.insCode,
        resName3: r.resName3,
        resCode1: r.resCode1,
        xyz: r.xyz,
        bFactor: null,
        plddt,
        deviationA: dev,
        color,
      });
    }
  } else if (mobInspect) {
    const chain =
      mobInspect.chains.find((c) => c.chainId === mobChainId) ??
      mobInspect.chains[0];
    const mat = comparison?.transform.matrixRowMajor4x4;
    if (chain) {
      for (const r of chain.residues) {
        if (!r.ca) continue;
        const xyz = mat ? transformPoint4x4(mat, r.ca) : r.ca;
        const dev = deviationByMobSeq.get(r.seqId) ?? null;
        let color: [number, number, number] = [52, 211, 153];
        if (colorMode === 'plddt') color = plddtColor(r.bOrPlddt);
        else if (colorMode === 'bfactor') color = [100, 116, 139];
        else if (colorMode === 'deviation') color = deviationColor(dev);
        mobResidues.push({
          kind: 'mob',
          seqId: r.seqId,
          insCode: r.insCode,
          resName3: r.resName3,
          resCode1: r.resCode1,
          xyz,
          bFactor: null,
          plddt: r.bOrPlddt,
          deviationA: dev,
          color,
        });
      }
    }
  }

  // Ligands (non-water HETATM from refDisplayAtoms or refInspect)
  const rawLigands: InspectLigand[] =
    comparison?.refDisplayAtoms?.ligands ?? refInspect?.ligands ?? [];
  const ligandAtoms: SceneAtom[] = [];
  for (const lig of rawLigands) {
    for (const a of lig.atoms) {
      const el = a.element.toUpperCase();
      const isMetal = el === 'ZN' || el === 'MG' || el === 'FE' || el === 'CA' || el === 'MN';
      ligandAtoms.push({
        id: `lig-${lig.chainId}-${lig.seqId}-${lig.resName}-${a.name}`,
        label: `${lig.resName} ${lig.seqId} · ${a.name}`,
        seqId: lig.seqId,
        resName: lig.resName,
        atomName: a.name,
        element: el,
        xyz: a.xyz,
        radius: isMetal ? 0.85 : 0.42,
        color: elementColor(el),
        isLigand: true,
        isMetal,
      });
    }
  }
  const ligandBonds = inferCovalentBonds(ligandAtoms, 1.88, 0.22);

  // Pocket heavy atoms (His94, His96, His119, Thr199, etc.)
  const rawPocket: RefPocketAtom[] = comparison?.refDisplayAtoms?.pocketAtoms ?? [];
  const pocketAtoms: SceneAtom[] = rawPocket.map((pa, idx) => ({
    id: `pocket-${pa.seqId}-${pa.atomName}-${idx}`,
    label: `${pa.resName3}${pa.seqId} · ${pa.atomName}`,
    seqId: pa.seqId,
    resName: pa.resName3,
    atomName: pa.atomName,
    element: pa.element.toUpperCase(),
    xyz: pa.xyz,
    radius: 0.3,
    color: pa.element.toUpperCase() === 'C' ? [148, 163, 184] : elementColor(pa.element),
    isLigand: false,
    isMetal: false,
  }));
  const pocketBonds = inferCovalentBonds(pocketAtoms, 1.85, 0.16);

  // Coordination & pocket contact dashed lines (Zn2+ and AZM)
  const coordinationBonds: SceneBond[] = [];
  const contacts: RefContactRecord[] = comparison?.refContacts ?? [];
  const ligLookup = new Map<string, SceneAtom>();
  for (const la of ligandAtoms) {
    ligLookup.set(`${la.resName}:${la.seqId}:${la.atomName}`, la);
  }
  const pocketLookup = new Map<string, SceneAtom>();
  for (const pa of pocketAtoms) {
    pocketLookup.set(`${pa.seqId}:${pa.atomName}`, pa);
  }
  const refCaLookup = new Map<number, SceneResidueNode>();
  for (const rr of refResidues) {
    refCaLookup.set(rr.seqId, rr);
  }

  for (const c of contacts) {
    const la = ligLookup.get(`${c.ligandResName}:${c.ligandSeqId}:${c.ligandAtom}`);
    if (!la) continue;
    const pa =
      pocketLookup.get(`${c.proteinSeqId}:${c.proteinAtom}`) ??
      undefined;
    const targetXyz = pa?.xyz ?? refCaLookup.get(c.proteinSeqId)?.xyz;
    if (!targetXyz) continue;
    if (c.ligandResName === 'ZN' || c.distanceAngstrom <= 3.1) {
      coordinationBonds.push({
        a: la.xyz,
        b: targetXyz,
        colorA: [216, 180, 254],
        colorB: [103, 232, 249],
        radius: 0.1,
        dashed: true,
      });
    }
  }

  // Also add Zn2+ to AZM coordination line if both exist within 2.5 A
  const znAtom = ligandAtoms.find((a) => a.element === 'ZN');
  if (znAtom) {
    for (const la of ligandAtoms) {
      if (la === znAtom) continue;
      if (dist3(znAtom.xyz, la.xyz) <= 2.6) {
        coordinationBonds.push({
          a: znAtom.xyz,
          b: la.xyz,
          colorA: [216, 180, 254],
          colorB: [96, 165, 250],
          radius: 0.11,
          dashed: true,
        });
      }
    }
  }

  // Compute global center & bounding radius
  const allPts = [
    ...refResidues.map((r) => r.xyz),
    ...mobResidues.map((r) => r.xyz),
  ];
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const p of allPts) {
    cx += p[0];
    cy += p[1];
    cz += p[2];
  }
  const n = Math.max(1, allPts.length);
  const center: [number, number, number] = [cx / n, cy / n, cz / n];
  let maxR = 12;
  for (const p of allPts) {
    const d = dist3(p, center);
    if (d > maxR) maxR = d;
  }

  // Active site center: Zn atom if present, else His94/96/119 centroid
  let activeSiteCenter: [number, number, number] | null = null;
  if (znAtom) {
    activeSiteCenter = [...znAtom.xyz];
  } else {
    const histidines = refResidues.filter(
      (r) => r.seqId === 94 || r.seqId === 96 || r.seqId === 119,
    );
    if (histidines.length > 0) {
      const hSum = histidines.reduce(
        (acc, r) => [acc[0] + r.xyz[0], acc[1] + r.xyz[1], acc[2] + r.xyz[2]],
        [0, 0, 0],
      );
      activeSiteCenter = [
        hSum[0] / histidines.length,
        hSum[1] / histidines.length,
        hSum[2] / histidines.length,
      ];
    }
  }

  const nTermPts = refResidues.slice(0, 6);
  const nTermCenter: [number, number, number] | null =
    nTermPts.length > 0
      ? [
          nTermPts.reduce((s, r) => s + r.xyz[0], 0) / nTermPts.length,
          nTermPts.reduce((s, r) => s + r.xyz[1], 0) / nTermPts.length,
          nTermPts.reduce((s, r) => s + r.xyz[2], 0) / nTermPts.length,
        ]
      : null;

  return {
    refResidues,
    mobResidues,
    pocketAtoms,
    pocketBonds,
    ligandAtoms,
    ligandBonds,
    coordinationBonds,
    center,
    radius: maxR,
    activeSiteCenter,
    nTermCenter,
  };
}
