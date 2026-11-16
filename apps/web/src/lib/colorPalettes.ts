export type ColorMode =
  | 'identity'
  | 'plddt'
  | 'bfactor'
  | 'deviation';

/**
 * AlphaFold pLDDT canonical 4-band palette:
 * - Very high (>= 90): #0053D6 (rendered bright on dark bg -> #1d6ff2)
 * - Confident (70..90): #65CBF3
 * - Low (50..70): #FFDB13
 * - Very low (< 50): #FF7D45
 */
export function plddtColor(plddt: number | null | undefined): [number, number, number] {
  if (plddt == null || !Number.isFinite(plddt)) return [148, 163, 184];
  if (plddt >= 90) return [38, 132, 255];
  if (plddt >= 70) return [101, 203, 243];
  if (plddt >= 50) return [255, 219, 19];
  return [255, 125, 69];
}

/**
 * Experimental B-factor (A^2) Viridis-Plasma distinct palette.
 * Strictly separated from AlphaFold pLDDT colors (low B = rigid purple/violet -> medium magenta/coral -> high B warm gold).
 */
export function bFactorColor(b: number | null | undefined): [number, number, number] {
  if (b == null || !Number.isFinite(b)) return [148, 163, 184];
  // Typical crystal B-factors range ~4 A^2 (rigid active site) to >=55 A^2 (flexible loops).
  const t = Math.max(0, Math.min(1, (b - 4) / 46));
  // 4-stop Plasma gradient: #3b0f70 -> #8c2981 -> #de4968 -> #fe9f6d -> #fcfdbf
  const stops: Array<[number, number, number]> = [
    [98, 45, 186],
    [156, 47, 148],
    [222, 73, 104],
    [254, 159, 109],
    [252, 244, 152],
  ];
  const scaled = t * (stops.length - 1);
  const idx = Math.min(stops.length - 2, Math.floor(scaled));
  const frac = scaled - idx;
  const a = stops[idx];
  const c = stops[idx + 1];
  return [
    Math.round(a[0] + (c[0] - a[0]) * frac),
    Math.round(a[1] + (c[1] - a[1]) * frac),
    Math.round(a[2] + (c[2] - a[2]) * frac),
  ];
}

/**
 * Per-residue C-alpha deviation delta-d (Angstroms):
 * 0.0 A emerald -> 1.5 A amber -> >= 4.0 A rose/crimson.
 */
export function deviationColor(dist: number | null | undefined): [number, number, number] {
  if (dist == null || !Number.isFinite(dist)) return [148, 163, 184];
  const t = Math.max(0, Math.min(1, dist / 4.0));
  if (t < 0.4) {
    const f = t / 0.4;
    return [
      Math.round(16 + (245 - 16) * f),
      Math.round(185 + (158 - 185) * f),
      Math.round(129 + (11 - 129) * f),
    ];
  }
  const f = (t - 0.4) / 0.6;
  return [
    Math.round(245 + (244 - 245) * f),
    Math.round(158 + (63 - 158) * f),
    Math.round(11 + (94 - 11) * f),
  ];
}

export function elementColor(element: string): [number, number, number] {
  const el = element.trim().toUpperCase();
  switch (el) {
    case 'ZN':
      return [192, 132, 252]; // Violet metallic Zn2+
    case 'MG':
      return [74, 222, 128];
    case 'FE':
      return [249, 115, 22];
    case 'N':
      return [96, 165, 250];
    case 'O':
      return [248, 113, 113];
    case 'S':
      return [250, 204, 21];
    case 'P':
      return [251, 146, 60];
    case 'F':
    case 'CL':
      return [52, 211, 153];
    case 'BR':
      return [185, 28, 28];
    default:
      return [203, 213, 225]; // Carbon / heavy
  }
}

export function rgbCss(rgb: [number, number, number], alpha = 1): string {
  return alpha >= 1
    ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
    : `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

/**
 * PAE Angstrom color scale: 0 A deep emerald/teal -> 15 A slate -> 30 A dark charcoal.
 */
export function paeColorBytes(pae: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(30, pae));
  const t = clamped / 30;
  if (t < 0.35) {
    const f = t / 0.35;
    return [
      Math.round(16 + (45 - 16) * f),
      Math.round(210 + (140 - 210) * f),
      Math.round(160 + (135 - 160) * f),
    ];
  }
  const f = (t - 0.35) / 0.65;
  return [
    Math.round(45 + (15 - 45) * f),
    Math.round(140 + (23 - 140) * f),
    Math.round(135 + (42 - 135) * f),
  ];
}
