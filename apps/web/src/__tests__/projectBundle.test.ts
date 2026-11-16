import { describe, expect, it } from 'vitest';
import {
  BundleValidationError,
  computeSha256Hex,
  createProjectBundle,
  parseAndValidateProjectBundle,
  validateSafeBundlePath,
} from '../lib/projectBundle';

describe('Project Bundle (.synlexa.bundle.json) Security & Validation', () => {
  it('round-trips a valid project bundle with verified SHA-256 digests', async () => {
    const bundle = await createProjectBundle({
      refLabel: '3HS4.cif',
      refContent: 'data_3HS4\n#\n',
      mobLabel: 'AF-P00918.cif',
      mobContent: 'data_AF\n#\n',
      paeJson: '[{"predicted_aligned_error":[[0]]}]',
      comparisonResult: null,
      state: {
        refChain: 'A',
        mobChain: 'A',
        focusedSeqId: 94,
        peptide: { sequence: 'MSHHWGY', mutations: ['H4A'], sliceStart: 1, sliceEnd: 7 },
        crispr: { transcriptId: 'NM_000067.3', customDna: '', targetCodonIndex: 94, nuclease: 'SpCas9' },
        smiles: { name: 'AZM', smiles: 'CC(=O)Nc1nnc(S(N)(=O)=O)s1' },
      },
    });

    const parsed = await parseAndValidateProjectBundle(JSON.stringify(bundle));
    expect(parsed.files.length).toBe(3);
    expect(parsed.state.refChain).toBe('A');
  });

  it('rejects path traversal, absolute paths, and encoded traversal sequences', () => {
    const badPaths = [
      '../secret.txt',
      'structures/../../etc/passwd',
      '/etc/passwd',
      'C:\\Windows\\System32\\cmd.exe',
      'structures\\ref.cif',
      '%2e%2e/foo.cif',
      'structures/./ref.cif',
      'structures//ref.cif',
      '',
    ];

    for (const bad of badPaths) {
      expect(() => validateSafeBundlePath(bad)).toThrowError(BundleValidationError);
    }
  });

  it('rejects tampered file contents with SHA-256 mismatch', async () => {
    const bundle = await createProjectBundle({
      refLabel: '3HS4.cif',
      refContent: 'HEADER ORIGINAL',
      mobLabel: 'AF.cif',
      mobContent: 'HEADER MOBILE',
      comparisonResult: null,
      state: {
        refChain: 'A',
        mobChain: 'A',
        focusedSeqId: null,
        peptide: { sequence: 'MSHH', mutations: [] },
        crispr: { transcriptId: 'NM_000067.3', customDna: '', targetCodonIndex: 1, nuclease: 'SpCas9' },
        smiles: { name: 'AZM', smiles: 'CC(=O)Nc1nnc(S(N)(=O)=O)s1' },
      },
    });

    bundle.files[0].content = 'HEADER TAMPERED';

    await expect(
      parseAndValidateProjectBundle(JSON.stringify(bundle)),
    ).rejects.toMatchObject({
      code: 'ERR_BUNDLE_HASH_MISMATCH',
    });
  });

  it('rejects duplicate paths in bundle manifest', async () => {
    const hash = await computeSha256Hex('abc');
    const badBundle = {
      schemaVersion: '1.0.0',
      bundleFormat: 'synlexa-studio-bundle-v1',
      ruoNotice: 'RUO',
      exportedAtUtc: '2026-11-15T00:00:00Z',
      files: [
        { path: 'structures/a.cif', role: 'reference', label: 'a', sha256: hash, content: 'abc' },
        { path: 'structures/a.cif', role: 'mobile', label: 'b', sha256: hash, content: 'abc' },
      ],
      state: {
        refChain: 'A',
        mobChain: 'A',
        focusedSeqId: null,
        peptide: { sequence: 'A', mutations: [] },
        crispr: { transcriptId: 'NM_000067.3', customDna: '', targetCodonIndex: 1, nuclease: 'SpCas9' },
        smiles: { name: 'AZM', smiles: 'C' },
      },
      comparisonResult: null,
    };

    await expect(
      parseAndValidateProjectBundle(JSON.stringify(badBundle)),
    ).rejects.toMatchObject({
      code: 'ERR_BUNDLE_DUPLICATE_PATH',
    });
  });
});
