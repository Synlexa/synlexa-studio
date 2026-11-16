/**
 * Synlexa Studio public database connector (Research-Use-Only).
 *
 * Pure, dependency-free helpers for querying RCSB PDB, AlphaFold DB, UniProtKB
 * and PubChem from the browser, with deterministic fallback to the pinned local
 * fixture cache (`/fixtures/`, described by `fixtures-manifest.json`).
 *
 * Provenance rules:
 *  - Every record carries its source URL, license string, origin
 *    (`live-network` vs `pinned-local-cache`) and a UTC retrieval timestamp.
 *  - Fields a source did not provide remain `null`; nothing is guessed or fabricated.
 *  - SHA-256 digests are computed via Web Crypto over the exact downloaded bytes.
 */

import { sha256HexUniversal } from './sha256';

export type DbSource = 'rcsb' | 'alphafold' | 'uniprot' | 'pubchem' | 'chembl' | 'opentargets';
export type RecordOrigin = 'live-network' | 'pinned-local-cache';

export const DB_SOURCE_LABELS: Record<DbSource, string> = {
  rcsb: 'RCSB PDB',
  alphafold: 'AlphaFold DB',
  uniprot: 'UniProtKB',
  pubchem: 'PubChem',
  chembl: 'ChEMBL',
  opentargets: 'Open Targets',
};

export const DB_LICENSES: Record<DbSource, string> = {
  rcsb: 'CC0-1.0',
  alphafold: 'CC-BY-4.0',
  uniprot: 'CC-BY-4.0',
  pubchem: 'Public domain (NCBI/PubChem data policy)',
  chembl: 'CC-BY-SA-3.0',
  opentargets: 'Apache-2.0 (Open Targets Platform)',
};

/** Hard size cap for any single downloaded structure or PAE artifact (50 MB). */
export const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;
export const DEFAULT_FIXTURES_BASE_URL = '/fixtures/';
const MAX_QUERY_LENGTH = 200;
const RESULT_ROWS = 10;

export interface ConnectorOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  offline?: boolean;
  now?: () => Date;
  /** Base URL of the pinned fixture cache. Default `/fixtures/`. */
  fixturesBaseUrl?: string;
}

export interface DbRecord {
  source: DbSource;
  id: string;
  title: string;
  subtitle?: string;
  organism?: string | null;
  length?: number | null;
  formula?: string | null;
  smiles?: string | null;
  molecularWeight?: number | null;
  downloadUrl?: string | null;
  sourceUrl: string;
  license: string;
  origin: RecordOrigin;
  retrievedAtUtc: string;
  uniprotAccession?: string | null;
  dataRevision?: string | null;
  /** Pinned-cache only: fixture file name relative to `fixturesBaseUrl`. */
  pinnedFileName?: string | null;
  /** Pinned-cache only: optional PAE fixture file name relative to `fixturesBaseUrl`. */
  pinnedPaeFileName?: string | null;
  /** Pinned-cache only: expected manifest SHA-256 hex digest. */
  expectedSha256?: string | null;
  raw?: unknown;
}

export interface DbSearchResult {
  records: DbRecord[];
  origin: RecordOrigin;
  warning?: string;
}

export interface ImportedStructure {
  label: string;
  content: string;
  sha256: string;
  sourceUrl: string;
  downloadUrl: string;
  license: string;
  retrievedAtUtc: string;
  dataRevision: string | null;
  origin: RecordOrigin;
  sourceTypeHint: 'experimental' | 'prediction';
  paeJson: string | null;
  paeSha256: string | null;
  uniprotAccession?: string;
  byteLength: number;
  warnings: string[];
}

export interface ImportedCompound {
  name: string;
  smiles: string;
  cid: number | null;
  formula: string | null;
  molecularWeight: number | null;
  sourceUrl: string;
  license: string;
  retrievedAtUtc: string;
  origin: RecordOrigin;
}

export class DatabaseHttpError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(status: number, url: string) {
    super(`HTTP ${status} from ${url}`);
    this.name = 'DatabaseHttpError';
    this.status = status;
    this.url = url;
  }
}

/* ------------------------------------------------------------------------- */
/* Identifier validation                                                     */
/* ------------------------------------------------------------------------- */

const PDB_ID_RE = /^[A-Za-z0-9]{4}$/;
/** Official UniProtKB accession pattern (6- or 10-character formats). */
const UNIPROT_ACCESSION_RE =
  /^(?:[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})$/;

export function isPdbId(value: string): boolean {
  return PDB_ID_RE.test(value.trim());
}

export function isUniProtAccession(value: string): boolean {
  return UNIPROT_ACCESSION_RE.test(value.trim().toUpperCase());
}

export function normalizePdbId(value: string): string {
  const v = value.trim();
  if (!PDB_ID_RE.test(v)) {
    throw new Error(`Invalid PDB ID "${value}": expected 4 alphanumeric characters (e.g. 3HS4).`);
  }
  return v.toUpperCase();
}

export function normalizeUniProtAccession(value: string): string {
  const v = value.trim().toUpperCase();
  if (!UNIPROT_ACCESSION_RE.test(v)) {
    throw new Error(`Invalid UniProtKB accession "${value}" (e.g. P00918).`);
  }
  return v;
}

/**
 * Extracts a UniProtKB accession from `P00918`, `AF-P00918`, `AF-P00918-F1`,
 * or `AF-P00918-F1-model_v6`. Returns `null` if the string does not match.
 */
export function extractUniProtAccession(value: string): string | null {
  const v = value.trim().toUpperCase();
  const m = /^(?:AF-)?([A-Z0-9]{6,10})(?:-F\d+(?:-MODEL_V\d+)?)?$/.exec(v);
  if (!m) return null;
  return UNIPROT_ACCESSION_RE.test(m[1]) ? m[1] : null;
}

function normalizeQuery(query: string): string {
  const q = (query ?? '').trim();
  if (!q) throw new Error('Search query must not be empty.');
  if (q.length > MAX_QUERY_LENGTH) {
    throw new Error(`Search query exceeds ${MAX_QUERY_LENGTH} characters.`);
  }
  return q;
}

/* ------------------------------------------------------------------------- */
/* URL builders                                                              */
/* ------------------------------------------------------------------------- */

export const RCSB_SEARCH_URL = 'https://search.rcsb.org/rcsbsearch/v2/query';
export const UNIPROT_FIELDS = 'accession,id,protein_name,organism_name,length,gene_names';
export const PUBCHEM_PROPERTIES =
  'Title,MolecularFormula,MolecularWeight,CanonicalSMILES,IsomericSMILES,TPSA,XLogP,HBondDonorCount,HBondAcceptorCount,RotatableBondCount';

export function rcsbSearchUrl(): string {
  return RCSB_SEARCH_URL;
}

export function rcsbSearchBody(query: string): string {
  const value = normalizeQuery(query);
  return JSON.stringify({
    query: {
      type: 'terminal',
      service: 'full_text',
      parameters: { value },
    },
    return_type: 'entry',
    request_options: {
      paginate: { start: 0, rows: RESULT_ROWS },
    },
  });
}

export function rcsbEntryUrl(id: string): string {
  return `https://data.rcsb.org/rest/v1/core/entry/${normalizePdbId(id)}`;
}

export function rcsbCifUrl(id: string): string {
  return `https://files.rcsb.org/download/${normalizePdbId(id)}.cif`;
}

export function rcsbEntryPageUrl(id: string): string {
  return `https://www.rcsb.org/structure/${normalizePdbId(id)}`;
}

export function alphafoldPredictionUrl(accession: string): string {
  return `https://alphafold.ebi.ac.uk/api/prediction/${normalizeUniProtAccession(accession)}`;
}

export function alphafoldEntryPageUrl(accession: string): string {
  return `https://alphafold.ebi.ac.uk/entry/${normalizeUniProtAccession(accession)}`;
}

export function uniprotSearchUrl(query: string): string {
  const q = normalizeQuery(query);
  return `https://rest.uniprot.org/uniprotkb/search?query=${encodeURIComponent(q)}&fields=${UNIPROT_FIELDS}&format=json&size=${RESULT_ROWS}`;
}

export function uniprotEntryPageUrl(accession: string): string {
  return `https://www.uniprot.org/uniprotkb/${normalizeUniProtAccession(accession)}/entry`;
}

export function pubchemPropertyUrl(name: string): string {
  const q = normalizeQuery(name);
  return `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(q)}/property/${PUBCHEM_PROPERTIES}/JSON`;
}

export function pubchemCompoundPageUrl(cid: number): string {
  if (!Number.isInteger(cid) || cid <= 0) {
    throw new Error(`Invalid PubChem CID "${cid}".`);
  }
  return `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`;
}

/* ------------------------------------------------------------------------- */
/* Pinned offline catalog (from public/fixtures/fixtures-manifest.json)      */
/* ------------------------------------------------------------------------- */

export interface OfflineStructureEntry {
  source: 'rcsb' | 'alphafold';
  id: string;
  uniprotAccession: string;
  fileName: string;
  paeFileName: string | null;
  title: string;
  sourceUrl: string;
  dataRevision: string;
  retrievedAtUtc: string;
  license: string;
  sha256: string;
}

export interface OfflineUniProtEntry {
  id: string;
  /** Title derived directly from manifest entries for this accession (no fabricated metadata). */
  title: string;
  relatedPdbId: string;
  relatedAfId: string;
  retrievedAtUtc: string;
}

export interface OfflineCompoundEntry {
  cid: number;
  name: string;
}

/**
 * Curated offline catalog matching the exact mmCIF & PubChem entries in
 * `apps/web/public/fixtures/fixtures-manifest.json`.
 */
export const OFFLINE_CATALOG: {
  manifestGeneratedAtUtc: string;
  structures: OfflineStructureEntry[];
  uniprot: OfflineUniProtEntry[];
  pubchemPanel: {
    fileName: string;
    sourceUrl: string;
    license: string;
    retrievedAtUtc: string;
    dataRevision: string;
    sha256: string;
    compounds: OfflineCompoundEntry[];
  };
} = {
  manifestGeneratedAtUtc: '2026-11-15T12:19:00Z',
  structures: [
    {
      source: 'rcsb',
      id: '3HS4',
      uniprotAccession: 'P00918',
      fileName: '3HS4.cif',
      paeFileName: null,
      title: 'Crystal structure of human carbonic anhydrase II (1.10 A)',
      sourceUrl: 'https://files.rcsb.org/download/3HS4.cif',
      dataRevision: 'PDB 3HS4 (2025-09-25)',
      retrievedAtUtc: '2026-11-15T09:05:30Z',
      license: 'CC0-1.0',
      sha256: '84e006ac301979de150f351fdc235a97ba73bffec8514dfe6c96447517da91d6',
    },
    {
      source: 'rcsb',
      id: '1UBQ',
      uniprotAccession: 'P0CG48',
      fileName: '1UBQ.cif',
      paeFileName: null,
      title: 'Structure of ubiquitin refined at 1.8 Angstroms resolution',
      sourceUrl: 'https://files.rcsb.org/download/1UBQ.cif',
      dataRevision: 'PDB 1UBQ (2024-02-14)',
      retrievedAtUtc: '2026-11-15T12:18:14Z',
      license: 'CC0-1.0',
      sha256: '056f98710cb2b36f633c45e41902a02eb446e82871da21ff2dd44f74a56ca0f6',
    },
    {
      source: 'rcsb',
      id: '1A3N',
      uniprotAccession: 'P68871',
      fileName: '1A3N.cif',
      paeFileName: null,
      title: 'Deoxy human hemoglobin (chains A, B, C, D; beta subunit chain B)',
      sourceUrl: 'https://files.rcsb.org/download/1A3N.cif',
      dataRevision: 'PDB 1A3N (2026-08-12)',
      retrievedAtUtc: '2026-11-15T12:18:15Z',
      license: 'CC0-1.0',
      sha256: '7cd2eb16d3469a3ef32864f33ee2ca09258b1b1fff2c1c83214b9af3087f93dd',
    },
    {
      source: 'rcsb',
      id: '1LZ1',
      uniprotAccession: 'P61626',
      fileName: '1LZ1.cif',
      paeFileName: null,
      title: 'Refinement of human lysozyme at 1.5 Angstroms resolution',
      sourceUrl: 'https://files.rcsb.org/download/1LZ1.cif',
      dataRevision: 'PDB 1LZ1 (2024-10-30)',
      retrievedAtUtc: '2026-11-15T12:18:15Z',
      license: 'CC0-1.0',
      sha256: 'b7c3da2c7a54184fa768a2f51b56c4d7f4516854a4e77dbaa2528803a673cea0',
    },
    {
      source: 'alphafold',
      id: 'AF-P00918-F1',
      uniprotAccession: 'P00918',
      fileName: 'AF-P00918-F1-model_v6.cif',
      paeFileName: 'AF-P00918-F1-predicted_aligned_error_v6.json',
      title: 'AlphaFold DB prediction for Human Carbonic Anhydrase 2 (UniProt P00918, v6)',
      sourceUrl: 'https://alphafold.ebi.ac.uk/files/AF-P00918-F1-model_v6.cif',
      dataRevision: 'AlphaFold DB v6 (modelCreatedDate 2025-08-01)',
      retrievedAtUtc: '2026-11-15T09:06:04Z',
      license: 'CC-BY-4.0',
      sha256: '173c4f1fa81ffb1a288c881040217d1473ed2d08cd792671252ee116cac10c7d',
    },
    {
      source: 'alphafold',
      id: 'AF-P0CG48-F1',
      uniprotAccession: 'P0CG48',
      fileName: 'AF-P0CG48-F1-model_v6.cif',
      paeFileName: null,
      title: 'AlphaFold DB prediction for Human Polyubiquitin-C (UniProt P0CG48, v6)',
      sourceUrl: 'https://alphafold.ebi.ac.uk/files/AF-P0CG48-F1-model_v6.cif',
      dataRevision: 'AlphaFold DB v6 (modelCreatedDate 2025-08-01)',
      retrievedAtUtc: '2026-11-15T12:18:14Z',
      license: 'CC-BY-4.0',
      sha256: '02b8ea3d522fabee58abed221fad1a2101e9ad633ddecbe30bc96d158fc2c408',
    },
    {
      source: 'alphafold',
      id: 'AF-P68871-F1',
      uniprotAccession: 'P68871',
      fileName: 'AF-P68871-F1-model_v6.cif',
      paeFileName: null,
      title: 'AlphaFold DB prediction for Human Hemoglobin Subunit Beta (UniProt P68871, v6)',
      sourceUrl: 'https://alphafold.ebi.ac.uk/files/AF-P68871-F1-model_v6.cif',
      dataRevision: 'AlphaFold DB v6 (modelCreatedDate 2025-08-01)',
      retrievedAtUtc: '2026-11-15T12:18:15Z',
      license: 'CC-BY-4.0',
      sha256: '0c1603478734a034d38f807a57badc41c2e2086daaa98334d218a9c70ace1f4e',
    },
    {
      source: 'alphafold',
      id: 'AF-P61626-F1',
      uniprotAccession: 'P61626',
      fileName: 'AF-P61626-F1-model_v6.cif',
      paeFileName: null,
      title: 'AlphaFold DB prediction for Human Lysozyme C (UniProt P61626, v6)',
      sourceUrl: 'https://alphafold.ebi.ac.uk/files/AF-P61626-F1-model_v6.cif',
      dataRevision: 'AlphaFold DB v6 (modelCreatedDate 2025-08-01)',
      retrievedAtUtc: '2026-11-15T12:18:15Z',
      license: 'CC-BY-4.0',
      sha256: '8444ea54dc496d7a8107257040ca7d12476f0508a943b17890b846ecd1e2b99e',
    },
  ],
  uniprot: [
    {
      id: 'P00918',
      title: 'Human Carbonic Anhydrase 2 (UniProt P00918)',
      relatedPdbId: '3HS4',
      relatedAfId: 'AF-P00918-F1',
      retrievedAtUtc: '2026-11-15T09:06:04Z',
    },
    {
      id: 'P0CG48',
      title: 'Human Polyubiquitin-C (UniProt P0CG48)',
      relatedPdbId: '1UBQ',
      relatedAfId: 'AF-P0CG48-F1',
      retrievedAtUtc: '2026-11-15T12:18:14Z',
    },
    {
      id: 'P68871',
      title: 'Human Hemoglobin Subunit Beta (UniProt P68871)',
      relatedPdbId: '1A3N',
      relatedAfId: 'AF-P68871-F1',
      retrievedAtUtc: '2026-11-15T12:18:15Z',
    },
    {
      id: 'P61626',
      title: 'Human Lysozyme C (UniProt P61626)',
      relatedPdbId: '1LZ1',
      relatedAfId: 'AF-P61626-F1',
      retrievedAtUtc: '2026-11-15T12:18:15Z',
    },
  ],
  pubchemPanel: {
    fileName: 'pubchem-panel.json',
    sourceUrl:
      'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/1986,3154,5291,2244,2519,4091/property/Title,MolecularFormula,MolecularWeight,CanonicalSMILES,IsomericSMILES,TPSA,XLogP,HBondDonorCount,HBondAcceptorCount,RotatableBondCount/JSON',
    license: 'Public domain (NCBI/PubChem data policy)',
    retrievedAtUtc: '2026-11-15T12:18:16Z',
    dataRevision: 'PubChem PUG REST snapshot (2026-11-15)',
    sha256: '149fde62389640deced63caec8a749cee1477d160f99c27630fddece00350d8b',
    compounds: [
      { cid: 1986, name: 'Acetazolamide' },
      {
        cid: 3154,
        name: '4H-Thieno(2,3-b)thiopyran-2-sulfonamide, 4-(ethylamino)-5,6-dihydro-6-methyl-, 7,7-dioxide',
      },
      { cid: 5291, name: 'Imatinib' },
      { cid: 2244, name: 'Aspirin' },
      { cid: 2519, name: 'Caffeine' },
      { cid: 4091, name: 'Metformin' },
    ],
  },
};

/* ------------------------------------------------------------------------- */
/* Shared low-level helpers                                                  */
/* ------------------------------------------------------------------------- */

function getFetch(opts?: ConnectorOptions): typeof fetch {
  const fn = opts?.fetchImpl ?? globalThis.fetch;
  if (typeof fn !== 'function') {
    throw new Error('No fetch implementation available.');
  }
  return fn;
}

function getNowIso(opts?: ConnectorOptions): string {
  const d = opts?.now ? opts.now() : new Date();
  return d.toISOString();
}

function isOfflineEnvironment(opts?: ConnectorOptions): boolean {
  if (opts?.offline) return true;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  return false;
}

function normalizeFixturesBaseUrl(base?: string): string {
  const raw = (base ?? DEFAULT_FIXTURES_BASE_URL).trim();
  if (!raw) return DEFAULT_FIXTURES_BASE_URL;
  return raw.endsWith('/') ? raw : `${raw}/`;
}

function isAbortError(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return err instanceof Error && err.name === 'AbortError';
}

function isFallbackEligibleError(err: unknown): boolean {
  if (err instanceof DatabaseHttpError) {
    return err.status === 429 || (err.status >= 500 && err.status <= 599);
  }
  // Network/CORS/DNS errors thrown by fetch (TypeError, etc.)
  return true;
}

/**
 * Computes lowercase SHA-256 hex digest. Uses Web Crypto when available and a
 * pure-TS fallback on insecure origins / embedded webviews.
 */
export async function sha256Hex(input: string | Uint8Array | ArrayBuffer): Promise<string> {
  return sha256HexUniversal(input);
}

async function readResponseWithSizeCap(
  res: Response,
  url: string,
  maxBytes = MAX_DOWNLOAD_BYTES,
): Promise<{ bytes: Uint8Array; text: string }> {
  const contentLength = res.headers?.get?.('content-length');
  if (contentLength !== null && contentLength !== undefined && contentLength !== '') {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error(
        `Artifact from ${url} exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB size cap (${declared} bytes declared).`,
      );
    }
  }

  let bytes: Uint8Array;
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new Error(
            `Artifact from ${url} exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB size cap.`,
          );
        }
        chunks.push(value);
      }
    }
    bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
  } else {
    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes) {
      throw new Error(
        `Artifact from ${url} exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB size cap (${buf.byteLength} bytes).`,
      );
    }
    bytes = new Uint8Array(buf);
  }

  const text = new TextDecoder().decode(bytes);
  return { bytes, text };
}

/* ------------------------------------------------------------------------- */
/* PubChem & AlphaFold payload parsers                                       */
/* ------------------------------------------------------------------------- */

/**
 * Extracts SMILES preferring `IsomericSMILES`, then modern PubChem `SMILES`,
 * then `CanonicalSMILES`, then `ConnectivitySMILES`.
 */
export function extractPubChemSmiles(prop: Record<string, unknown> | null | undefined): string | null {
  if (!prop || typeof prop !== 'object') return null;
  const candidates = [
    prop.IsomericSMILES,
    prop.SMILES,
    prop.CanonicalSMILES,
    prop.ConnectivitySMILES,
  ];
  for (const val of candidates) {
    if (typeof val === 'string' && val.trim().length > 0) {
      return val.trim();
    }
  }
  return null;
}

function parseFiniteNumber(val: unknown): number | null {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string' && val.trim() !== '') {
    const n = Number(val);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function formatAlphaFoldRevision(entry: Record<string, unknown>): string | null {
  const ver = entry.latestVersion;
  const created = typeof entry.modelCreatedDate === 'string' ? entry.modelCreatedDate.slice(0, 10) : null;
  if (ver !== undefined && ver !== null && created) {
    return `AlphaFold DB v${ver} (modelCreatedDate ${created})`;
  }
  if (ver !== undefined && ver !== null) {
    return `AlphaFold DB v${ver}`;
  }
  if (created) {
    return `AlphaFold DB (modelCreatedDate ${created})`;
  }
  return null;
}

function mapPubChemPropertiesToRecords(
  props: Array<Record<string, unknown>>,
  origin: RecordOrigin,
  retrievedAtUtc: string,
  fallbackSourceUrl?: string,
): DbRecord[] {
  return props.map((prop, idx) => {
    const cid = parseFiniteNumber(prop.CID);
    const validCid = cid !== null && Number.isInteger(cid) && cid > 0 ? cid : null;
    const title =
      typeof prop.Title === 'string' && prop.Title.trim()
        ? prop.Title.trim()
        : validCid !== null
          ? `PubChem CID ${validCid}`
          : `Compound #${idx + 1}`;
    const mw = parseFiniteNumber(prop.MolecularWeight);
    const formula = typeof prop.MolecularFormula === 'string' ? prop.MolecularFormula : null;
    const smiles = extractPubChemSmiles(prop);
    const tpsa = parseFiniteNumber(prop.TPSA);
    const xlogp = parseFiniteNumber(prop.XLogP);
    const subParts: string[] = [];
    if (validCid !== null) subParts.push(`CID ${validCid}`);
    if (tpsa !== null) subParts.push(`TPSA ${tpsa} Å²`);
    if (xlogp !== null) subParts.push(`XLogP ${xlogp}`);

    return {
      source: 'pubchem',
      id: validCid !== null ? String(validCid) : title,
      title,
      subtitle: subParts.length > 0 ? subParts.join(' · ') : undefined,
      organism: null,
      length: null,
      formula,
      smiles,
      molecularWeight: mw,
      downloadUrl: null,
      sourceUrl: validCid !== null ? pubchemCompoundPageUrl(validCid) : (fallbackSourceUrl ?? 'https://pubchem.ncbi.nlm.nih.gov/'),
      license: DB_LICENSES.pubchem,
      origin,
      retrievedAtUtc,
      raw: prop,
    };
  });
}

function mapAlphaFoldEntryToRecord(
  entry: Record<string, unknown>,
  fallbackAcc: string,
  origin: RecordOrigin,
  retrievedAtUtc: string,
): DbRecord {
  const accRaw = typeof entry.uniprotAccession === 'string' ? entry.uniprotAccession : fallbackAcc;
  const acc = extractUniProtAccession(accRaw) ?? fallbackAcc;
  const entryId =
    typeof entry.entryId === 'string' && entry.entryId.trim() ? entry.entryId.trim() : `AF-${acc}-F1`;
  const title =
    typeof entry.uniprotDescription === 'string' && entry.uniprotDescription.trim()
      ? entry.uniprotDescription.trim()
      : typeof entry.proteinName === 'string' && entry.proteinName.trim()
        ? entry.proteinName.trim()
        : `AlphaFold DB model ${entryId}`;
  const rev = formatAlphaFoldRevision(entry);
  const gene = typeof entry.gene === 'string' && entry.gene.trim() ? entry.gene.trim() : null;
  const uid = typeof entry.uniprotId === 'string' && entry.uniprotId.trim() ? entry.uniprotId.trim() : null;
  const subParts = [uid, gene ? `Gene: ${gene}` : null, rev].filter(Boolean);
  const length =
    parseFiniteNumber(entry.uniprotEnd) ??
    parseFiniteNumber(entry.sequenceEnd) ??
    null;

  return {
    source: 'alphafold',
    id: entryId,
    title,
    subtitle: subParts.length > 0 ? subParts.join(' · ') : undefined,
    organism: typeof entry.organismScientificName === 'string' ? entry.organismScientificName : null,
    length,
    downloadUrl: typeof entry.cifUrl === 'string' ? entry.cifUrl : null,
    sourceUrl: alphafoldEntryPageUrl(acc),
    license: DB_LICENSES.alphafold,
    origin,
    retrievedAtUtc,
    uniprotAccession: acc,
    dataRevision: rev,
    raw: entry,
  };
}

/* ------------------------------------------------------------------------- */
/* Offline catalog builder & query filtering                                 */
/* ------------------------------------------------------------------------- */

function offlineStructureToDbRecord(entry: OfflineStructureEntry): DbRecord {
  return {
    source: entry.source,
    id: entry.id,
    title: entry.title,
    subtitle: `${entry.dataRevision} · UniProt ${entry.uniprotAccession}`,
    organism: null,
    length: null,
    downloadUrl: entry.sourceUrl,
    sourceUrl: entry.sourceUrl,
    license: entry.license,
    origin: 'pinned-local-cache',
    retrievedAtUtc: entry.retrievedAtUtc,
    uniprotAccession: entry.uniprotAccession,
    dataRevision: entry.dataRevision,
    pinnedFileName: entry.fileName,
    pinnedPaeFileName: entry.paeFileName,
    expectedSha256: entry.sha256,
  };
}

function offlineUniProtToDbRecord(entry: OfflineUniProtEntry): DbRecord {
  return {
    source: 'uniprot',
    id: entry.id,
    title: entry.title,
    subtitle: `Pinned manifest link · PDB ${entry.relatedPdbId} · ${entry.relatedAfId}`,
    organism: null,
    length: null,
    downloadUrl: null,
    sourceUrl: uniprotEntryPageUrl(entry.id),
    license: DB_LICENSES.uniprot,
    origin: 'pinned-local-cache',
    retrievedAtUtc: entry.retrievedAtUtc,
    uniprotAccession: entry.id,
  };
}

function filterRecordsByQuery(records: DbRecord[], query: string): DbRecord[] {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return records;

  const scored: Array<{ record: DbRecord; score: number }> = [];
  for (const record of records) {
    const haystack = [
      record.id,
      record.title,
      record.subtitle ?? '',
      record.uniprotAccession ?? '',
      record.formula ?? '',
      record.pinnedFileName ?? '',
    ]
      .join(' ')
      .toLowerCase();

    let hits = 0;
    for (const token of tokens) {
      if (haystack.includes(token)) hits += 1;
    }
    if (hits > 0) {
      const exactIdBoost = record.id.toLowerCase() === query.trim().toLowerCase() ? 10 : 0;
      scored.push({ record, score: hits + exactIdBoost });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.record);
}

async function searchOfflineCatalog(
  source: DbSource,
  query: string,
  reason: string,
  opts?: ConnectorOptions,
): Promise<DbSearchResult> {
  let all: DbRecord[] = [];
  let extraNote = '';

  if (source === 'rcsb' || source === 'alphafold') {
    all = OFFLINE_CATALOG.structures
      .filter((s) => s.source === source)
      .map(offlineStructureToDbRecord);
  } else if (source === 'uniprot') {
    all = OFFLINE_CATALOG.uniprot.map(offlineUniProtToDbRecord);
  } else if (source === 'opentargets') {
    all = [];
    extraNote = ' Open Targets requires live network access (no offline target-disease dataset bundled).';
  } else {
    // PubChem / ChEMBL offline fallback: load pinned /fixtures/pubchem-panel.json if pubchem.
    const base = normalizeFixturesBaseUrl(opts?.fixturesBaseUrl);
    const panelUrl = `${base}${OFFLINE_CATALOG.pubchemPanel.fileName}`;
    let loadedPanel = false;
    try {
      const fetchFn = opts?.fetchImpl ?? globalThis.fetch;
      if (typeof fetchFn === 'function') {
        const res = await fetchFn(panelUrl, { signal: opts?.signal });
        if (res.ok) {
          const json = (await res.json()) as {
            PropertyTable?: { Properties?: Array<Record<string, unknown>> };
          };
          const props = json?.PropertyTable?.Properties;
          if (Array.isArray(props) && props.length > 0) {
            all = mapPubChemPropertiesToRecords(
              props,
              'pinned-local-cache',
              OFFLINE_CATALOG.pubchemPanel.retrievedAtUtc,
              OFFLINE_CATALOG.pubchemPanel.sourceUrl,
            );
            loadedPanel = true;
          }
        }
      }
    } catch {
      // Fall through to CID + name list only (no fabricated properties).
    }

    if (!loadedPanel) {
      all = OFFLINE_CATALOG.pubchemPanel.compounds.map((c) => ({
        source: 'pubchem',
        id: String(c.cid),
        title: c.name,
        subtitle: `CID ${c.cid} · Pinned name/CID list only (properties unavailable offline)`,
        organism: null,
        length: null,
        formula: null,
        smiles: null,
        molecularWeight: null,
        downloadUrl: null,
        sourceUrl: pubchemCompoundPageUrl(c.cid),
        license: DB_LICENSES.pubchem,
        origin: 'pinned-local-cache',
        retrievedAtUtc: OFFLINE_CATALOG.pubchemPanel.retrievedAtUtc,
      }));
      extraNote = ' PubChem panel JSON was unreachable; displaying CID and compound name only.';
    }
  }

  const trimmed = query.trim();
  const matched = trimmed ? filterRecordsByQuery(all, trimmed) : all;
  const records = matched.length > 0 ? matched : all;
  const matchNote =
    trimmed && matched.length === 0
      ? ` No pinned fixture matched "${trimmed}"; showing all ${all.length} curated local entries.`
      : '';

  return {
    records,
    origin: 'pinned-local-cache',
    warning: `${reason}${extraNote}${matchNote}`.trim(),
  };
}

/**
 * Convenience helper for UI components to list the curated pinned local fixtures
 * for a source without hitting external APIs.
 */
export async function listOfflineCatalog(
  source: DbSource,
  opts?: ConnectorOptions,
): Promise<DbSearchResult> {
  return searchOfflineCatalog(source, '', 'Showing pinned local fixture cache.', opts);
}

/* ------------------------------------------------------------------------- */
/* Live search implementations                                               */
/* ------------------------------------------------------------------------- */

async function searchRcsbLive(query: string, opts?: ConnectorOptions): Promise<DbRecord[]> {
  const fetchFn = getFetch(opts);
  const retrievedAtUtc = getNowIso(opts);
  const url = rcsbSearchUrl();

  const searchRes = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: rcsbSearchBody(query),
    signal: opts?.signal,
  });

  if (searchRes.status === 204) return [];
  if (!searchRes.ok) throw new DatabaseHttpError(searchRes.status, url);

  const searchJson = (await searchRes.json()) as {
    result_set?: Array<{ identifier?: string; score?: number }>;
  };
  const hits = Array.isArray(searchJson?.result_set) ? searchJson.result_set : [];
  const ids: string[] = [];
  for (const hit of hits) {
    if (typeof hit?.identifier === 'string' && isPdbId(hit.identifier)) {
      const normalized = normalizePdbId(hit.identifier);
      if (!ids.includes(normalized)) ids.push(normalized);
      if (ids.length >= RESULT_ROWS) break;
    }
  }
  if (ids.length === 0) return [];

  const records = await Promise.all(
    ids.map(async (id): Promise<DbRecord> => {
      const entryUrl = rcsbEntryUrl(id);
      try {
        const entryRes = await fetchFn(entryUrl, { signal: opts?.signal });
        if (!entryRes.ok) {
          if (entryRes.status === 429 || entryRes.status >= 500) {
            throw new DatabaseHttpError(entryRes.status, entryUrl);
          }
          return {
            source: 'rcsb',
            id,
            title: `PDB Entry ${id}`,
            organism: null,
            length: null,
            downloadUrl: rcsbCifUrl(id),
            sourceUrl: rcsbEntryPageUrl(id),
            license: DB_LICENSES.rcsb,
            origin: 'live-network',
            retrievedAtUtc,
            dataRevision: null,
          };
        }
        const entry = (await entryRes.json()) as {
          struct?: { title?: string };
          exptl?: Array<{ method?: string }>;
          rcsb_entry_info?: { resolution_combined?: number[]; experimental_method?: string };
          rcsb_accession_info?: { revision_date?: string };
        };
        const title = entry?.struct?.title?.trim() || `PDB Entry ${id}`;
        const method = entry?.exptl?.[0]?.method ?? entry?.rcsb_entry_info?.experimental_method;
        const resAng = entry?.rcsb_entry_info?.resolution_combined?.[0];
        const subParts: string[] = [];
        if (typeof method === 'string' && method) subParts.push(method);
        if (typeof resAng === 'number' && Number.isFinite(resAng)) {
          subParts.push(`${resAng.toFixed(2)} Å`);
        }
        const revDate = entry?.rcsb_accession_info?.revision_date;
        const dataRevision =
          typeof revDate === 'string' && revDate.length >= 10
            ? `PDB ${id} (${revDate.slice(0, 10)})`
            : null;

        return {
          source: 'rcsb',
          id,
          title,
          subtitle: subParts.length > 0 ? subParts.join(' · ') : undefined,
          organism: null,
          length: null,
          downloadUrl: rcsbCifUrl(id),
          sourceUrl: rcsbEntryPageUrl(id),
          license: DB_LICENSES.rcsb,
          origin: 'live-network',
          retrievedAtUtc,
          dataRevision,
          raw: entry,
        };
      } catch (err) {
        if (err instanceof DatabaseHttpError && (err.status === 429 || err.status >= 500)) {
          throw err;
        }
        if (isAbortError(err, opts?.signal)) throw err;
        return {
          source: 'rcsb',
          id,
          title: `PDB Entry ${id}`,
          organism: null,
          length: null,
          downloadUrl: rcsbCifUrl(id),
          sourceUrl: rcsbEntryPageUrl(id),
          license: DB_LICENSES.rcsb,
          origin: 'live-network',
          retrievedAtUtc,
          dataRevision: null,
        };
      }
    }),
  );

  return records;
}

async function fetchAlphaFoldEntriesByAccession(
  acc: string,
  opts?: ConnectorOptions,
): Promise<Array<Record<string, unknown>>> {
  const fetchFn = getFetch(opts);
  const url = alphafoldPredictionUrl(acc);
  const res = await fetchFn(url, { signal: opts?.signal });
  if (res.status === 404) return [];
  if (!res.ok) throw new DatabaseHttpError(res.status, url);
  const data = (await res.json()) as unknown;
  if (Array.isArray(data)) {
    return data.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
  }
  if (data && typeof data === 'object') {
    return [data as Record<string, unknown>];
  }
  return [];
}

async function searchUniProtLive(query: string, opts?: ConnectorOptions): Promise<DbRecord[]> {
  const fetchFn = getFetch(opts);
  const retrievedAtUtc = getNowIso(opts);
  const url = uniprotSearchUrl(query);

  const res = await fetchFn(url, { signal: opts?.signal });
  if (!res.ok) throw new DatabaseHttpError(res.status, url);

  const data = (await res.json()) as {
    results?: Array<Record<string, unknown>>;
  };
  const results = Array.isArray(data?.results) ? data.results : [];
  const records: DbRecord[] = [];

  for (const item of results) {
    const accRaw = typeof item.primaryAccession === 'string' ? item.primaryAccession : '';
    const acc = extractUniProtAccession(accRaw);
    if (!acc) continue;

    const uniProtkbId = typeof item.uniProtkbId === 'string' ? item.uniProtkbId : null;
    const proteinDesc = item.proteinDescription as
      | {
          recommendedName?: { fullName?: { value?: string } };
          submissionNames?: Array<{ fullName?: { value?: string } }>;
          alternativeNames?: Array<{ fullName?: { value?: string } }>;
        }
      | undefined;

    const title =
      proteinDesc?.recommendedName?.fullName?.value ??
      proteinDesc?.submissionNames?.[0]?.fullName?.value ??
      proteinDesc?.alternativeNames?.[0]?.fullName?.value ??
      (typeof item.proteinName === 'string' ? item.proteinName : null) ??
      uniProtkbId ??
      acc;

    const organismObj = item.organism as { scientificName?: string } | undefined;
    const organism =
      organismObj?.scientificName ??
      (typeof item.organismName === 'string' ? item.organismName : null) ??
      null;

    const seqObj = item.sequence as { length?: number } | undefined;
    const length = parseFiniteNumber(seqObj?.length ?? item.length);

    const genes = item.genes as Array<{ geneName?: { value?: string } }> | undefined;
    const geneName =
      genes?.[0]?.geneName?.value ??
      (typeof item.geneName === 'string' ? item.geneName : null) ??
      null;

    const subParts = [uniProtkbId, geneName ? `Gene: ${geneName}` : null].filter(Boolean);

    records.push({
      source: 'uniprot',
      id: acc,
      title,
      subtitle: subParts.length > 0 ? subParts.join(' · ') : undefined,
      organism,
      length,
      downloadUrl: null,
      sourceUrl: uniprotEntryPageUrl(acc),
      license: DB_LICENSES.uniprot,
      origin: 'live-network',
      retrievedAtUtc,
      uniprotAccession: acc,
      raw: item,
    });
  }

  return records;
}

async function searchAlphaFoldLive(query: string, opts?: ConnectorOptions): Promise<DbRecord[]> {
  const retrievedAtUtc = getNowIso(opts);
  const directAcc = extractUniProtAccession(query);
  if (directAcc) {
    const entries = await fetchAlphaFoldEntriesByAccession(directAcc, opts);
    return entries.map((e) => mapAlphaFoldEntryToRecord(e, directAcc, 'live-network', retrievedAtUtc));
  }

  // Free-text query: resolve candidate UniProt accessions, then query AlphaFold DB.
  const uniprotHits = await searchUniProtLive(query, opts);
  const topAccessions = uniprotHits.slice(0, 5).map((r) => r.id);
  const records: DbRecord[] = [];
  for (const acc of topAccessions) {
    try {
      const entries = await fetchAlphaFoldEntriesByAccession(acc, opts);
      for (const e of entries) {
        records.push(mapAlphaFoldEntryToRecord(e, acc, 'live-network', retrievedAtUtc));
      }
    } catch (err) {
      if (err instanceof DatabaseHttpError && (err.status === 429 || err.status >= 500)) {
        throw err;
      }
      if (isAbortError(err, opts?.signal)) throw err;
    }
  }
  return records;
}

async function searchPubChemLive(query: string, opts?: ConnectorOptions): Promise<DbRecord[]> {
  const fetchFn = getFetch(opts);
  const retrievedAtUtc = getNowIso(opts);
  const url = pubchemPropertyUrl(query);

  const res = await fetchFn(url, { signal: opts?.signal });
  if (res.status === 404) return [];
  if (!res.ok) throw new DatabaseHttpError(res.status, url);

  const data = (await res.json()) as {
    PropertyTable?: { Properties?: Array<Record<string, unknown>> };
  };
  const props = Array.isArray(data?.PropertyTable?.Properties)
    ? data.PropertyTable.Properties
    : [];
  return mapPubChemPropertiesToRecords(props, 'live-network', retrievedAtUtc, url);
}

async function searchChemblLive(query: string, opts?: ConnectorOptions): Promise<DbRecord[]> {
  const fetchFn = getFetch(opts);
  const retrievedAtUtc = getNowIso(opts);
  const url = `https://www.ebi.ac.uk/chembl/api/data/molecule/search.json?q=${encodeURIComponent(query)}&limit=${RESULT_ROWS}`;
  const res = await fetchFn(url, { signal: opts?.signal });
  if (res.status === 404) return [];
  if (!res.ok) throw new DatabaseHttpError(res.status, url);

  const data = (await res.json()) as { molecules?: Array<Record<string, unknown>> };
  const list = Array.isArray(data?.molecules) ? data.molecules : [];
  return list.map((m) => {
    const id = String(m.molecule_chembl_id ?? '');
    const prefName = typeof m.pref_name === 'string' && m.pref_name.trim() ? m.pref_name.trim() : id;
    const structs = (m.molecule_structures as Record<string, unknown> | undefined) ?? {};
    const props = (m.molecule_properties as Record<string, unknown> | undefined) ?? {};
    const smiles = typeof structs.canonical_smiles === 'string' ? structs.canonical_smiles : null;
    const formula = typeof props.full_molformula === 'string' ? props.full_molformula : null;
    const mw = parseFiniteNumber(props.full_mwt);
    const maxPhase = parseFiniteNumber(m.max_phase);
    return {
      source: 'chembl',
      id,
      title: prefName,
      subtitle: [id, maxPhase !== null ? `Max Phase ${maxPhase}` : null].filter(Boolean).join(' · '),
      organism: null,
      length: null,
      formula,
      smiles,
      molecularWeight: mw,
      downloadUrl: null,
      sourceUrl: `https://www.ebi.ac.uk/chembl/compound_report_card/${encodeURIComponent(id)}/`,
      license: DB_LICENSES.chembl,
      origin: 'live-network',
      retrievedAtUtc,
      raw: m,
    };
  });
}

async function searchOpenTargetsLive(query: string, opts?: ConnectorOptions): Promise<DbRecord[]> {
  const fetchFn = getFetch(opts);
  const retrievedAtUtc = getNowIso(opts);
  const url = 'https://api.platform.opentargets.org/api/v4/graphql';
  const gql = `query SearchTargets($q: String!) {
    search(queryString: $q, entityNames: ["target"], page: { index: 0, size: 8 }) {
      hits { id name description }
    }
  }`;
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: gql, variables: { q: query } }),
    signal: opts?.signal,
  });
  if (!res.ok) throw new DatabaseHttpError(res.status, url);
  const json = (await res.json()) as {
    data?: { search?: { hits?: Array<{ id: string; name: string; description?: string }> } };
  };
  const hits = json?.data?.search?.hits ?? [];
  return hits.map((h) => ({
    source: 'opentargets',
    id: h.id,
    title: h.name || h.id,
    subtitle: h.description || `Ensembl target ${h.id}`,
    organism: 'Homo sapiens',
    length: null,
    downloadUrl: null,
    sourceUrl: `https://platform.opentargets.org/target/${encodeURIComponent(h.id)}`,
    license: DB_LICENSES.opentargets,
    origin: 'live-network',
    retrievedAtUtc,
    raw: h,
  }));
}

/* ------------------------------------------------------------------------- */
/* Public search & import API                                                */
/* ------------------------------------------------------------------------- */

/**
 * Queries one of the supported public databases (`rcsb`, `alphafold`,
 * `uniprot`, `pubchem`, `chembl`, `opentargets`), automatically falling back
 * to the pinned local fixture cache on offline mode, network failures, or HTTP 429 / 5xx.
 */
export async function searchDatabase(
  source: DbSource,
  query: string,
  opts?: ConnectorOptions,
): Promise<DbSearchResult> {
  if (isOfflineEnvironment(opts)) {
    const reason = opts?.offline
      ? 'Offline mode enabled — searching pinned local fixture cache.'
      : 'Browser reports offline — searching pinned local fixture cache.';
    return searchOfflineCatalog(source, query, reason, opts);
  }

  const normalizedQuery = normalizeQuery(query);

  try {
    let records: DbRecord[];
    if (source === 'rcsb') {
      records = await searchRcsbLive(normalizedQuery, opts);
    } else if (source === 'alphafold') {
      records = await searchAlphaFoldLive(normalizedQuery, opts);
    } else if (source === 'uniprot') {
      records = await searchUniProtLive(normalizedQuery, opts);
    } else if (source === 'chembl') {
      records = await searchChemblLive(normalizedQuery, opts);
    } else if (source === 'opentargets') {
      records = await searchOpenTargetsLive(normalizedQuery, opts);
    } else {
      records = await searchPubChemLive(normalizedQuery, opts);
    }
    return { records, origin: 'live-network' };
  } catch (err) {
    if (isAbortError(err, opts?.signal)) {
      throw err;
    }
    if (!isFallbackEligibleError(err)) {
      throw err;
    }
    const detail = err instanceof Error ? err.message : 'Network error';
    return searchOfflineCatalog(
      source,
      normalizedQuery,
      `Live ${DB_SOURCE_LABELS[source]} request fell back to pinned local cache (${detail}).`,
      opts,
    );
  }
}

/**
 * Fetches an AlphaFold DB `DbRecord` for a UniProt accession (used by the UI
 * "Fetch AlphaFold model" action on UniProtKB rows), respecting offline fallback.
 */
export async function fetchAlphaFoldRecordForUniProt(
  accession: string,
  opts?: ConnectorOptions,
): Promise<DbSearchResult> {
  const acc = normalizeUniProtAccession(accession);
  return searchDatabase('alphafold', acc, opts);
}

function findPinnedStructureForRecord(record: DbRecord): OfflineStructureEntry | undefined {
  if (record.pinnedFileName) {
    return OFFLINE_CATALOG.structures.find((s) => s.fileName === record.pinnedFileName);
  }
  const upperId = record.id.trim().toUpperCase();
  const acc = record.uniprotAccession ?? extractUniProtAccession(record.id);
  return OFFLINE_CATALOG.structures.find(
    (s) =>
      s.id.toUpperCase() === upperId ||
      (record.source === 'alphafold' && acc && s.source === 'alphafold' && s.uniprotAccession === acc) ||
      (record.source === 'uniprot' && acc && s.source === 'alphafold' && s.uniprotAccession === acc),
  );
}

/**
 * Downloads and verifies a structure record (`rcsb` or `alphafold`, or
 * `uniprot` via its AlphaFold DB prediction) with 50 MB size cap and SHA-256
 * provenance digest.
 */
export async function importStructureRecord(
  record: DbRecord,
  opts?: ConnectorOptions,
): Promise<ImportedStructure> {
  if (record.source === 'pubchem' || record.source === 'chembl' || record.source === 'opentargets') {
    throw new Error(`Cannot import a ${record.source} record directly as a 3D structure.`);
  }

  const fetchFn = getFetch(opts);
  const warnings: string[] = [];

  // Pinned local cache import (from /fixtures/<fileName>)
  if (record.origin === 'pinned-local-cache' || isOfflineEnvironment(opts)) {
    const pinned = findPinnedStructureForRecord(record);
    const fileName = record.pinnedFileName ?? pinned?.fileName;
    if (!fileName) {
      throw new Error(`No pinned local fixture is available for "${record.id}" while offline.`);
    }

    const base = normalizeFixturesBaseUrl(opts?.fixturesBaseUrl);
    const fixtureUrl = `${base}${fileName}`;
    const res = await fetchFn(fixtureUrl, { signal: opts?.signal });
    if (!res.ok) {
      throw new DatabaseHttpError(res.status, fixtureUrl);
    }

    const { bytes, text } = await readResponseWithSizeCap(res, fixtureUrl);
    const sha256 = await sha256Hex(bytes);

    const expectedSha = record.expectedSha256 ?? pinned?.sha256 ?? null;
    if (expectedSha && sha256 !== expectedSha) {
      warnings.push(
        `SHA-256 differs from fixtures-manifest.json (expected ${expectedSha.slice(0, 12)}…, got ${sha256.slice(0, 12)}…).`,
      );
    }

    let paeJson: string | null = null;
    let paeSha256: string | null = null;
    const paeFile = record.pinnedPaeFileName ?? pinned?.paeFileName ?? null;
    if (paeFile) {
      const paeUrl = `${base}${paeFile}`;
      try {
        const paeRes = await fetchFn(paeUrl, { signal: opts?.signal });
        if (paeRes.ok) {
          const paeData = await readResponseWithSizeCap(paeRes, paeUrl);
          paeJson = paeData.text;
          paeSha256 = await sha256Hex(paeData.bytes);
        } else {
          warnings.push(`Pinned PAE matrix (${paeFile}) returned HTTP ${paeRes.status}.`);
        }
      } catch (err) {
        if (isAbortError(err, opts?.signal)) throw err;
        warnings.push(`Pinned PAE matrix (${paeFile}) could not be loaded.`);
      }
    }

    const sourceTypeHint: 'experimental' | 'prediction' =
      record.source === 'alphafold' || record.source === 'uniprot' || pinned?.source === 'alphafold'
        ? 'prediction'
        : 'experimental';

    return {
      label: fileName,
      content: text,
      sha256,
      sourceUrl: record.sourceUrl || pinned?.sourceUrl || fixtureUrl,
      downloadUrl: record.downloadUrl ?? pinned?.sourceUrl ?? fixtureUrl,
      license: record.license || pinned?.license || (sourceTypeHint === 'prediction' ? DB_LICENSES.alphafold : DB_LICENSES.rcsb),
      retrievedAtUtc: record.retrievedAtUtc || pinned?.retrievedAtUtc || getNowIso(opts),
      dataRevision: record.dataRevision ?? pinned?.dataRevision ?? null,
      origin: 'pinned-local-cache',
      sourceTypeHint,
      paeJson,
      paeSha256,
      uniprotAccession: record.uniprotAccession ?? pinned?.uniprotAccession ?? undefined,
      byteLength: bytes.byteLength,
      warnings,
    };
  }

  // Live RCSB PDB mmCIF download
  if (record.source === 'rcsb') {
    const pdbId = normalizePdbId(record.id);
    const downloadUrl = record.downloadUrl || rcsbCifUrl(pdbId);
    const res = await fetchFn(downloadUrl, { signal: opts?.signal });
    if (!res.ok) {
      throw new DatabaseHttpError(res.status, downloadUrl);
    }

    const { bytes, text } = await readResponseWithSizeCap(res, downloadUrl);
    const sha256 = await sha256Hex(bytes);
    const retrievedAtUtc = getNowIso(opts);

    return {
      label: `${pdbId}.cif`,
      content: text,
      sha256,
      sourceUrl: record.sourceUrl || rcsbEntryPageUrl(pdbId),
      downloadUrl,
      license: record.license || DB_LICENSES.rcsb,
      retrievedAtUtc,
      dataRevision: record.dataRevision ?? null,
      origin: 'live-network',
      sourceTypeHint: 'experimental',
      paeJson: null,
      paeSha256: null,
      uniprotAccession: record.uniprotAccession ?? undefined,
      byteLength: bytes.byteLength,
      warnings,
    };
  }

  // Live AlphaFold DB (or UniProt -> AlphaFold DB)
  const acc =
    record.uniprotAccession ??
    extractUniProtAccession(record.id) ??
    normalizeUniProtAccession(record.id);

  let predEntry: Record<string, unknown> | null =
    record.raw && typeof record.raw === 'object' && typeof (record.raw as Record<string, unknown>).cifUrl === 'string'
      ? (record.raw as Record<string, unknown>)
      : null;

  if (!predEntry) {
    const predUrl = alphafoldPredictionUrl(acc);
    const predRes = await fetchFn(predUrl, { signal: opts?.signal });
    if (!predRes.ok) {
      throw new DatabaseHttpError(predRes.status, predUrl);
    }
    const predJson = (await predRes.json()) as unknown;
    const arr = Array.isArray(predJson) ? predJson : [predJson];
    const first = arr[0];
    if (!first || typeof first !== 'object' || typeof (first as Record<string, unknown>).cifUrl !== 'string') {
      throw new Error(`AlphaFold prediction API did not return a cifUrl for ${acc}.`);
    }
    predEntry = first as Record<string, unknown>;
  }

  const cifUrl = String(predEntry.cifUrl);
  const cifRes = await fetchFn(cifUrl, { signal: opts?.signal });
  if (!cifRes.ok) {
    throw new DatabaseHttpError(cifRes.status, cifUrl);
  }
  const { bytes: cifBytes, text: cifText } = await readResponseWithSizeCap(cifRes, cifUrl);
  const sha256 = await sha256Hex(cifBytes);

  let paeJson: string | null = null;
  let paeSha256: string | null = null;
  const paeDocUrl = typeof predEntry.paeDocUrl === 'string' && predEntry.paeDocUrl ? predEntry.paeDocUrl : null;
  if (paeDocUrl) {
    const paeRes = await fetchFn(paeDocUrl, { signal: opts?.signal });
    if (paeRes.ok) {
      const paeData = await readResponseWithSizeCap(paeRes, paeDocUrl);
      paeJson = paeData.text;
      paeSha256 = await sha256Hex(paeData.bytes);
    } else {
      warnings.push(`AlphaFold PAE fetch returned HTTP ${paeRes.status}; imported structure without PAE matrix.`);
    }
  }

  const entryId =
    typeof predEntry.entryId === 'string' && predEntry.entryId.trim()
      ? predEntry.entryId.trim()
      : `AF-${acc}-F1`;
  const dataRevision = formatAlphaFoldRevision(predEntry) ?? record.dataRevision ?? null;
  const retrievedAtUtc = getNowIso(opts);

  return {
    label: `${entryId}.cif`,
    content: cifText,
    sha256,
    sourceUrl: record.sourceUrl && record.source === 'alphafold' ? record.sourceUrl : alphafoldEntryPageUrl(acc),
    downloadUrl: cifUrl,
    license: DB_LICENSES.alphafold,
    retrievedAtUtc,
    dataRevision,
    origin: 'live-network',
    sourceTypeHint: 'prediction',
    paeJson,
    paeSha256,
    uniprotAccession: acc,
    byteLength: cifBytes.byteLength,
    warnings,
  };
}

/**
 * Extracts verified compound SMILES and provenance metadata from a PubChem `DbRecord`.
 */
export function importCompoundRecord(record: DbRecord): ImportedCompound {
  if (record.source !== 'pubchem' && record.source !== 'chembl') {
    throw new Error(`Expected a PubChem or ChEMBL record, got "${record.source}".`);
  }

  const rawObj =
    record.raw && typeof record.raw === 'object' ? (record.raw as Record<string, unknown>) : null;
  const smiles =
    (typeof record.smiles === 'string' && record.smiles.trim() ? record.smiles.trim() : null) ??
    extractPubChemSmiles(rawObj);

  if (!smiles) {
    throw new Error(
      `No SMILES string is available for "${record.title}" (live PubChem or /fixtures/pubchem-panel.json required).`,
    );
  }

  const cidCandidate = parseFiniteNumber(rawObj?.CID ?? record.id);
  const cid =
    cidCandidate !== null && Number.isInteger(cidCandidate) && cidCandidate > 0
      ? cidCandidate
      : null;

  return {
    name: record.title,
    smiles,
    cid,
    formula: record.formula ?? (typeof rawObj?.MolecularFormula === 'string' ? rawObj.MolecularFormula : null),
    molecularWeight:
      record.molecularWeight ?? parseFiniteNumber(rawObj?.MolecularWeight) ?? null,
    sourceUrl: record.sourceUrl,
    license: record.license || DB_LICENSES.pubchem,
    retrievedAtUtc: record.retrievedAtUtc,
    origin: record.origin,
  };
}
