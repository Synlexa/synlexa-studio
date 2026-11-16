import { describe, expect, it } from 'vitest';
import type { CompareStructuresResult } from '@synlexa/wasm-bridge';
import {
  buildRuoJsonManifest,
  escapeHtml,
  generateRuoHtmlReport,
  isSafePngDataUrl,
  RUO_DISCLAIMER,
} from '../lib/reportGenerator';

function makeFixtureComparison(overrides?: Partial<CompareStructuresResult>): CompareStructuresResult {
  return {
    schemaVersion: '1.0.0',
    ruoNotice: RUO_DISCLAIMER,
    resultId: 'res-test-1',
    engine: {
      name: 'synlexa-bio-core',
      version: '0.1.0',
      target: 'wasm-rust',
      floatPrecision: 'float64',
    },
    createdAtUtc: '2026-11-15T09:00:00Z',
    reference: {
      label: '3HS4.cif',
      chainId: 'A',
      authChainId: 'A',
      modelIndex: 1,
      sha256: 'a'.repeat(64),
      confidenceKind: 'experimental_b_factor',
      sourceUrl: 'https://files.rcsb.org/download/3HS4.cif',
      dataRevision: '2025-09-25',
      retrievedAtUtc: '2026-11-15T09:05:30Z',
      license: 'CC0-1.0',
    },
    mobile: {
      label: 'AF-P00918-F1-model_v6.cif',
      chainId: 'A',
      authChainId: 'A',
      modelIndex: 1,
      sha256: 'b'.repeat(64),
      confidenceKind: 'prediction_plddt',
      sourceUrl: 'https://alphafold.ebi.ac.uk/files/AF-P00918-F1-model_v6.cif',
      dataRevision: 'v6',
      retrievedAtUtc: '2026-11-15T09:06:04Z',
      license: 'CC-BY-4.0',
    },
    metrics: {
      matchedCaCount: 257,
      rmsdAngstrom: 0.4215,
      units: 'angstrom',
      refCoverage: {
        numerator: 257,
        denominator: 260,
        denominatorKind: 'declared_polymer_sequence',
        ratio: 257 / 260,
      },
      mobCoverage: {
        numerator: 257,
        denominator: 260,
        denominatorKind: 'declared_polymer_sequence',
        ratio: 257 / 260,
      },
      paeStatus: 'valid',
    },
    transform: {
      direction: 'mobile_to_reference',
      matrixRowMajor4x4: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    },
    matchedResidues: [
      {
        refSeqId: 94,
        refInsCode: '',
        mobSeqId: 94,
        mobInsCode: '',
        resName3: 'HIS',
        resCode1: 'H',
        distanceAngstrom: 0.21,
        refBFactor: 4.53,
        mobPlddt: 98.4,
      },
    ],
    ...overrides,
  };
}

describe('RUO Report Generator & HTML Escaping', () => {
  it('escapes HTML and script injection payloads cleanly', () => {
    const raw = `<script>alert("xss")</script>' & <img src=x onerror=alert(1)>`;
    const escaped = escapeHtml(raw);
    expect(escaped).not.toContain('<script>');
    expect(escaped).not.toContain('<img');
    expect(escaped).toContain('&lt;script&gt;');
    expect(escaped).toContain('&#39;');
    expect(escaped).toContain('&quot;');
    expect(escaped).toContain('&amp;');
  });

  it('sanitizes untrusted labels, SMILES, and viewport URLs in HTML report', () => {
    const cmp = makeFixtureComparison();
    cmp.reference.label = `<script>window.pwn=1</script>`;
    cmp.mobile.label = `" onclick="alert(1)`;

    const html = generateRuoHtmlReport({
      comparison: cmp,
      viewportPngDataUrl: 'javascript:alert(1)',
      smiles: {
        ruoNotice: RUO_DISCLAIMER,
        name: '<svg onload=alert(1)>',
        smiles: 'C<script>O',
        formula: 'CH4O',
        molecularWeight: 32.04,
        exactMass: 32.026,
        heavyAtomCount: 2,
        ringCount: 0,
        aromaticAtomCount: 0,
        hbd: 1,
        hba: 1,
        rotatableBonds: 0,
        tpsa: 20.2,
        crippenLogP: -0.7,
        lipinskiViolations: 0,
        veberCompliant: true,
        layout2d: { atoms: [], bonds: [] },
      },
    });

    expect(html).toContain('RESEARCH USE ONLY (RUO)');
    expect(html).not.toContain('<script>window.pwn=1</script>');
    expect(html).not.toContain('javascript:alert(1)');
    expect(html).not.toContain('<svg onload=alert(1)>');
    expect(html).toContain('&lt;script&gt;window.pwn=1&lt;&#x2F;script&gt;');
  });

  it('accepts valid base64 PNG data URLs and embeds figure cleanly', () => {
    const validPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    expect(isSafePngDataUrl(validPng)).toBe(true);
    expect(isSafePngDataUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);

    const html = generateRuoHtmlReport({
      comparison: makeFixtureComparison(),
      viewportPngDataUrl: validPng,
    });
    expect(html).toContain('<img class="figure" src="data:image&#x2F;png;base64,');
  });

  it('builds valid JSON manifest with RUO disclaimer', () => {
    const json = buildRuoJsonManifest({ comparison: makeFixtureComparison() });
    const parsed = JSON.parse(json);
    expect(parsed.reportKind).toBe('synlexa-studio-ruo-manifest');
    expect(parsed.ruoDisclaimer).toContain('RESEARCH USE ONLY');
    expect(parsed.comparison.metrics.rmsdAngstrom).toBeCloseTo(0.4215, 4);
  });
});
