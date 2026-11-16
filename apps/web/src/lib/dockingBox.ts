import type { CompareStructuresResult } from '@synlexa/wasm-bridge';

export interface DockingBoxSpec {
  center: [number, number, number];
  size: [number, number, number];
  sourceLabel: string;
}

/**
 * Estimates an AutoDock Vina search box from the reference co-crystallized ligand,
 * focused residue C-alpha, or chain centroid without fabricating missing coordinates.
 */
export function computeDockingBox(
  comparison: CompareStructuresResult | null,
  focusedSeqId: number | null,
): DockingBoxSpec | null {
  if (!comparison) return null;

  const ligands = comparison.refDisplayAtoms?.ligands ?? [];
  const preferredLigand =
    ligands.find((l) => l.atoms.length >= 4 && l.resName.toUpperCase() !== 'HOH') ??
    ligands.find((l) => l.atoms.length > 0);

  if (preferredLigand && preferredLigand.atoms.length > 0) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const a of preferredLigand.atoms) {
      const [x, y, z] = a.xyz;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    const pad = 10;
    return {
      center: [
        Number(((minX + maxX) / 2).toFixed(2)),
        Number(((minY + maxY) / 2).toFixed(2)),
        Number(((minZ + maxZ) / 2).toFixed(2)),
      ],
      size: [
        Number(Math.max(18, Math.min(36, maxX - minX + pad)).toFixed(1)),
        Number(Math.max(18, Math.min(36, maxY - minY + pad)).toFixed(1)),
        Number(Math.max(18, Math.min(36, maxZ - minZ + pad)).toFixed(1)),
      ],
      sourceLabel: `Ligand ${preferredLigand.resName} ${preferredLigand.chainId}:${preferredLigand.seqId}`,
    };
  }

  const residues = comparison.refDisplayAtoms?.residues ?? [];
  if (focusedSeqId !== null) {
    const res = residues.find((b) => b.seqId === focusedSeqId);
    if (res) {
      return {
        center: [
          Number(res.ca[0].toFixed(2)),
          Number(res.ca[1].toFixed(2)),
          Number(res.ca[2].toFixed(2)),
        ],
        size: [22, 22, 22],
        sourceLabel: `Residue ${res.resName3}${res.seqId}`,
      };
    }
  }

  if (residues.length > 0) {
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (const b of residues) {
      sx += b.ca[0];
      sy += b.ca[1];
      sz += b.ca[2];
    }
    const n = residues.length;
    return {
      center: [
        Number((sx / n).toFixed(2)),
        Number((sy / n).toFixed(2)),
        Number((sz / n).toFixed(2)),
      ],
      size: [26, 26, 26],
      sourceLabel: 'Polymer centroid',
    };
  }

  return null;
}
