import type {
  AnalyzeGeneCrisprResult,
  AnalyzeMoleculeSmilesResult,
  AnalyzePeptideResult,
  CompareStructuresResult,
} from '@synlexa/wasm-bridge';

export const RUO_DISCLAIMER =
  'RESEARCH USE ONLY (RUO). Not intended for clinical diagnosis, treatment selection, medical device use, or patient management.';

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '/': '&#x2F;',
};

export function escapeHtml(value: unknown): string {
  const str = value == null ? '' : String(value);
  return str.replace(/[&<>"'/]/g, (ch) => HTML_ESCAPE_MAP[ch] ?? ch);
}

export function isSafePngDataUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(url.trim());
}

export interface RuoReportOptions {
  comparison: CompareStructuresResult;
  peptide?: AnalyzePeptideResult | null;
  crispr?: AnalyzeGeneCrisprResult | null;
  smiles?: AnalyzeMoleculeSmilesResult | null;
  viewportPngDataUrl?: string | null;
  generatedAtUtc?: string;
}

export function buildRuoJsonManifest(opts: RuoReportOptions): string {
  const payload = {
    schemaVersion: '1.0.0',
    reportKind: 'synlexa-studio-ruo-manifest',
    ruoDisclaimer: RUO_DISCLAIMER,
    generatedAtUtc: opts.generatedAtUtc ?? new Date().toISOString(),
    comparison: opts.comparison,
    peptideEngineering: opts.peptide ?? null,
    geneCrispr: opts.crispr ?? null,
    smallMolecule: opts.smiles ?? null,
    hasEmbeddedViewportFigure: isSafePngDataUrl(opts.viewportPngDataUrl),
  };
  return JSON.stringify(payload, null, 2);
}

export function generateRuoHtmlReport(opts: RuoReportOptions): string {
  const { comparison, peptide, crispr, smiles, viewportPngDataUrl } = opts;
  const generatedAt = opts.generatedAtUtc ?? new Date().toISOString();
  const safePng = isSafePngDataUrl(viewportPngDataUrl) ? viewportPngDataUrl!.trim() : null;

  const matrixCells = comparison.transform.matrixRowMajor4x4
    .map((v) => `<td>${escapeHtml(v.toFixed(6))}</td>`)
    .reduce<string[][]>((rows, cell, idx) => {
      const r = Math.floor(idx / 4);
      if (!rows[r]) rows[r] = [];
      rows[r].push(cell);
      return rows;
    }, [])
    .map((row) => `<tr>${row.join('')}</tr>`)
    .join('\n');

  const topDeviations = [...comparison.matchedResidues]
    .sort((a, b) => b.distanceAngstrom - a.distanceAngstrom)
    .slice(0, 12)
    .map(
      (r) =>
        `<tr>
          <td>${escapeHtml(r.refSeqId)}${escapeHtml(r.refInsCode)}</td>
          <td>${escapeHtml(r.resName3)} (${escapeHtml(r.resCode1)})</td>
          <td>${escapeHtml(r.mobSeqId)}</td>
          <td>${escapeHtml(r.distanceAngstrom.toFixed(3))} &Aring;</td>
          <td>${r.refBFactor != null ? escapeHtml(r.refBFactor.toFixed(2)) : 'n/a'}</td>
          <td>${r.mobPlddt != null ? escapeHtml(r.mobPlddt.toFixed(2)) : 'n/a'}</td>
        </tr>`,
    )
    .join('\n');

  const contactsHtml =
    comparison.refContacts && comparison.refContacts.length > 0
      ? `<table>
          <thead><tr><th>Ligand</th><th>Ligand Atom</th><th>Residue</th><th>Protein Atom</th><th>Distance (&Aring;)</th></tr></thead>
          <tbody>
            ${comparison.refContacts
              .slice(0, 24)
              .map(
                (c) => `<tr>
                  <td>${escapeHtml(c.ligandResName)} ${escapeHtml(c.ligandChainId)}:${escapeHtml(c.ligandSeqId)}</td>
                  <td>${escapeHtml(c.ligandAtom)}</td>
                  <td>${escapeHtml(c.proteinResName3)} ${escapeHtml(c.proteinSeqId)}</td>
                  <td>${escapeHtml(c.proteinAtom)}</td>
                  <td>${escapeHtml(c.distanceAngstrom.toFixed(3))}</td>
                </tr>`,
              )
              .join('\n')}
          </tbody>
        </table>`
      : '<p class="muted">No non-water ligand contacts recorded within 4.5 &Aring;.</p>';

  const peptideSection = peptide
    ? `<section class="card">
        <h2>Peptide &amp; Protein Engineering Summary</h2>
        <p class="muted">Applied mutations: ${
          peptide.appliedMutations.length > 0
            ? peptide.appliedMutations.map((m) => escapeHtml(m.notation)).join(', ')
            : 'Wild-type (no mutations)'
        }</p>
        <table>
          <thead><tr><th>Descriptor</th><th>Wild-Type</th><th>Engineered</th><th>Delta</th></tr></thead>
          <tbody>
            <tr><td>Length</td><td>${escapeHtml(peptide.wildType.length)} aa</td><td>${escapeHtml(peptide.engineered.length)} aa</td><td>${escapeHtml(peptide.engineered.length - peptide.wildType.length)}</td></tr>
            <tr><td>Avg MW (Da)</td><td>${escapeHtml(peptide.wildType.mwAverageDa.toFixed(2))}</td><td>${escapeHtml(peptide.engineered.mwAverageDa.toFixed(2))}</td><td>${escapeHtml(peptide.deltas.mwAverageDa.toFixed(2))}</td></tr>
            <tr><td>Isoelectric Point (pI)</td><td>${escapeHtml(peptide.wildType.pi.toFixed(2))}</td><td>${escapeHtml(peptide.engineered.pi.toFixed(2))}</td><td>${escapeHtml(peptide.deltas.pi.toFixed(3))}</td></tr>
            <tr><td>Charge at pH 7.4</td><td>${escapeHtml(peptide.wildType.chargeAtPh74.toFixed(2))}</td><td>${escapeHtml(peptide.engineered.chargeAtPh74.toFixed(2))}</td><td>${escapeHtml(peptide.deltas.chargeAtPh74.toFixed(2))}</td></tr>
            <tr><td>GRAVY</td><td>${escapeHtml(peptide.wildType.gravy.toFixed(3))}</td><td>${escapeHtml(peptide.engineered.gravy.toFixed(3))}</td><td>${escapeHtml(peptide.deltas.gravy.toFixed(3))}</td></tr>
            <tr><td>Steric Volume Delta</td><td>&mdash;</td><td>&mdash;</td><td>${escapeHtml(peptide.deltas.stericVolumeDeltaA3.toFixed(1))} &Aring;&sup3;</td></tr>
          </tbody>
        </table>
      </section>`
    : '';

  const crisprSection = crispr
    ? `<section class="card">
        <h2>Gene Editing &amp; CRISPR Target Summary</h2>
        <p><strong>Transcript:</strong> ${escapeHtml(crispr.transcriptId)} (${escapeHtml(crispr.geneSymbol)}, ${escapeHtml(crispr.assembly)}) &middot; ${escapeHtml(crispr.cdsLengthBp)} bp / ${escapeHtml(crispr.proteinLengthAa)} aa</p>
        <p><strong>Codon ${escapeHtml(crispr.targetCodon.codonIndex1)}:</strong> ${escapeHtml(crispr.targetCodon.wtCodon)} (${escapeHtml(crispr.targetCodon.wtAa)}) &rarr; ${escapeHtml(crispr.targetCodon.editedCodon)} (${escapeHtml(crispr.targetCodon.editedAa)}) [<strong>${escapeHtml(crispr.targetCodon.consequence)}</strong>]</p>
        <p class="muted">Candidate PAM sites within window: ${escapeHtml(crispr.pamSites.length)}</p>
      </section>`
    : '';

  const smilesSection = smiles
    ? `<section class="card">
        <h2>Small-Molecule Chemistry Summary</h2>
        <p><strong>Name:</strong> ${escapeHtml(smiles.name)} &middot; <strong>SMILES:</strong> <code>${escapeHtml(smiles.smiles)}</code></p>
        <p><strong>Formula:</strong> ${escapeHtml(smiles.formula)} &middot; <strong>MW:</strong> ${escapeHtml(smiles.molecularWeight.toFixed(2))} Da &middot; <strong>TPSA:</strong> ${escapeHtml(smiles.tpsa.toFixed(2))} &Aring;&sup2; &middot; <strong>cLogP:</strong> ${escapeHtml(smiles.crippenLogP.toFixed(2))}</p>
        <p><strong>HBD/HBA:</strong> ${escapeHtml(smiles.hbd)} / ${escapeHtml(smiles.hba)} &middot; <strong>Lipinski Violations:</strong> ${escapeHtml(smiles.lipinskiViolations)} &middot; <strong>Veber Compliant:</strong> ${smiles.veberCompliant ? 'Yes' : 'No'}</p>
      </section>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Synlexa Studio RUO Report — ${escapeHtml(comparison.reference.label)} vs ${escapeHtml(comparison.mobile.label)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #090d14; color: #e2e8f0; margin: 0; padding: 32px; line-height: 1.5; }
    .wrap { max-width: 980px; margin: 0 auto; }
    .banner { background: #2c1d07; border: 1px solid #f59e0b; color: #fde68a; padding: 12px 16px; border-radius: 8px; font-weight: 600; font-size: 13px; margin-bottom: 20px; }
    h1 { font-size: 22px; margin: 0 0 6px; color: #f8fafc; }
    h2 { font-size: 15px; margin: 0 0 10px; color: #67e8f9; text-transform: uppercase; letter-spacing: 0.04em; }
    .muted { color: #94a3b8; font-size: 13px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin: 16px 0; }
    .metric { background: #111827; border: 1px solid #1e293b; border-radius: 8px; padding: 12px; }
    .metric .label { font-size: 11px; color: #94a3b8; text-transform: uppercase; }
    .metric .val { font-size: 20px; font-weight: 700; font-family: ui-monospace, monospace; color: #f8fafc; margin-top: 4px; }
    .card { background: #0f1623; border: 1px solid #1e293b; border-radius: 8px; padding: 16px; margin-top: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
    th, td { border-bottom: 1px solid #1e293b; text-align: left; padding: 6px 8px; font-family: ui-monospace, monospace; }
    th { color: #94a3b8; font-weight: 600; }
    code { background: #1e293b; padding: 2px 5px; border-radius: 4px; font-size: 12px; word-break: break-all; }
    img.figure { max-width: 100%; border-radius: 6px; border: 1px solid #1e293b; margin-top: 8px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="banner">${escapeHtml(RUO_DISCLAIMER)}</div>
    <h1>Synlexa Studio Comparison Report</h1>
    <p class="muted">Result ID: <code>${escapeHtml(comparison.resultId)}</code> &middot; Engine: ${escapeHtml(comparison.engine.name)} ${escapeHtml(comparison.engine.version)} (${escapeHtml(comparison.engine.target)}, ${escapeHtml(comparison.engine.floatPrecision)}) &middot; Generated: ${escapeHtml(generatedAt)}</p>

    <div class="grid">
      <div class="metric"><div class="label">C&alpha; RMSD</div><div class="val">${escapeHtml(comparison.metrics.rmsdAngstrom.toFixed(4))} &Aring;</div></div>
      <div class="metric"><div class="label">Matched C&alpha;</div><div class="val">${escapeHtml(comparison.metrics.matchedCaCount)}</div></div>
      <div class="metric"><div class="label">Ref Coverage</div><div class="val">${escapeHtml(comparison.metrics.refCoverage.numerator)} / ${escapeHtml(comparison.metrics.refCoverage.denominator)}</div><div class="muted">${escapeHtml(comparison.metrics.refCoverage.denominatorKind)}</div></div>
      <div class="metric"><div class="label">Mob Coverage</div><div class="val">${escapeHtml(comparison.metrics.mobCoverage.numerator)} / ${escapeHtml(comparison.metrics.mobCoverage.denominator)}</div><div class="muted">${escapeHtml(comparison.metrics.mobCoverage.denominatorKind)}</div></div>
    </div>

    ${
      safePng
        ? `<section class="card"><h2>3D Structural Superposition Figure</h2><img class="figure" src="${escapeHtml(safePng)}" alt="3D Structural Superposition" /></section>`
        : ''
    }

    <section class="card">
      <h2>Input Provenance &amp; SHA-256 Digests</h2>
      <table>
        <thead><tr><th>Role</th><th>Label</th><th>Chain</th><th>Confidence Metric</th><th>License</th><th>SHA-256</th></tr></thead>
        <tbody>
          <tr>
            <td>Reference</td>
            <td>${escapeHtml(comparison.reference.label)}</td>
            <td>${escapeHtml(comparison.reference.chainId)}</td>
            <td>${escapeHtml(comparison.reference.confidenceKind)}</td>
            <td>${escapeHtml(comparison.reference.license ?? 'user-supplied')}</td>
            <td><code>${escapeHtml(comparison.reference.sha256)}</code></td>
          </tr>
          <tr>
            <td>Mobile</td>
            <td>${escapeHtml(comparison.mobile.label)}</td>
            <td>${escapeHtml(comparison.mobile.chainId)}</td>
            <td>${escapeHtml(comparison.mobile.confidenceKind)}</td>
            <td>${escapeHtml(comparison.mobile.license ?? 'user-supplied')}</td>
            <td><code>${escapeHtml(comparison.mobile.sha256)}</code></td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="card">
      <h2>Rigid Transform Matrix (mobile_to_reference, row-major 4&times;4)</h2>
      <table><tbody>${matrixCells}</tbody></table>
    </section>

    <section class="card">
      <h2>Active-Site &amp; Ligand Pocket Contacts (&le; 4.5 &Aring;)</h2>
      ${contactsHtml}
    </section>

    <section class="card">
      <h2>Highest Per-Residue C&alpha; Deviations (Top 12)</h2>
      <table>
        <thead><tr><th>Ref Seq</th><th>Residue</th><th>Mob Seq</th><th>&Delta;d</th><th>Ref B-Factor (&Aring;&sup2;)</th><th>Mob pLDDT</th></tr></thead>
        <tbody>${topDeviations}</tbody>
      </table>
    </section>

    ${peptideSection}
    ${crisprSection}
    ${smilesSection}
  </div>
</body>
</html>`;
}
