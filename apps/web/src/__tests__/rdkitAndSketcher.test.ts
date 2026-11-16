import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { RdkitClient } from '../lib/rdkitClient';
import {
  createEmptySketch,
  parseMolblockToSketch,
  serializeSketchToMolblock,
  stampTemplateIntoSketch,
} from '../lib/sketcherGraph';

const req = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const initRDKitModule = req('@rdkit/rdkit') as (opts?: unknown) => Promise<any>;

describe('RDKit MinimalLib WASM & 2D Sketcher (RUO)', () => {
  it('computes real RDKit descriptors, InChIKey, PAINS/Brenk alerts, and substructure search', async () => {
    const rdkit = await initRDKitModule();
    const client = RdkitClient.fromModule(rdkit);

    const azm = await client.analyzeMolecule('CC(=O)Nc1nnc(S(N)(=O)=O)s1');
    expect(azm.engine).toBe('rdkit-wasm');
    expect(azm.inchiKey).toBe('BZKPWHYZMXOIDC-UHFFFAOYSA-N');
    expect(azm.descriptors.heavyAtoms).toBe(13);
    expect(azm.descriptors.rings).toBe(1);
    expect(azm.alerts).toHaveLength(0);
    expect(azm.svg).toContain('<svg');

    // Nitrobenzene triggers Brenk-nitro alert; rhodanine triggers PAINS-rhodanine
    const nitro = await client.analyzeMolecule('[O-][N+](=O)c1ccccc1');
    expect(nitro.alerts.some((a) => a.id === 'Brenk-nitro')).toBe(true);

    const rhodanine = await client.analyzeMolecule('O=C1NC(=S)SC1');
    expect(rhodanine.alerts.some((a) => a.id === 'PAINS-rhodanine')).toBe(true);

    const hits = await client.searchLibrary('S(=O)(=O)N', [
      { id: 'azm', name: 'Acetazolamide', smiles: 'CC(=O)Nc1nnc(S(N)(=O)=O)s1' },
      { id: 'asp', name: 'Aspirin', smiles: 'CC(=O)Oc1ccccc1C(=O)O' },
    ]);
    expect(hits[0].id).toBe('azm');
    expect(hits[0].substructureMatch).toBe(true);
    expect(hits[1].substructureMatch).toBe(false);
  });

  it('round-trips a 2D Benzene sketch through V2000 MOL -> RDKit canonical SMILES -> sketch graph', async () => {
    const rdkit = await initRDKitModule();
    const client = RdkitClient.fromModule(rdkit);

    const sketch = stampTemplateIntoSketch(createEmptySketch(), 'benzene', 240, 150);
    expect(sketch.atoms).toHaveLength(6);
    expect(sketch.bonds).toHaveLength(6);

    const mol = serializeSketchToMolblock(sketch, 'BenzeneSketch');
    const analysis = await client.analyzeMolecule(mol);
    expect(analysis.canonicalSmiles).toBe('c1ccccc1');

    const reparsed = parseMolblockToSketch(analysis.molblock2d);
    expect(reparsed.atoms).toHaveLength(6);
    expect(reparsed.bonds).toHaveLength(6);

    const carboxyl = stampTemplateIntoSketch(createEmptySketch(), 'carboxyl', 200, 150);
    expect(carboxyl.atoms).toHaveLength(3);
    expect(carboxyl.bonds).toHaveLength(2);

    const amide = stampTemplateIntoSketch(createEmptySketch(), 'amide', 200, 150);
    expect(amide.atoms).toHaveLength(3);
    expect(amide.bonds).toHaveLength(2);
  });

  it('highlights all SMARTS substructure matches across a molecule', async () => {
    const rdkit = await initRDKitModule();
    const client = RdkitClient.fromModule(rdkit);

    const plain = await client.analyzeMolecule('CC(=O)Oc1ccccc1C(=O)O');
    const highlighted = await client.analyzeMolecule('CC(=O)Oc1ccccc1C(=O)O', {
      highlightSmarts: 'C(=O)',
    });
    expect(highlighted.svg).toContain('<svg');
    expect(highlighted.svg).not.toBe(plain.svg);
  });
});
