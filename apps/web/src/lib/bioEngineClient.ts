import type {
  AnalyzeGeneCrisprRequest,
  AnalyzeGeneCrisprResult,
  AnalyzeMoleculeSmilesRequest,
  AnalyzeMoleculeSmilesResult,
  AnalyzePeptideRequest,
  AnalyzePeptideResult,
  AnalyzeRamachandranRequest,
  AnalyzeRamachandranResult,
  BioCoreError,
  BioCoreOp,
  BioCoreResponse,
  BioCoreWasmSession,
  CompareStructuresRequest,
  CompareStructuresResult,
  InspectStructureRequest,
  InspectStructureResult,
} from '@synlexa/wasm-bridge';

export class CancelledRunError extends Error {
  constructor(channel: string, id: number) {
    super(`Cancelled stale bio-core run on channel "${channel}" (#${id}).`);
    this.name = 'CancelledRunError';
  }
}

export class BioEngineOperationError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(err: BioCoreError) {
    super(err.message);
    this.name = 'BioEngineOperationError';
    this.code = err.code;
    this.details = err.details;
  }
}

export interface FixtureManifestEntry {
  id: string;
  fileName: string;
  kind: string;
  format: string;
  title: string;
  pdbId?: string;
  modelEntityId?: string;
  uniprotAccession?: string;
  sourceUrl: string;
  dataRevision: string;
  retrievedAtUtc: string;
  license: string;
  attribution: string;
  confidenceKind: string;
  sha256: string;
}

export interface FixtureManifest {
  schemaVersion: string;
  ruoNotice: string;
  generatedAtUtc: string;
  fixtures: FixtureManifestEntry[];
}

export interface SeededFixturesPayload {
  manifest: FixtureManifest;
  refCif: string;
  mobCif: string;
  paeJson: string;
}

export type BioCoreInvoker = (
  op: BioCoreOp,
  payload: unknown,
  meta: { id: number; channel: string },
) => Promise<{ cancelled?: boolean; response?: BioCoreResponse<unknown> }>;

interface PendingRequest {
  resolve: (value: { cancelled?: boolean; response?: BioCoreResponse<unknown> }) => void;
  reject: (err: Error) => void;
}

export class BioEngineClient {
  private worker: Worker | null = null;
  private customInvoker: BioCoreInvoker | null = null;
  private nextId = 1;
  private readonly latestIdByChannel = new Map<string, number>();
  private readonly pending = new Map<number, PendingRequest>();

  constructor(customInvoker?: BioCoreInvoker) {
    if (customInvoker) {
      this.customInvoker = customInvoker;
    }
  }

  static fromWasmSession(session: BioCoreWasmSession): BioEngineClient {
    return new BioEngineClient(async (op, payload) => ({
      cancelled: false,
      response: session.invokeJson(op, payload),
    }));
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    if (typeof Worker === 'undefined') {
      throw new Error('Web Worker is unavailable in this runtime; provide a custom invoker.');
    }
    const worker = new Worker(
      new URL('../workers/bioCore.worker.ts', import.meta.url),
      { type: 'module' },
    );
    worker.onmessage = (
      event: MessageEvent<{
        id: number;
        cancelled?: boolean;
        response?: BioCoreResponse<unknown>;
        fatalError?: string;
      }>,
    ) => {
      const { id, cancelled, response, fatalError } = event.data;
      const entry = this.pending.get(id);
      if (!entry) return;
      this.pending.delete(id);
      if (fatalError) {
        entry.reject(new Error(fatalError));
      } else {
        entry.resolve({ cancelled, response });
      }
    };
    worker.onerror = (err) => {
      for (const [, entry] of this.pending) {
        entry.reject(new Error(err.message || 'BioCore Web Worker error'));
      }
      this.pending.clear();
    };
    this.worker = worker;
    return worker;
  }

  public cancelChannel(channel: string): void {
    const token = this.nextId++;
    this.latestIdByChannel.set(channel, token);
    if (this.worker) {
      this.worker.postMessage({ type: 'cancel', channel, minId: token });
    }
  }

  public async invoke<TReq, TRes>(
    channel: string,
    op: BioCoreOp,
    payload: TReq,
  ): Promise<TRes> {
    const id = this.nextId++;
    this.latestIdByChannel.set(channel, id);

    let outcome: { cancelled?: boolean; response?: BioCoreResponse<unknown> };

    if (this.customInvoker) {
      outcome = await this.customInvoker(op, payload, { id, channel });
    } else {
      const worker = this.ensureWorker();
      outcome = await new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        worker.postMessage({
          type: 'run',
          id,
          channel,
          op,
          payload,
        });
      });
    }

    if (outcome.cancelled || this.latestIdByChannel.get(channel) !== id) {
      throw new CancelledRunError(channel, id);
    }

    const res = outcome.response;
    if (!res) {
      throw new Error(`Empty response from bio-core for ${op}`);
    }
    if (!res.ok) {
      throw new BioEngineOperationError(res.error);
    }
    return res.data as TRes;
  }

  public inspectStructure(
    channel: string,
    req: InspectStructureRequest,
  ): Promise<InspectStructureResult> {
    return this.invoke<InspectStructureRequest, InspectStructureResult>(
      channel,
      'inspect_structure',
      req,
    );
  }

  public compareStructures(
    req: CompareStructuresRequest,
    channel = 'compare',
  ): Promise<CompareStructuresResult> {
    return this.invoke<CompareStructuresRequest, CompareStructuresResult>(
      channel,
      'compare_structures',
      req,
    );
  }

  public analyzePeptide(
    req: AnalyzePeptideRequest,
    channel = 'peptide',
  ): Promise<AnalyzePeptideResult> {
    return this.invoke<AnalyzePeptideRequest, AnalyzePeptideResult>(
      channel,
      'analyze_peptide',
      req,
    );
  }

  public analyzeGeneCrispr(
    req: AnalyzeGeneCrisprRequest,
    channel = 'crispr',
  ): Promise<AnalyzeGeneCrisprResult> {
    return this.invoke<AnalyzeGeneCrisprRequest, AnalyzeGeneCrisprResult>(
      channel,
      'analyze_gene_crispr',
      req,
    );
  }

  public analyzeMoleculeSmiles(
    req: AnalyzeMoleculeSmilesRequest,
    channel = 'smiles',
  ): Promise<AnalyzeMoleculeSmilesResult> {
    return this.invoke<AnalyzeMoleculeSmilesRequest, AnalyzeMoleculeSmilesResult>(
      channel,
      'analyze_molecule_smiles',
      req,
    );
  }

  public analyzeRamachandran(
    req: AnalyzeRamachandranRequest,
    channel = 'ramachandran',
  ): Promise<AnalyzeRamachandranResult> {
    return this.invoke<AnalyzeRamachandranRequest, AnalyzeRamachandranResult>(
      channel,
      'analyze_ramachandran',
      req,
    );
  }

  public dispose(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    for (const [, entry] of this.pending) {
      entry.reject(new Error('BioEngineClient disposed'));
    }
    this.pending.clear();
  }
}

export async function loadPinnedManifest(): Promise<FixtureManifest> {
  const res = await fetch('/fixtures/fixtures-manifest.json');
  if (!res.ok) {
    throw new Error('Failed to load pinned fixtures manifest from /fixtures/.');
  }
  return (await res.json()) as FixtureManifest;
}

export async function loadPinnedFixtureFile(fileName: string): Promise<string> {
  if (!/^[A-Za-z0-9._-]+$/.test(fileName)) {
    throw new Error(`Invalid fixture file name: ${fileName}`);
  }
  const res = await fetch(`/fixtures/${fileName}`);
  if (!res.ok) {
    throw new Error(`Failed to load pinned fixture ${fileName} from /fixtures/.`);
  }
  return res.text();
}

export async function loadPinnedFixtures(): Promise<SeededFixturesPayload> {
  const [manifestRes, refRes, mobRes, paeRes] = await Promise.all([
    fetch('/fixtures/fixtures-manifest.json'),
    fetch('/fixtures/3HS4.cif'),
    fetch('/fixtures/AF-P00918-F1-model_v6.cif'),
    fetch('/fixtures/AF-P00918-F1-predicted_aligned_error_v6.json'),
  ]);

  if (!manifestRes.ok || !refRes.ok || !mobRes.ok || !paeRes.ok) {
    throw new Error('Failed to load pinned local fixtures from /fixtures/.');
  }

  const [manifest, refCif, mobCif, paeJson] = await Promise.all([
    manifestRes.json() as Promise<FixtureManifest>,
    refRes.text(),
    mobRes.text(),
    paeRes.text(),
  ]);

  return { manifest, refCif, mobCif, paeJson };
}
