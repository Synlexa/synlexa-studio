import { sha256HexUniversal } from './sha256';
import type { CompareStructuresResult } from '@synlexa/wasm-bridge';
import { RUO_DISCLAIMER } from './reportGenerator';

export interface BundleFileEntry {
  path: string;
  role: 'reference' | 'mobile' | 'pae' | 'manifest';
  label: string;
  sha256: string;
  content: string;
}

export interface ProjectBundleState {
  refChain: string;
  mobChain: string;
  focusedSeqId: number | null;
  peptide: {
    sequence: string;
    mutations: string[];
    sliceStart?: number;
    sliceEnd?: number;
  };
  crispr: {
    transcriptId: string;
    customDna: string;
    targetCodonIndex: number;
    baseEditIndex?: number;
    newBase?: 'A' | 'C' | 'G' | 'T';
    nuclease: 'SpCas9' | 'SaCas9' | 'Cas12a';
  };
  smiles: {
    name: string;
    smiles: string;
  };
}

export interface ProjectBundleV1 {
  schemaVersion: '1.0.0';
  bundleFormat: 'synlexa-studio-bundle-v1';
  ruoNotice: string;
  exportedAtUtc: string;
  files: BundleFileEntry[];
  state: ProjectBundleState;
  comparisonResult: CompareStructuresResult | null;
}

export class BundleValidationError extends Error {
  public readonly code:
    | 'ERR_BUNDLE_PARSE'
    | 'ERR_BUNDLE_SCHEMA'
    | 'ERR_BUNDLE_PATH_TRAVERSAL'
    | 'ERR_BUNDLE_DUPLICATE_PATH'
    | 'ERR_BUNDLE_HASH_MISMATCH';

  constructor(
    code:
      | 'ERR_BUNDLE_PARSE'
      | 'ERR_BUNDLE_SCHEMA'
      | 'ERR_BUNDLE_PATH_TRAVERSAL'
      | 'ERR_BUNDLE_DUPLICATE_PATH'
      | 'ERR_BUNDLE_HASH_MISMATCH',
    message: string,
  ) {
    super(message);
    this.name = 'BundleValidationError';
    this.code = code;
  }
}

const textEncoder = new TextEncoder();

export async function computeSha256Hex(content: string): Promise<string> {
  return sha256HexUniversal(textEncoder.encode(content));
}

export function validateSafeBundlePath(rawPath: unknown): string {
  if (typeof rawPath !== 'string' || rawPath.length === 0) {
    throw new BundleValidationError(
      'ERR_BUNDLE_PATH_TRAVERSAL',
      'Bundle file path must be a non-empty relative string.',
    );
  }
  if (rawPath.includes('\0') || rawPath.includes('\\')) {
    throw new BundleValidationError(
      'ERR_BUNDLE_PATH_TRAVERSAL',
      `Invalid path characters in "${rawPath}".`,
    );
  }
  if (/%2e|%2f|%5c/i.test(rawPath)) {
    throw new BundleValidationError(
      'ERR_BUNDLE_PATH_TRAVERSAL',
      `Encoded traversal characters are not allowed in "${rawPath}".`,
    );
  }
  if (rawPath.startsWith('/') || /^[A-Za-z]:/.test(rawPath)) {
    throw new BundleValidationError(
      'ERR_BUNDLE_PATH_TRAVERSAL',
      `Absolute paths are prohibited in bundle: "${rawPath}".`,
    );
  }
  const segments = rawPath.split('/');
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..') {
      throw new BundleValidationError(
        'ERR_BUNDLE_PATH_TRAVERSAL',
        `Path traversal or empty segment rejected: "${rawPath}".`,
      );
    }
    if (!/^[A-Za-z0-9._-]+$/.test(seg)) {
      throw new BundleValidationError(
        'ERR_BUNDLE_PATH_TRAVERSAL',
        `Unsupported characters in path segment "${seg}".`,
      );
    }
  }
  return rawPath;
}

export async function createProjectBundle(params: {
  refLabel: string;
  refContent: string;
  mobLabel: string;
  mobContent: string;
  paeJson?: string | null;
  state: ProjectBundleState;
  comparisonResult: CompareStructuresResult | null;
}): Promise<ProjectBundleV1> {
  const [refSha, mobSha] = await Promise.all([
    computeSha256Hex(params.refContent),
    computeSha256Hex(params.mobContent),
  ]);

  const files: BundleFileEntry[] = [
    {
      path: 'structures/reference.cif',
      role: 'reference',
      label: params.refLabel,
      sha256: refSha,
      content: params.refContent,
    },
    {
      path: 'structures/mobile.cif',
      role: 'mobile',
      label: params.mobLabel,
      sha256: mobSha,
      content: params.mobContent,
    },
  ];

  if (params.paeJson && params.paeJson.trim().length > 0) {
    files.push({
      path: 'pae/predicted_aligned_error.json',
      role: 'pae',
      label: 'PAE Matrix',
      sha256: await computeSha256Hex(params.paeJson),
      content: params.paeJson,
    });
  }

  return {
    schemaVersion: '1.0.0',
    bundleFormat: 'synlexa-studio-bundle-v1',
    ruoNotice: RUO_DISCLAIMER,
    exportedAtUtc: new Date().toISOString(),
    files,
    state: params.state,
    comparisonResult: params.comparisonResult,
  };
}

export async function parseAndValidateProjectBundle(
  rawJson: string,
): Promise<ProjectBundleV1> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    throw new BundleValidationError(
      'ERR_BUNDLE_PARSE',
      `Invalid bundle JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new BundleValidationError('ERR_BUNDLE_SCHEMA', 'Bundle root must be an object.');
  }

  const obj = parsed as Partial<ProjectBundleV1>;
  if (obj.bundleFormat !== 'synlexa-studio-bundle-v1' || obj.schemaVersion !== '1.0.0') {
    throw new BundleValidationError(
      'ERR_BUNDLE_SCHEMA',
      'Unsupported bundleFormat or schemaVersion (expected synlexa-studio-bundle-v1 / 1.0.0).',
    );
  }

  if (!Array.isArray(obj.files) || obj.files.length === 0) {
    throw new BundleValidationError('ERR_BUNDLE_SCHEMA', 'Bundle must contain a non-empty files array.');
  }

  if (!obj.state || typeof obj.state !== 'object') {
    throw new BundleValidationError('ERR_BUNDLE_SCHEMA', 'Bundle missing workspace state.');
  }

  const seenPaths = new Set<string>();
  const shaByRole = new Map<string, string>();

  for (const entry of obj.files) {
    if (!entry || typeof entry !== 'object') {
      throw new BundleValidationError('ERR_BUNDLE_SCHEMA', 'Invalid file entry in bundle.');
    }
    const safePath = validateSafeBundlePath(entry.path);
    if (seenPaths.has(safePath)) {
      throw new BundleValidationError(
        'ERR_BUNDLE_DUPLICATE_PATH',
        `Duplicate bundle file path "${safePath}".`,
      );
    }
    seenPaths.add(safePath);

    if (typeof entry.content !== 'string' || typeof entry.sha256 !== 'string') {
      throw new BundleValidationError(
        'ERR_BUNDLE_SCHEMA',
        `File "${safePath}" missing string content or sha256.`,
      );
    }

    if (!/^[a-fA-F0-9]{64}$/.test(entry.sha256)) {
      throw new BundleValidationError(
        'ERR_BUNDLE_HASH_MISMATCH',
        `Invalid SHA-256 format on "${safePath}".`,
      );
    }

    const actualHash = await computeSha256Hex(entry.content);
    if (actualHash !== entry.sha256.toLowerCase()) {
      throw new BundleValidationError(
        'ERR_BUNDLE_HASH_MISMATCH',
        `SHA-256 mismatch on "${safePath}": expected ${entry.sha256}, computed ${actualHash}.`,
      );
    }

    if (entry.role === 'reference' || entry.role === 'mobile') {
      shaByRole.set(entry.role, actualHash);
    }
  }

  if (obj.comparisonResult) {
    const refSha = shaByRole.get('reference');
    const mobSha = shaByRole.get('mobile');
    if (
      refSha &&
      obj.comparisonResult.reference?.sha256 &&
      obj.comparisonResult.reference.sha256.toLowerCase() !== refSha
    ) {
      throw new BundleValidationError(
        'ERR_BUNDLE_HASH_MISMATCH',
        'Bundled comparisonResult.reference.sha256 does not match reference file digest.',
      );
    }
    if (
      mobSha &&
      obj.comparisonResult.mobile?.sha256 &&
      obj.comparisonResult.mobile.sha256.toLowerCase() !== mobSha
    ) {
      throw new BundleValidationError(
        'ERR_BUNDLE_HASH_MISMATCH',
        'Bundled comparisonResult.mobile.sha256 does not match mobile file digest.',
      );
    }
  }

  return obj as ProjectBundleV1;
}
