import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadWasmBioCore } from '@synlexa/wasm-bridge';
import {
  BioEngineClient,
  BioEngineOperationError,
} from '../lib/bioEngineClient';
import { generateRuoHtmlReport } from '../lib/reportGenerator';
import { buildMolecularScene } from '../lib/structureAtoms';

async function loadFixturesAndClient() {
  const [wasmBytes, refCif, mobCif, paeJson] = await Promise.all([
    readFile(new URL('../../public/wasm/synlexa_bio_core.wasm', import.meta.url)),
    readFile(new URL('../../public/fixtures/3HS4.cif', import.meta.url), 'utf8'),
    readFile(new URL('../../public/fixtures/AF-P00918-F1-model_v6.cif', import.meta.url), 'utf8'),
    readFile(
      new URL('../../public/fixtures/AF-P00918-F1-predicted_aligned_error_v6.json', import.meta.url),
      'utf8',
    ),
  ]);

  const session = await loadWasmBioCore(new Uint8Array(wasmBytes));
  const client = BioEngineClient.fromWasmSession(session);
  return { session, client, refCif, mobCif, paeJson };
}

describe('Synlexa Wasm Bio-Core End-to-End Parity', () => {
  it('inspects and compares 3HS4.cif vs AF-P00918-F1-model_v6.cif + PAE deterministically', async () => {
    const { session, client, refCif, mobCif, paeJson } = await loadFixturesAndClient();

    const refInsp = await client.inspectStructure('inspect-ref', {
      label: '3HS4.cif',
      content: refCif,
      sourceTypeHint: 'experimental',
      license: 'CC0-1.0',
    });
    expect(refInsp.confidenceKind).toBe('experimental_b_factor');
    expect(refInsp.chains.length).toBe(1);
    expect(refInsp.chains[0].chainId).toBe('A');
    expect(refInsp.chains[0].observedCaCount).toBe(257);
    expect(refInsp.chains[0].declaredSeqLength).toBe(260);
    expect(refInsp.ligands.some((l) => l.resName === 'ZN')).toBe(true);
    expect(refInsp.ligands.some((l) => l.resName === 'AZM')).toBe(true);

    const mobInsp = await client.inspectStructure('inspect-mob', {
      label: 'AF-P00918-F1-model_v6.cif',
      content: mobCif,
      sourceTypeHint: 'prediction',
      license: 'CC-BY-4.0',
    });
    expect(mobInsp.confidenceKind).toBe('prediction_plddt');
    expect(mobInsp.chains[0].observedCaCount).toBe(260);

    // Binary fast-path extract_ca_coords_f64 parity
    const packed = session.extractCaCoordsF64({ content: refCif, chainId: 'A' }, 1024);
    expect(packed.length).toBe(257 * 4);
    const firstCa = refInsp.chains[0].residues.find((r) => r.ca != null)!.ca!;
    expect(packed[0]).toBeCloseTo(firstCa[0], 6);
    expect(packed[1]).toBeCloseTo(firstCa[1], 6);
    expect(packed[2]).toBeCloseTo(firstCa[2], 6);

    // Full structural comparison
    const cmp = await client.compareStructures({
      refLabel: '3HS4.cif',
      refContent: refCif,
      refChain: 'A',
      refMeta: { sourceTypeHint: 'experimental', license: 'CC0-1.0' },
      mobLabel: 'AF-P00918-F1-model_v6.cif',
      mobContent: mobCif,
      mobChain: 'A',
      mobMeta: { sourceTypeHint: 'prediction', license: 'CC-BY-4.0' },
      paeJson,
    });

    expect(cmp.metrics.matchedCaCount).toBe(257);
    expect(cmp.metrics.rmsdAngstrom).toBeCloseTo(0.368394, 5);
    expect(cmp.metrics.paeStatus).toBe('valid');
    expect(cmp.metrics.refCoverage.numerator).toBe(257);
    expect(cmp.metrics.refCoverage.denominator).toBe(260);
    expect(cmp.metrics.refCoverage.denominatorKind).toBe('declared_polymer_sequence');
    expect(cmp.refDisplayAtoms?.pocketAtoms.length).toBeGreaterThan(0);
    expect(cmp.refContacts?.some((c) => c.ligandResName === 'ZN')).toBe(true);
    expect(cmp.refContacts?.some((c) => c.ligandResName === 'AZM')).toBe(true);

    // Build 3D scene and generate RUO HTML report from real Wasm output
    const scene = buildMolecularScene({
      comparison: cmp,
      refInspect: refInsp,
      mobInspect: mobInsp,
      refChainId: 'A',
      mobChainId: 'A',
      colorMode: 'identity',
    });
    expect(scene.refResidues.length).toBe(257);
    expect(scene.mobResidues.length).toBe(260);
    expect(scene.activeSiteCenter).not.toBeNull();
    expect(scene.coordinationBonds.length).toBeGreaterThan(0);

    const html = generateRuoHtmlReport({ comparison: cmp });
    expect(html).toContain('0.3684');
    expect(html).toContain('RESEARCH USE ONLY');
  });

  it('enforces ERR_AMBIGUOUS_CHAIN when multi-chain PDB omits chain selection', async () => {
    const { client } = await loadFixturesAndClient();
    const twoChainPdb = [
      'ATOM      1  CA  ALA A   1       0.000   0.000   0.000  1.00 10.00           C',
      'ATOM      2  CA  GLY A   2       3.800   0.000   0.000  1.00 10.00           C',
      'ATOM      3  CA  SER A   3       7.600   0.000   0.000  1.00 10.00           C',
      'ATOM      4  CA  ALA B   1       0.000   5.000   0.000  1.00 10.00           C',
      'ATOM      5  CA  GLY B   2       3.800   5.000   0.000  1.00 10.00           C',
      'ATOM      6  CA  SER B   3       7.600   5.000   0.000  1.00 10.00           C',
      'END',
    ].join('\n');

    await expect(
      client.compareStructures({
        refLabel: 'multi.pdb',
        refContent: twoChainPdb,
        mobLabel: 'multi2.pdb',
        mobContent: twoChainPdb,
      }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof BioEngineOperationError && err.code === 'ERR_AMBIGUOUS_CHAIN',
    );
  });

  it('computes Peptide (H94A + 3D contacts), Gene/CRISPR (CA2), and SMILES (AZM) via Wasm', async () => {
    const { client, refCif } = await loadFixturesAndClient();

    const seq =
      'MSHHWGYGKHNGPEHWHKDFPIAKGERQSPVDIDTHTAKYDPSLKPLSVSYDQATSLRILNNGHAFNVEFDDSQDKAVLKGGPLDGTYRLIQFHFHWGSLDGQGSEHTVDKKKYAAELHLVHWNTKYGDFGKAVQQPDGLAVLGIFLKVGSAKPGLQKVVDVLDSIKTKGKSADFTNFDPRGLLPESLDYWTYPGSLTTPPLLECVTWIVLKEPISVSSEQVLKFRKLNFNGEGEPEELMVDNWRPAQPLKNRQIKASFK';

    const pep = await client.analyzePeptide({
      sequence: seq,
      mutations: ['H94A'],
      structureContent: refCif,
      chainId: 'A',
      focusSeqId: 94,
    });
    expect(pep.appliedMutations[0]?.notation).toBe('H94A');
    expect(pep.deltas.mwAverageDa).toBeLessThan(0);
    expect(pep.titrationCurve.length).toBeGreaterThan(10);
    expect(pep.local3dContacts.length).toBeGreaterThan(0);

    const crispr = await client.analyzeGeneCrispr({
      transcriptId: 'NM_000067.3',
      targetCodonIndex: 94,
      baseEditIndex: (94 - 1) * 3 + 1,
      newBase: 'G',
      nuclease: 'SpCas9',
    });
    expect(crispr.geneSymbol).toBe('CA2');
    expect(crispr.proteinLengthAa).toBe(260);
    expect(crispr.pamSites.length).toBeGreaterThan(0);

    const azm = await client.analyzeMoleculeSmiles({
      name: 'Acetazolamide',
      smiles: 'CC(=O)Nc1nnc(S(N)(=O)=O)s1',
    });
    expect(azm.formula).toBe('C4H6N4O3S2');
    expect(azm.molecularWeight).toBeCloseTo(222.25, 1);
    expect(azm.layout2d.atoms.length).toBe(13);
    expect(azm.layout2d.bonds.length).toBeGreaterThan(10);
  });
});
