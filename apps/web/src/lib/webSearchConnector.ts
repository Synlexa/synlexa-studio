/**
 * Live Scientific Web & Literature Search Connector (Research-Use-Only).
 *
 * Queries public, CORS-enabled scientific APIs directly from the user's machine:
 *  - Europe PMC REST API (peer-reviewed papers & preprints, PMID / PMCID / DOI)
 *  - ClinicalTrials.gov API v2 (registered studies, NCT ID, phase, status)
 *
 * Provenance rules (AGENTS.md):
 *  - Never fabricate or guess PMIDs, DOIs, NCT IDs, p-values, or cohorts.
 *  - Every returned record keeps sourceUrl, identifier, UTC retrieval timestamp,
 *    sourceType, and extractionMethod. Missing fields remain null.
 */

export type WebSearchScope = 'all' | 'literature' | 'trials';

export interface ScientificWebHit {
  source: 'europepmc' | 'clinicaltrials' | 'pinned-reference';
  sourceType: 'peer_reviewed_literature' | 'preprint' | 'trial_registry' | 'pinned_fixture_citation';
  identifier: string;
  pmid: string | null;
  pmcid: string | null;
  doi: string | null;
  nctId: string | null;
  title: string;
  authorsOrSponsor: string | null;
  journalOrStatus: string | null;
  yearOrPhase: string | null;
  snippet: string | null;
  sourceUrl: string;
  retrievedAtUtc: string;
  extractionMethod: string;
}

export interface ScientificWebSearchResult {
  query: string;
  scope: WebSearchScope;
  origin: 'live-network' | 'offline-fallback';
  retrievedAtUtc: string;
  hits: ScientificWebHit[];
  warnings: string[];
}

export interface WebSearchOptions {
  scope?: WebSearchScope;
  limit?: number;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  offline?: boolean;
}

const PINNED_REFERENCE_HITS: Omit<ScientificWebHit, 'retrievedAtUtc'>[] = [
  {
    source: 'pinned-reference',
    sourceType: 'pinned_fixture_citation',
    identifier: 'PDB:3HS4',
    pmid: null,
    pmcid: null,
    doi: '10.2210/pdb3HS4/pdb',
    nctId: null,
    title: 'Crystal structure of human carbonic anhydrase II complexed with acetazolamide (1.10 Å, PDB 3HS4)',
    authorsOrSponsor: 'Sjoblom et al.',
    journalOrStatus: 'RCSB Protein Data Bank (CC0-1.0)',
    yearOrPhase: '2009 / rev 2025-09-25',
    snippet: 'Bundled SHA-256 verified reference structure 3HS4.cif in Synlexa Studio local fixtures.',
    sourceUrl: 'https://www.rcsb.org/structure/3HS4',
    extractionMethod: 'pinned-manifest-record',
  },
  {
    source: 'pinned-reference',
    sourceType: 'pinned_fixture_citation',
    identifier: 'AF-P00918-F1',
    pmid: null,
    pmcid: null,
    doi: null,
    nctId: null,
    title: 'AlphaFold Protein Structure Database prediction for Human Carbonic Anhydrase 2 (UniProt P00918, v6)',
    authorsOrSponsor: 'Jumper et al. / Varadi et al. (EMBL-EBI / Google DeepMind)',
    journalOrStatus: 'AlphaFold DB v6 (CC-BY-4.0)',
    yearOrPhase: '2025-08-01',
    snippet: 'Bundled SHA-256 verified model AF-P00918-F1-model_v6.cif and 260x260 PAE JSON.',
    sourceUrl: 'https://alphafold.ebi.ac.uk/entry/P00918',
    extractionMethod: 'pinned-manifest-record',
  },
];

function cleanStr(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function truncateText(s: string | null, max = 320): string | null {
  if (!s) return null;
  const clean = s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

async function searchEuropePmc(
  query: string,
  limit: number,
  fetchFn: typeof fetch,
  nowUtc: string,
  signal?: AbortSignal,
): Promise<ScientificWebHit[]> {
  const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&format=json&resultType=core&pageSize=${limit}`;
  const res = await fetchFn(url, { signal });
  if (!res.ok) throw new Error(`Europe PMC returned HTTP ${res.status}`);
  const data = (await res.json()) as {
    resultList?: { result?: Array<Record<string, unknown>> };
  };
  const rows = Array.isArray(data?.resultList?.result) ? data.resultList.result : [];
  return rows.map((row): ScientificWebHit => {
    const pmid = cleanStr(row.pmid);
    const pmcid = cleanStr(row.pmcid);
    const doi = cleanStr(row.doi);
    const id = cleanStr(row.id) ?? pmid ?? pmcid ?? doi ?? 'epmc-record';
    const srcCode = cleanStr(row.source) ?? 'MED';
    const isPreprint = srcCode === 'PPR';
    const sourceUrl = pmid
      ? `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(pmid)}/`
      : pmcid
        ? `https://europepmc.org/article/PMC/${encodeURIComponent(pmcid)}`
        : doi
          ? `https://doi.org/${doi}`
          : `https://europepmc.org/article/${encodeURIComponent(srcCode)}/${encodeURIComponent(id)}`;

    return {
      source: 'europepmc',
      sourceType: isPreprint ? 'preprint' : 'peer_reviewed_literature',
      identifier: pmid ? `PMID:${pmid}` : pmcid ? `PMCID:${pmcid}` : doi ? `DOI:${doi}` : id,
      pmid,
      pmcid,
      doi,
      nctId: null,
      title: cleanStr(row.title) ?? 'Untitled Europe PMC record',
      authorsOrSponsor: cleanStr(row.authorString),
      journalOrStatus: cleanStr(row.journalTitle) ?? cleanStr(row.bookOrReportDetails?.toString?.()),
      yearOrPhase: cleanStr(row.pubYear),
      snippet: truncateText(cleanStr(row.abstractText)),
      sourceUrl,
      retrievedAtUtc: nowUtc,
      extractionMethod: 'europepmc-rest-api',
    };
  });
}

async function searchClinicalTrials(
  query: string,
  limit: number,
  fetchFn: typeof fetch,
  nowUtc: string,
  signal?: AbortSignal,
): Promise<ScientificWebHit[]> {
  const url = `https://clinicaltrials.gov/api/v2/studies?query.term=${encodeURIComponent(query)}&pageSize=${limit}`;
  const res = await fetchFn(url, { signal });
  if (!res.ok) throw new Error(`ClinicalTrials.gov returned HTTP ${res.status}`);
  const data = (await res.json()) as {
    studies?: Array<{
      protocolSection?: {
        identificationModule?: { nctId?: string; briefTitle?: string; organization?: { fullName?: string } };
        statusModule?: { overallStatus?: string; startDateStruct?: { date?: string } };
        designModule?: { phases?: string[] };
        conditionsModule?: { conditions?: string[] };
        descriptionModule?: { briefSummary?: string };
      };
    }>;
  };
  const studies = Array.isArray(data?.studies) ? data.studies : [];
  return studies.map((st): ScientificWebHit => {
    const idMod = st.protocolSection?.identificationModule;
    const stMod = st.protocolSection?.statusModule;
    const desMod = st.protocolSection?.designModule;
    const descMod = st.protocolSection?.descriptionModule;
    const nctId = cleanStr(idMod?.nctId) ?? 'NCT_UNKNOWN';
    const phases = Array.isArray(desMod?.phases) && desMod.phases.length > 0 ? desMod.phases.join(', ') : null;
    const conditions = Array.isArray(st.protocolSection?.conditionsModule?.conditions)
      ? st.protocolSection.conditionsModule.conditions.slice(0, 3).join(', ')
      : null;
    return {
      source: 'clinicaltrials',
      sourceType: 'trial_registry',
      identifier: nctId,
      pmid: null,
      pmcid: null,
      doi: null,
      nctId,
      title: cleanStr(idMod?.briefTitle) ?? `ClinicalTrials.gov study ${nctId}`,
      authorsOrSponsor: cleanStr(idMod?.organization?.fullName),
      journalOrStatus: cleanStr(stMod?.overallStatus),
      yearOrPhase: [phases, cleanStr(stMod?.startDateStruct?.date)].filter(Boolean).join(' · ') || null,
      snippet: truncateText(cleanStr(descMod?.briefSummary) ?? conditions),
      sourceUrl: `https://clinicaltrials.gov/study/${encodeURIComponent(nctId)}`,
      retrievedAtUtc: nowUtc,
      extractionMethod: 'clinicaltrials-gov-apiv2',
    };
  });
}

export async function searchScientificWeb(
  rawQuery: string,
  opts: WebSearchOptions = {},
): Promise<ScientificWebSearchResult> {
  const query = rawQuery.trim();
  const scope: WebSearchScope = opts.scope ?? 'all';
  const limit = Math.max(1, Math.min(8, opts.limit ?? 5));
  const nowUtc = new Date().toISOString();
  const warnings: string[] = [];

  if (!query) {
    throw new Error('Web search query must not be empty.');
  }

  const fetchFn = opts.fetchImpl ?? globalThis.fetch;
  const offline = Boolean(opts.offline) || (typeof navigator !== 'undefined' && navigator.onLine === false) || typeof fetchFn !== 'function';

  if (offline) {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    const localHits = PINNED_REFERENCE_HITS.filter((h) => {
      const text = `${h.identifier} ${h.title} ${h.snippet ?? ''}`.toLowerCase();
      return tokens.some((t) => text.includes(t));
    }).map((h) => ({ ...h, retrievedAtUtc: nowUtc }));
    return {
      query,
      scope,
      origin: 'offline-fallback',
      retrievedAtUtc: nowUtc,
      hits: localHits,
      warnings: ['Offline mode or unavailable network: returned pinned local citations only.'],
    };
  }

  const hits: ScientificWebHit[] = [];
  const tasks: Array<Promise<void>> = [];

  if (scope === 'all' || scope === 'literature') {
    tasks.push(
      searchEuropePmc(query, limit, fetchFn, nowUtc, opts.signal)
        .then((rows) => {
          hits.push(...rows);
        })
        .catch((err) => {
          warnings.push(err instanceof Error ? err.message : String(err));
        }),
    );
  }

  if (scope === 'all' || scope === 'trials') {
    tasks.push(
      searchClinicalTrials(query, Math.min(4, limit), fetchFn, nowUtc, opts.signal)
        .then((rows) => {
          hits.push(...rows);
        })
        .catch((err) => {
          warnings.push(err instanceof Error ? err.message : String(err));
        }),
    );
  }

  await Promise.all(tasks);

  if (hits.length === 0 && warnings.length > 0) {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    const localHits = PINNED_REFERENCE_HITS.filter((h) => {
      const text = `${h.identifier} ${h.title} ${h.snippet ?? ''}`.toLowerCase();
      return tokens.some((t) => text.includes(t));
    }).map((h) => ({ ...h, retrievedAtUtc: nowUtc }));
    return {
      query,
      scope,
      origin: 'offline-fallback',
      retrievedAtUtc: nowUtc,
      hits: localHits,
      warnings,
    };
  }

  return {
    query,
    scope,
    origin: 'live-network',
    retrievedAtUtc: nowUtc,
    hits,
    warnings,
  };
}
