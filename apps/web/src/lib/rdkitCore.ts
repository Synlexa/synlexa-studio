import type { MainModule, Mol } from '@rdkit/rdkit';

export interface RdkitStructuralAlert {
  id: string;
  family: 'PAINS' | 'Brenk';
  label: string;
  smarts: string;
  matchedAtoms: number[];
}

export interface RdkitMoleculeAnalysis {
  engine: 'rdkit-wasm';
  rdkitVersion: string;
  canonicalSmiles: string;
  inchi: string;
  inchiKey: string;
  molblock2d: string;
  svg: string;
  descriptors: {
    exactMass: number;
    molecularWeight: number;
    tpsa: number;
    crippenLogP: number;
    hbd: number;
    hba: number;
    rotatableBonds: number;
    heavyAtoms: number;
    totalAtoms: number;
    heteroatoms: number;
    rings: number;
    aromaticRings: number;
    aliphaticRings: number;
    fractionCsp3: number;
    stereoCenters: number;
    labuteAsa: number;
    lipinskiHbd: number;
    lipinskiHba: number;
  };
  rules: {
    lipinskiViolations: number;
    veberCompliant: boolean;
    ghoseCompliant: boolean;
  };
  alerts: RdkitStructuralAlert[];
  morganFpPopcount: number;
}

export interface RdkitSearchCandidate {
  id: string;
  name: string;
  smiles: string;
}

export interface RdkitSearchHit {
  id: string;
  name: string;
  smiles: string;
  substructureMatch: boolean;
  tanimoto: number;
  svg: string;
}

const STRUCTURAL_ALERT_RULES: Array<{
  id: string;
  family: 'PAINS' | 'Brenk';
  label: string;
  smarts: string;
}> = [
  { id: 'PAINS-rhodanine', family: 'PAINS', label: 'Rhodanine / ene-rhodanine motif', smarts: 'O=C1NC(=S)SC1' },
  { id: 'PAINS-catechol', family: 'PAINS', label: 'Catechol redox motif', smarts: 'Oc1c(O)cccc1' },
  { id: 'PAINS-quinone', family: 'PAINS', label: 'Para/ortho-quinone redox motif', smarts: 'O=C1C=CC(=O)C=C1' },
  { id: 'PAINS-ene-one', family: 'PAINS', label: 'Michael acceptor (alpha,beta-unsaturated carbonyl)', smarts: '[#6]=[#6]-[C](=O)-[#6,#7,#8]' },
  { id: 'PAINS-azo', family: 'PAINS', label: 'Azo / diazo chromophore', smarts: '[#6]-N=N-[#6]' },
  { id: 'Brenk-nitro', family: 'Brenk', label: 'Nitro group (potential mutagenic/redox alert)', smarts: '[N+](=O)[O-]' },
  { id: 'Brenk-aldehyde', family: 'Brenk', label: 'Reactive aldehyde', smarts: '[CX3H1](=O)[#6]' },
  { id: 'Brenk-epoxide', family: 'Brenk', label: 'Strained epoxide / oxirane', smarts: 'C1OC1' },
  { id: 'Brenk-sulfonyl-halide', family: 'Brenk', label: 'Sulfonyl halide (covalent modifier)', smarts: 'S(=O)(=O)[F,Cl,Br,I]' },
  { id: 'Brenk-acyl-halide', family: 'Brenk', label: 'Acyl halide', smarts: 'C(=O)[F,Cl,Br,I]' },
  { id: 'Brenk-azide', family: 'Brenk', label: 'Azide group', smarts: '[N-]=[N+]=[N-]' },
  { id: 'Brenk-hydrazine', family: 'Brenk', label: 'Hydrazine / hydrazide motif', smarts: '[NX3][NX3]' },
  { id: 'Brenk-thiol', family: 'Brenk', label: 'Free thiol', smarts: '[SX2H1]' },
];

const POPCOUNT_LUT = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  let v = i;
  let c = 0;
  while (v) {
    c += v & 1;
    v >>>= 1;
  }
  POPCOUNT_LUT[i] = c;
}

export function tanimotoUint8(a: Uint8Array, b: Uint8Array): number {
  const len = Math.min(a.length, b.length);
  let inter = 0;
  let union = 0;
  for (let i = 0; i < len; i++) {
    inter += POPCOUNT_LUT[a[i] & b[i]];
    union += POPCOUNT_LUT[a[i] | b[i]];
  }
  return union === 0 ? 0 : inter / union;
}

function countBitsUint8(a: Uint8Array): number {
  let c = 0;
  for (let i = 0; i < a.length; i++) c += POPCOUNT_LUT[a[i]];
  return c;
}

function withMol<T>(rdkit: MainModule, input: string, fn: (mol: Mol) => T): T {
  const mol = rdkit.get_mol(input);
  if (!mol || !mol.is_valid()) {
    mol?.delete();
    throw new Error('RDKit could not parse molecule input.');
  }
  try {
    return fn(mol);
  } finally {
    mol.delete();
  }
}

function styleDarkSvg(rawSvg: string): string {
  // Replace RDKit's opaque white background rect with transparent dark-friendly canvas.
  return rawSvg
    .replace(/fill:#FFFFFF;/gi, 'fill:transparent;')
    .replace(/stroke:#000000;/gi, 'stroke:#cbd5e1;')
    .replace(/fill:#000000;/gi, 'fill:#e2e8f0;');
}

export function analyzeMoleculeWithRdkit(
  rdkit: MainModule,
  input: string,
  options?: { highlightSmarts?: string; width?: number; height?: number },
): RdkitMoleculeAnalysis {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Molecule input is empty.');
  const width = options?.width ?? 340;
  const height = options?.height ?? 220;

  return withMol(rdkit, trimmed, (mol) => {
    const canonicalSmiles = mol.get_smiles();
    const inchi = mol.get_inchi();
    const inchiKey = inchi ? rdkit.get_inchikey_for_inchi(inchi) : '';
    const rawDesc = JSON.parse(mol.get_descriptors()) as Record<string, number>;

    // Compute clean 2D coordinates on a copy so descriptors remain canonical.
    let molblock2d = '';
    const coordMol = mol.copy();
    if (coordMol) {
      try {
        coordMol.set_new_coords(true);
        molblock2d = coordMol.get_molblock();
      } finally {
        coordMol.delete();
      }
    }

    let highlightAtoms: number[] = [];
    if (options?.highlightSmarts?.trim()) {
      const q = rdkit.get_qmol(options.highlightSmarts.trim());
      if (q && q.is_valid()) {
        try {
          const matchJson = mol.get_substruct_match(q);
          const parsed = JSON.parse(matchJson || '{}') as { atoms?: number[] };
          if (Array.isArray(parsed.atoms)) highlightAtoms = parsed.atoms;
        } finally {
          q.delete();
        }
      } else {
        q?.delete();
      }
    }

    const svgRaw =
      highlightAtoms.length > 0
        ? mol.get_svg_with_highlights(
            JSON.stringify({
              width,
              height,
              atoms: highlightAtoms,
              highlightColour: [0.22, 0.74, 0.97, 0.45],
            }),
          )
        : mol.get_svg(width, height);

    const alerts: RdkitStructuralAlert[] = [];
    for (const rule of STRUCTURAL_ALERT_RULES) {
      const q = rdkit.get_qmol(rule.smarts);
      if (!q || !q.is_valid()) {
        q?.delete();
        continue;
      }
      try {
        const mJson = mol.get_substruct_match(q);
        const parsed = JSON.parse(mJson || '{}') as { atoms?: number[] };
        if (Array.isArray(parsed.atoms) && parsed.atoms.length > 0) {
          alerts.push({
            id: rule.id,
            family: rule.family,
            label: rule.label,
            smarts: rule.smarts,
            matchedAtoms: parsed.atoms,
          });
        }
      } finally {
        q.delete();
      }
    }

    const fp = mol.get_morgan_fp_as_uint8array(JSON.stringify({ radius: 2, nBits: 2048 })) as Uint8Array;
    const morganFpPopcount = countBitsUint8(fp);

    const mw = Number(rawDesc.amw ?? 0);
    const clogp = Number(rawDesc.CrippenClogP ?? 0);
    const hbd = Number(rawDesc.lipinskiHBD ?? rawDesc.NumHBD ?? 0);
    const hba = Number(rawDesc.lipinskiHBA ?? rawDesc.NumHBA ?? 0);
    const tpsa = Number(rawDesc.tpsa ?? 0);
    const rot = Number(rawDesc.NumRotatableBonds ?? 0);
    const heavy = Number(rawDesc.NumHeavyAtoms ?? 0);
    const molarRef = Number(rawDesc.CrippenMR ?? 0);

    let lipinskiViolations = 0;
    if (mw > 500) lipinskiViolations++;
    if (clogp > 5) lipinskiViolations++;
    if (hbd > 5) lipinskiViolations++;
    if (hba > 10) lipinskiViolations++;

    const veberCompliant = rot <= 10 && tpsa <= 140;
    const ghoseCompliant =
      mw >= 160 &&
      mw <= 480 &&
      clogp >= -0.4 &&
      clogp <= 5.6 &&
      molarRef >= 40 &&
      molarRef <= 130 &&
      heavy >= 20 &&
      heavy <= 70;

    return {
      engine: 'rdkit-wasm',
      rdkitVersion: rdkit.version(),
      canonicalSmiles,
      inchi,
      inchiKey,
      molblock2d,
      svg: styleDarkSvg(svgRaw),
      descriptors: {
        exactMass: Number(rawDesc.exactmw ?? 0),
        molecularWeight: mw,
        tpsa,
        crippenLogP: clogp,
        hbd: Number(rawDesc.NumHBD ?? 0),
        hba: Number(rawDesc.NumHBA ?? 0),
        rotatableBonds: rot,
        heavyAtoms: heavy,
        totalAtoms: Number(rawDesc.NumAtoms ?? 0),
        heteroatoms: Number(rawDesc.NumHeteroatoms ?? 0),
        rings: Number(rawDesc.NumRings ?? 0),
        aromaticRings: Number(rawDesc.NumAromaticRings ?? 0),
        aliphaticRings: Number(rawDesc.NumAliphaticRings ?? 0),
        fractionCsp3: Number(rawDesc.FractionCSP3 ?? 0),
        stereoCenters: Number(rawDesc.NumAtomStereoCenters ?? 0),
        labuteAsa: Number(rawDesc.labuteASA ?? 0),
        lipinskiHbd: hbd,
        lipinskiHba: hba,
      },
      rules: {
        lipinskiViolations,
        veberCompliant,
        ghoseCompliant,
      },
      alerts,
      morganFpPopcount,
    };
  });
}

export function searchWithRdkit(
  rdkit: MainModule,
  query: string,
  candidates: RdkitSearchCandidate[],
): RdkitSearchHit[] {
  const qText = query.trim();
  if (!qText) return [];

  const qMol = rdkit.get_qmol(qText);
  const fpQueryMol = rdkit.get_mol(qText);
  if ((!qMol || !qMol.is_valid()) && (!fpQueryMol || !fpQueryMol.is_valid())) {
    qMol?.delete();
    fpQueryMol?.delete();
    throw new Error('Query must be a valid SMILES or SMARTS pattern.');
  }

  const queryFp =
    fpQueryMol && fpQueryMol.is_valid()
      ? (fpQueryMol.get_morgan_fp_as_uint8array(JSON.stringify({ radius: 2, nBits: 2048 })) as Uint8Array)
      : null;

  const hits: RdkitSearchHit[] = [];
  try {
    for (const c of candidates) {
      const m = rdkit.get_mol(c.smiles);
      if (!m || !m.is_valid()) {
        m?.delete();
        continue;
      }
      try {
        let matchedAtoms: number[] = [];
        if (qMol && qMol.is_valid()) {
          const mj = JSON.parse(m.get_substruct_match(qMol) || '{}') as { atoms?: number[] };
          if (Array.isArray(mj.atoms)) matchedAtoms = mj.atoms;
        }
        const fp = m.get_morgan_fp_as_uint8array(JSON.stringify({ radius: 2, nBits: 2048 })) as Uint8Array;
        const tanimoto = queryFp ? tanimotoUint8(queryFp, fp) : matchedAtoms.length > 0 ? 1 : 0;
        const svg = styleDarkSvg(
          matchedAtoms.length > 0
            ? m.get_svg_with_highlights(
                JSON.stringify({
                  width: 180,
                  height: 110,
                  atoms: matchedAtoms,
                  highlightColour: [0.22, 0.74, 0.97, 0.45],
                }),
              )
            : m.get_svg(180, 110),
        );
        hits.push({
          id: c.id,
          name: c.name,
          smiles: m.get_smiles(),
          substructureMatch: matchedAtoms.length > 0,
          tanimoto,
          svg,
        });
      } finally {
        m.delete();
      }
    }
  } finally {
    qMol?.delete();
    fpQueryMol?.delete();
  }

  return hits.sort((a, b) => {
    if (a.substructureMatch !== b.substructureMatch) return a.substructureMatch ? -1 : 1;
    return b.tanimoto - a.tanimoto;
  });
}
