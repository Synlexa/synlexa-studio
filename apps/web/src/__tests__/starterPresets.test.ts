import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadWasmBioCore } from '@synlexa/wasm-bridge';
import { BioEngineClient } from '../lib/bioEngineClient';
import { STARTER_PRESETS, WORKFLOW_STEPS } from '../lib/starterPresets';
import { SMILES_PRESETS } from '../lib/workbenchReducers';
import {
  explainClogP,
  explainPlddt,
  explainRmsd,
  explainTpsa,
  meanPaeFromJson,
} from '../lib/metricInsights';

const fixtureUrl = (name: string) => new URL(`../../public/fixtures/${name}`, import.meta.url);

async function makeClient() {
  const wasmBytes = await readFile(new URL('../../public/wasm/synlexa_bio_core.wasm', import.meta.url));
  const session = await loadWasmBioCore(new Uint8Array(wasmBytes));
  return BioEngineClient.fromWasmSession(session);
}

describe('Quick-Start starter presets (RUO)', () => {
  it('defines the 4-step Antigravity workflow and 5 starter cards', () => {
    expect(WORKFLOW_STEPS.map((s) => s.title)).toEqual([
      'Pick or Fetch Molecule',
      'Inspect 3D & Quality',
      'Engineer Peptide / CRISPR / Ligand',
      'Ask Gemini & Export',
    ]);
    expect(STARTER_PRESETS.map((p) => p.id)).toEqual([
      'ca2-azm',
      'ubiquitin',
      'hbb-e6v',
      'lysozyme',
      'chem-panel',
    ]);
  });

  it('only references fixtures pinned in the manifest with SHA-256 provenance', async () => {
    const manifest = JSON.parse(await readFile(fixtureUrl('fixtures-manifest.json'), 'utf8')) as {
      fixtures: Array<{ fileName: string; sha256: string; license: string; sourceUrl: string }>;
    };
    const byName = new Map(manifest.fixtures.map((f) => [f.fileName, f]));
    for (const p of STARTER_PRESETS) {
      for (const f of [p.reference?.fileName, p.mobile?.fileName, p.paeFileName]) {
        if (!f) continue;
        const entry = byName.get(f);
        expect(entry, `${p.id} -> ${f} in manifest`).toBeTruthy();
        expect(entry!.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(entry!.sourceUrl).toMatch(/^https:\/\//);
      }
      for (const id of [p.smilesPresetId, ...(p.smilesPanelIds ?? [])]) {
        if (!id) continue;
        expect(SMILES_PRESETS.some((s) => s.id === id), `${p.id} smiles ${id}`).toBe(true);
      }
    }
  });

  it('every protein starter superposes on its declared chains in the Wasm engine', async () => {
    const client = await makeClient();
    for (const p of STARTER_PRESETS.filter((s) => s.kind === 'protein-pair')) {
      const [refCif, mobCif] = await Promise.all([
        readFile(fixtureUrl(p.reference!.fileName), 'utf8'),
        readFile(fixtureUrl(p.mobile!.fileName), 'utf8'),
      ]);
      const res = await client.compareStructures(
        {
          refLabel: p.reference!.label,
          refContent: refCif,
          refChain: p.reference!.chainId,
          mobLabel: p.mobile!.label,
          mobContent: mobCif,
          mobChain: p.mobile!.chainId,
        },
        `starter-${p.id}`,
      );
      expect(res.metrics.matchedCaCount, p.id).toBeGreaterThan(30);
      expect(res.metrics.rmsdAngstrom, p.id).toBeLessThan(5);
      if (p.id !== 'ubiquitin') {
        expect(res.metrics.matchedCaCount, p.id).toBeGreaterThan(100);
        expect(res.metrics.rmsdAngstrom, p.id).toBeLessThan(1.5);
      }
      expect(res.reference.chainId).toBe(p.reference!.chainId);
    }
  }, 30000);

  it('HBB E6V starter maps to CDS codon 7 GAG→GTG (Glu→Val missense) and peptide E7V is valid', async () => {
    const client = await makeClient();
    const hbb = STARTER_PRESETS.find((p) => p.id === 'hbb-e6v')!;
    const c = hbb.crispr!;
    const res = await client.analyzeGeneCrispr({
      transcriptId: c.transcriptId,
      targetCodonIndex: c.targetCodonIndex,
      baseEditIndex: (c.targetCodonIndex - 1) * 3 + c.baseEditOffset + 1,
      newBase: c.newBase,
      nuclease: c.nuclease,
    });
    expect(res.geneSymbol).toBe('HBB');
    expect(res.targetCodon.wtCodon).toBe('GAG');
    expect(res.targetCodon.editedCodon).toBe('GTG');
    expect(res.targetCodon.consequence).toBe('missense');
    expect(res.targetCodon.dnaStartBp1 + c.baseEditOffset).toBe(20);

    const mobCif = await readFile(fixtureUrl(hbb.mobile!.fileName), 'utf8');
    const insp = await client.inspectStructure('hbb', { label: hbb.mobile!.label, content: mobCif });
    const seq = insp.chains[0].sequence1Letter;
    expect(seq[6]).toBe('E');
    const pep = await client.analyzePeptide({ sequence: seq, mutations: hbb.peptideMutations });
    expect(pep.appliedMutations[0].notation).toBe('E7V');
  });

  it('chemistry panel SMILES parse deterministically (Imatinib C29H31N7O)', async () => {
    const client = await makeClient();
    const imatinib = SMILES_PRESETS.find((s) => s.id === 'imatinib')!;
    const res = await client.analyzeMoleculeSmiles({ name: imatinib.name, smiles: imatinib.smiles });
    expect(res.formula).toBe('C29H31N7O');
  });
});

describe('Plain-English metric insights', () => {
  it('maps thresholds to calm labels', () => {
    expect(explainRmsd(0.368).label).toBe('High Structural Agreement');
    expect(explainRmsd(2.5).tone).toBe('moderate');
    expect(explainPlddt(93).label).toBe('Very High Confidence');
    expect(explainPlddt(40).tone).toBe('caution');
    expect(explainTpsa(115).label).toContain('Good Permeability');
    expect(explainTpsa(180).tone).toBe('caution');
    expect(explainClogP(6.1).label).toBe('Highly Lipophilic');
  });

  it('computes mean PAE from AlphaFold JSON', async () => {
    const pae = await readFile(fixtureUrl('AF-P00918-F1-predicted_aligned_error_v6.json'), 'utf8');
    const m = meanPaeFromJson(pae);
    expect(m).not.toBeNull();
    expect(m!).toBeGreaterThan(0);
    expect(meanPaeFromJson('not json')).toBeNull();
  });
});
