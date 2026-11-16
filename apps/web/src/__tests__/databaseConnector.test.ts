import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DatabaseExplorerModal } from '../components/DatabaseExplorerModal';
import type { FixtureManifest } from '../lib/bioEngineClient';
import {
  alphafoldPredictionUrl,
  DB_LICENSES,
  importCompoundRecord,
  importStructureRecord,
  MAX_DOWNLOAD_BYTES,
  OFFLINE_CATALOG,
  pubchemPropertyUrl,
  rcsbCifUrl,
  rcsbEntryUrl,
  rcsbSearchBody,
  rcsbSearchUrl,
  searchDatabase,
  sha256Hex,
  uniprotSearchUrl,
  type DbRecord,
} from '../lib/databaseConnector';

const FIXED_NOW = () => new Date('2026-11-15T12:00:00.000Z');

async function nodeSha256Hex(data: string | Uint8Array): Promise<string> {
  const modName = ['node', 'crypto'].join(':');
  const nodeCrypto = (await import(/* @vite-ignore */ modName)) as {
    createHash: (alg: string) => {
      update: (chunk: string | Uint8Array) => { digest: (enc: 'hex') => string };
    };
  };
  return nodeCrypto.createHash('sha256').update(data).digest('hex');
}

describe('databaseConnector URL builders & validation', () => {
  it('builds RCSB PDB search, entry, and mmCIF URLs and validates 4-alnum IDs', () => {
    expect(rcsbSearchUrl()).toBe('https://search.rcsb.org/rcsbsearch/v2/query');

    const body = JSON.parse(rcsbSearchBody('carbonic anhydrase')) as {
      query: { type: string; service: string; parameters: { value: string } };
      return_type: string;
      request_options: { paginate: { start: number; rows: number } };
    };
    expect(body).toEqual({
      query: {
        type: 'terminal',
        service: 'full_text',
        parameters: { value: 'carbonic anhydrase' },
      },
      return_type: 'entry',
      request_options: { paginate: { start: 0, rows: 10 } },
    });

    expect(rcsbEntryUrl('3hs4')).toBe('https://data.rcsb.org/rest/v1/core/entry/3HS4');
    expect(rcsbCifUrl('3hs4')).toBe('https://files.rcsb.org/download/3HS4.cif');

    expect(() => rcsbEntryUrl('')).toThrow();
    expect(() => rcsbEntryUrl('3HS')).toThrow();
    expect(() => rcsbCifUrl('12345')).toThrow();
    expect(() => rcsbCifUrl('3HS!')).toThrow();
    expect(() => rcsbCifUrl('../x')).toThrow();
  });

  it('builds AlphaFold DB prediction URLs and validates UniProtKB accessions', () => {
    expect(alphafoldPredictionUrl('p00918')).toBe(
      'https://alphafold.ebi.ac.uk/api/prediction/P00918',
    );
    expect(alphafoldPredictionUrl('A0A024R1R8')).toBe(
      'https://alphafold.ebi.ac.uk/api/prediction/A0A024R1R8',
    );

    expect(() => alphafoldPredictionUrl('')).toThrow();
    expect(() => alphafoldPredictionUrl('bad')).toThrow();
    expect(() => alphafoldPredictionUrl('123456')).toThrow();
    expect(() => alphafoldPredictionUrl('P00918;drop')).toThrow();
  });

  it('builds UniProtKB and PubChem PUG REST URLs and validates queries', () => {
    expect(uniprotSearchUrl('human hemoglobin')).toBe(
      'https://rest.uniprot.org/uniprotkb/search?query=human%20hemoglobin&fields=accession,id,protein_name,organism_name,length,gene_names&format=json&size=10',
    );
    expect(pubchemPropertyUrl('acetylsalicylic acid')).toBe(
      'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/acetylsalicylic%20acid/property/Title,MolecularFormula,MolecularWeight,CanonicalSMILES,IsomericSMILES,TPSA,XLogP,HBondDonorCount,HBondAcceptorCount,RotatableBondCount/JSON',
    );

    expect(() => rcsbSearchBody('   ')).toThrow();
    expect(() => uniprotSearchUrl('')).toThrow();
    expect(() => pubchemPropertyUrl('')).toThrow();
    expect(() => pubchemPropertyUrl('a'.repeat(201))).toThrow();
  });
});

describe('databaseConnector live-network parsing & provenance', () => {
  it('searches RCSB PDB live and attaches CC0-1.0, URLs, and UTC timestamp', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === rcsbSearchUrl()) {
        return new Response(
          JSON.stringify({ result_set: [{ identifier: '3HS4', score: 1.0 }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url === rcsbEntryUrl('3HS4')) {
        return new Response(
          JSON.stringify({
            struct: { title: 'Crystal structure of human carbonic anhydrase II' },
            exptl: [{ method: 'X-RAY DIFFRACTION' }],
            rcsb_entry_info: { resolution_combined: [1.1] },
            rcsb_accession_info: { revision_date: '2025-09-25T00:00:00+0000' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await searchDatabase('rcsb', 'carbonic anhydrase', {
      fetchImpl: fetchMock,
      now: FIXED_NOW,
    });

    expect(result.origin).toBe('live-network');
    expect(result.warning).toBeUndefined();
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      source: 'rcsb',
      id: '3HS4',
      title: 'Crystal structure of human carbonic anhydrase II',
      downloadUrl: 'https://files.rcsb.org/download/3HS4.cif',
      sourceUrl: 'https://www.rcsb.org/structure/3HS4',
      license: 'CC0-1.0',
      origin: 'live-network',
      retrievedAtUtc: '2026-11-15T12:00:00.000Z',
      dataRevision: 'PDB 3HS4 (2025-09-25)',
    });
  });

  it('searches UniProtKB and AlphaFold DB live and parses fields with CC-BY-4.0', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.startsWith('https://rest.uniprot.org/uniprotkb/search')) {
        return new Response(
          JSON.stringify({
            results: [
              {
                primaryAccession: 'P68871',
                uniProtkbId: 'HBB_HUMAN',
                proteinDescription: {
                  recommendedName: { fullName: { value: 'Hemoglobin subunit beta' } },
                },
                organism: { scientificName: 'Homo sapiens' },
                sequence: { length: 147 },
                genes: [{ geneName: { value: 'HBB' } }],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url === alphafoldPredictionUrl('P68871')) {
        return new Response(
          JSON.stringify([
            {
              entryId: 'AF-P68871-F1',
              uniprotAccession: 'P68871',
              uniprotId: 'HBB_HUMAN',
              uniprotDescription: 'Hemoglobin subunit beta',
              organismScientificName: 'Homo sapiens',
              uniprotEnd: 147,
              gene: 'HBB',
              latestVersion: 6,
              modelCreatedDate: '2025-08-01',
              cifUrl: 'https://alphafold.ebi.ac.uk/files/AF-P68871-F1-model_v6.cif',
              paeDocUrl:
                'https://alphafold.ebi.ac.uk/files/AF-P68871-F1-predicted_aligned_error_v6.json',
            },
          ]),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const up = await searchDatabase('uniprot', 'HBB', {
      fetchImpl: fetchMock,
      now: FIXED_NOW,
    });
    expect(up.origin).toBe('live-network');
    expect(up.records[0]).toMatchObject({
      source: 'uniprot',
      id: 'P68871',
      title: 'Hemoglobin subunit beta',
      organism: 'Homo sapiens',
      length: 147,
      license: 'CC-BY-4.0',
      origin: 'live-network',
      retrievedAtUtc: '2026-11-15T12:00:00.000Z',
    });

    const af = await searchDatabase('alphafold', 'P68871', {
      fetchImpl: fetchMock,
      now: FIXED_NOW,
    });
    expect(af.origin).toBe('live-network');
    expect(af.records[0]).toMatchObject({
      source: 'alphafold',
      id: 'AF-P68871-F1',
      title: 'Hemoglobin subunit beta',
      organism: 'Homo sapiens',
      length: 147,
      license: 'CC-BY-4.0',
      origin: 'live-network',
      dataRevision: 'AlphaFold DB v6 (modelCreatedDate 2025-08-01)',
    });
  });

  it('parses PubChem properties and prefers IsomericSMILES / modern SMILES keys', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          PropertyTable: {
            Properties: [
              {
                CID: 5291,
                Title: 'Imatinib',
                MolecularFormula: 'C29H31N7O',
                MolecularWeight: '493.6',
                CanonicalSMILES: 'CANONICAL_ONLY',
                IsomericSMILES: 'ISOMERIC_PREFERRED',
                TPSA: 86.3,
                XLogP: 3.5,
              },
              {
                CID: 1986,
                Title: 'Acetazolamide',
                MolecularFormula: 'C4H6N4O3S2',
                MolecularWeight: '222.3',
                SMILES: 'CC(=O)NC1=NN=C(S1)S(=O)(=O)N',
                ConnectivitySMILES: 'CONNECTIVITY_FALLBACK',
              },
            ],
          },
        }),
        { status: 200 },
      );
    });

    const res = await searchDatabase('pubchem', 'imatinib', {
      fetchImpl: fetchMock,
      now: FIXED_NOW,
    });
    expect(res.origin).toBe('live-network');
    expect(res.records).toHaveLength(2);
    expect(res.records[0].license).toBe(DB_LICENSES.pubchem);

    const c0 = importCompoundRecord(res.records[0]);
    expect(c0).toEqual({
      name: 'Imatinib',
      smiles: 'ISOMERIC_PREFERRED',
      cid: 5291,
      formula: 'C29H31N7O',
      molecularWeight: 493.6,
      sourceUrl: 'https://pubchem.ncbi.nlm.nih.gov/compound/5291',
      license: 'Public domain (NCBI/PubChem data policy)',
      retrievedAtUtc: '2026-11-15T12:00:00.000Z',
      origin: 'live-network',
    });

    const c1 = importCompoundRecord(res.records[1]);
    expect(c1.smiles).toBe('CC(=O)NC1=NN=C(S1)S(=O)(=O)N');
    expect(c1.cid).toBe(1986);
  });
});

describe('databaseConnector import & SHA-256 provenance', () => {
  it('matches Node crypto SHA-256 digest exactly', async () => {
    const sample = 'data_3HS4\n_entry.id 3HS4\n# Synlexa deterministic provenance check\n';
    const webCryptoDigest = await sha256Hex(sample);
    const nodeDigest = await nodeSha256Hex(sample);
    expect(webCryptoDigest).toBe(nodeDigest);
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('imports AlphaFold prediction by fetching cifUrl + paeDocUrl and hashing bytes', async () => {
    const cifBody = 'data_AF-P00918-F1\n_entry.id AF-P00918-F1\n';
    const paeBody = JSON.stringify([{ predicted_aligned_error: [[0, 1], [1, 0]] }]);

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === 'https://alphafold.ebi.ac.uk/api/prediction/P00918') {
        return new Response(
          JSON.stringify([
            {
              entryId: 'AF-P00918-F1',
              uniprotAccession: 'P00918',
              latestVersion: 6,
              modelCreatedDate: '2025-08-01',
              cifUrl: 'https://alphafold.ebi.ac.uk/files/AF-P00918-F1-model_v6.cif',
              paeDocUrl:
                'https://alphafold.ebi.ac.uk/files/AF-P00918-F1-predicted_aligned_error_v6.json',
            },
          ]),
          { status: 200 },
        );
      }
      if (url === 'https://alphafold.ebi.ac.uk/files/AF-P00918-F1-model_v6.cif') {
        return new Response(cifBody, { status: 200 });
      }
      if (
        url === 'https://alphafold.ebi.ac.uk/files/AF-P00918-F1-predicted_aligned_error_v6.json'
      ) {
        return new Response(paeBody, { status: 200 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const record: DbRecord = {
      source: 'alphafold',
      id: 'AF-P00918-F1',
      title: 'Human Carbonic Anhydrase 2',
      sourceUrl: 'https://alphafold.ebi.ac.uk/entry/P00918',
      license: 'CC-BY-4.0',
      origin: 'live-network',
      retrievedAtUtc: '2026-11-15T12:00:00.000Z',
      uniprotAccession: 'P00918',
    };

    const imported = await importStructureRecord(record, {
      fetchImpl: fetchMock,
      now: FIXED_NOW,
    });

    expect(imported.label).toBe('AF-P00918-F1.cif');
    expect(imported.content).toBe(cifBody);
    expect(imported.sha256).toBe(await nodeSha256Hex(cifBody));
    expect(imported.paeJson).toBe(paeBody);
    expect(imported.paeSha256).toBe(await nodeSha256Hex(paeBody));
    expect(imported.sourceTypeHint).toBe('prediction');
    expect(imported.dataRevision).toBe('AlphaFold DB v6 (modelCreatedDate 2025-08-01)');
    expect(imported.downloadUrl).toBe(
      'https://alphafold.ebi.ac.uk/files/AF-P00918-F1-model_v6.cif',
    );
    expect(imported.origin).toBe('live-network');
  });

  it('enforces the 50 MB size cap on structure downloads', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Response('tiny', {
        status: 200,
        headers: { 'Content-Length': String(MAX_DOWNLOAD_BYTES + 1) },
      });
    });

    const record: DbRecord = {
      source: 'rcsb',
      id: '3HS4',
      title: 'CA II',
      downloadUrl: rcsbCifUrl('3HS4'),
      sourceUrl: 'https://www.rcsb.org/structure/3HS4',
      license: 'CC0-1.0',
      origin: 'live-network',
      retrievedAtUtc: '2026-11-15T12:00:00.000Z',
    };

    await expect(
      importStructureRecord(record, { fetchImpl: fetchMock }),
    ).rejects.toThrow(/size cap/i);
  });
});

describe('databaseConnector offline & error fallback behavior', () => {
  it('falls back to pinned-local-cache on HTTP 429 with warning', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('Rate limited', { status: 429 }));

    const res = await searchDatabase('rcsb', 'ubiquitin', { fetchImpl: fetchMock });
    expect(res.origin).toBe('pinned-local-cache');
    expect(res.warning).toMatch(/429/);
    expect(res.records.map((r) => r.id)).toContain('1UBQ');
  });

  it('falls back to pinned-local-cache on network error with warning', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new TypeError('Failed to fetch');
    });

    const res = await searchDatabase('alphafold', 'P68871', { fetchImpl: fetchMock });
    expect(res.origin).toBe('pinned-local-cache');
    expect(res.warning).toMatch(/Failed to fetch/i);
    expect(res.records[0].id).toBe('AF-P68871-F1');
    expect(res.records[0].pinnedFileName).toBe('AF-P68871-F1-model_v6.cif');
  });

  it('uses pinned-local-cache directly when offline: true without external requests', async () => {
    const fetchSpy = vi.fn<typeof fetch>();

    const rcsbRes = await searchDatabase('rcsb', 'lysozyme', {
      offline: true,
      fetchImpl: fetchSpy,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(rcsbRes.origin).toBe('pinned-local-cache');
    expect(rcsbRes.records.map((r) => r.id)).toEqual(['1LZ1']);

    const upRes = await searchDatabase('uniprot', 'P00918', {
      offline: true,
      fetchImpl: fetchSpy,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(upRes.origin).toBe('pinned-local-cache');
    expect(upRes.records[0].id).toBe('P00918');
    // Must not invent organism or length when not present in manifest.
    expect(upRes.records[0].organism).toBeNull();
    expect(upRes.records[0].length).toBeNull();
  });

  it('loads PubChem offline from /fixtures/pubchem-panel.json if available, else CID+name only', async () => {
    const panelJson = await readFile(
      new URL('../../public/fixtures/pubchem-panel.json', import.meta.url),
      'utf8',
    );
    const panelFetch = vi.fn<typeof fetch>(async (input) => {
      if (String(input) === 'https://local.test/fixtures/pubchem-panel.json') {
        return new Response(panelJson, { status: 200 });
      }
      throw new Error(`Unexpected URL ${String(input)}`);
    });

    const withPanel = await searchDatabase('pubchem', 'imatinib', {
      offline: true,
      fetchImpl: panelFetch,
      fixturesBaseUrl: 'https://local.test/fixtures/',
    });
    expect(withPanel.origin).toBe('pinned-local-cache');
    expect(withPanel.records[0].id).toBe('5291');
    expect(withPanel.records[0].smiles).toBeTruthy();
    expect(importCompoundRecord(withPanel.records[0]).cid).toBe(5291);

    const brokenFetch = vi.fn<typeof fetch>(async () => new Response('missing', { status: 404 }));
    const withoutPanel = await searchDatabase('pubchem', 'imatinib', {
      offline: true,
      fetchImpl: brokenFetch,
      fixturesBaseUrl: 'https://local.test/fixtures/',
    });
    expect(withoutPanel.origin).toBe('pinned-local-cache');
    expect(withoutPanel.records[0].id).toBe('5291');
    expect(withoutPanel.records[0].title).toBe('Imatinib');
    expect(withoutPanel.records[0].smiles).toBeNull();
    expect(withoutPanel.records[0].molecularWeight).toBeNull();
    expect(() => importCompoundRecord(withoutPanel.records[0])).toThrow(/No SMILES/);
  });

  it('imports pinned fixtures via configurable fixturesBaseUrl and matches fixtures-manifest.json', async () => {
    const rawManifest = await readFile(
      new URL('../../public/fixtures/fixtures-manifest.json', import.meta.url),
      'utf8',
    );
    const manifest = JSON.parse(rawManifest) as FixtureManifest;

    for (const s of OFFLINE_CATALOG.structures) {
      const mEntry = manifest.fixtures.find((f) => f.fileName === s.fileName);
      expect(mEntry).toBeDefined();
      expect(s.sha256).toBe(mEntry?.sha256);
      expect(s.sourceUrl).toBe(mEntry?.sourceUrl);
      expect(s.license).toBe(mEntry?.license);
    }

    const afBytes = await readFile(
      new URL('../../public/fixtures/AF-P00918-F1-model_v6.cif', import.meta.url),
    );
    const paeText = await readFile(
      new URL('../../public/fixtures/AF-P00918-F1-predicted_aligned_error_v6.json', import.meta.url),
      'utf8',
    );

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === 'https://cache.local/fixtures/AF-P00918-F1-model_v6.cif') {
        return new Response(new Uint8Array(afBytes), { status: 200 });
      }
      if (
        url === 'https://cache.local/fixtures/AF-P00918-F1-predicted_aligned_error_v6.json'
      ) {
        return new Response(paeText, { status: 200 });
      }
      throw new Error(`Unexpected fixture URL: ${url}`);
    });

    const res = await searchDatabase('alphafold', 'AF-P00918', { offline: true });
    const imported = await importStructureRecord(res.records[0], {
      fetchImpl: fetchMock,
      fixturesBaseUrl: 'https://cache.local/fixtures/',
    });

    const manifestAf = manifest.fixtures.find(
      (f) => f.fileName === 'AF-P00918-F1-model_v6.cif',
    );
    expect(imported.origin).toBe('pinned-local-cache');
    expect(imported.sha256).toBe(manifestAf?.sha256);
    expect(imported.sha256).toBe(await nodeSha256Hex(afBytes));
    expect(imported.paeJson).toBe(paeText);
    expect(imported.warnings).toEqual([]);
  });

  it('imports live RCSB PDB mmCIF with experimental sourceTypeHint and null PAE', async () => {
    const cifBody = 'data_1UBQ\n_entry.id 1UBQ\n';
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      expect(String(input)).toBe('https://files.rcsb.org/download/1UBQ.cif');
      return new Response(cifBody, { status: 200 });
    });

    const imported = await importStructureRecord(
      {
        source: 'rcsb',
        id: '1UBQ',
        title: 'Structure of ubiquitin',
        downloadUrl: 'https://files.rcsb.org/download/1UBQ.cif',
        sourceUrl: 'https://www.rcsb.org/structure/1UBQ',
        license: 'CC0-1.0',
        origin: 'live-network',
        retrievedAtUtc: '2026-11-15T12:00:00.000Z',
        dataRevision: 'PDB 1UBQ (2024-02-14)',
      },
      { fetchImpl: fetchMock, now: FIXED_NOW },
    );

    expect(imported.label).toBe('1UBQ.cif');
    expect(imported.sourceTypeHint).toBe('experimental');
    expect(imported.paeJson).toBeNull();
    expect(imported.sha256).toBe(await nodeSha256Hex(cifBody));
    expect(imported.license).toBe('CC0-1.0');
  });
});

describe('DatabaseExplorerModal SSR smoke', () => {
  it('renders closed as empty and open with 4 source tabs, chips, offline toggle, and RUO footer', () => {
    const closedHtml = renderToStaticMarkup(
      createElement(DatabaseExplorerModal, {
        open: false,
        onClose: () => {},
        onImportStructure: () => {},
        onImportCompound: () => {},
      }),
    );
    expect(closedHtml).toBe('');

    const openHtml = renderToStaticMarkup(
      createElement(DatabaseExplorerModal, {
        open: true,
        onClose: () => {},
        onImportStructure: () => {},
        onImportCompound: () => {},
        defaultSource: 'rcsb',
      }),
    );
    expect(openHtml).toContain('RCSB PDB');
    expect(openHtml).toContain('AlphaFold DB');
    expect(openHtml).toContain('UniProtKB');
    expect(openHtml).toContain('PubChem');
    expect(openHtml).toContain('ChEMBL');
    expect(openHtml).toContain('Open Targets');
    expect(openHtml).toContain('carbonic anhydrase');
    expect(openHtml).toContain('RESEARCH USE ONLY (RUO)');
  });

  it('queries live ChEMBL and Open Targets endpoints with provenance', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes('ebi.ac.uk/chembl')) {
        return new Response(
          JSON.stringify({
            molecules: [
              {
                molecule_chembl_id: 'CHEMBL20',
                pref_name: 'ACETAZOLAMIDE',
                max_phase: 4,
                molecule_structures: { canonical_smiles: 'CC(=O)Nc1nnc(S(N)(=O)=O)s1' },
                molecule_properties: { full_molformula: 'C4H6N4O3S2', full_mwt: '222.25' },
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          data: {
            search: {
              hits: [{ id: 'ENSG00000104267', name: 'CA2', description: 'Carbonic anhydrase 2' }],
            },
          },
        }),
        { status: 200 },
      );
    });

    const chemblRes = await searchDatabase('chembl', 'acetazolamide', { fetchImpl: fetchMock, now: FIXED_NOW });
    expect(chemblRes.records).toHaveLength(1);
    expect(chemblRes.records[0].id).toBe('CHEMBL20');
    const comp = importCompoundRecord(chemblRes.records[0]);
    expect(comp.smiles).toBe('CC(=O)Nc1nnc(S(N)(=O)=O)s1');
    expect(comp.license).toBe('CC-BY-SA-3.0');

    const otRes = await searchDatabase('opentargets', 'CA2', { fetchImpl: fetchMock, now: FIXED_NOW });
    expect(otRes.records).toHaveLength(1);
    expect(otRes.records[0].id).toBe('ENSG00000104267');
    expect(otRes.records[0].sourceUrl).toContain('platform.opentargets.org');
  });
});

