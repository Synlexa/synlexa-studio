import type { MainModule } from '@rdkit/rdkit';
import {
  analyzeMoleculeWithRdkit,
  searchWithRdkit,
  type RdkitMoleculeAnalysis,
  type RdkitSearchCandidate,
  type RdkitSearchHit,
} from './rdkitCore';

export type {
  RdkitMoleculeAnalysis,
  RdkitSearchCandidate,
  RdkitSearchHit,
  RdkitStructuralAlert,
} from './rdkitCore';

interface Pending {
  resolve: (val: unknown) => void;
  reject: (err: Error) => void;
}

export class RdkitClient {
  private worker: Worker | null = null;
  private directModule: MainModule | null = null;
  private nextId = 1;
  private readonly latestByChannel = new Map<string, number>();
  private readonly pending = new Map<number, Pending>();

  static fromModule(mod: MainModule): RdkitClient {
    const c = new RdkitClient();
    c.directModule = mod;
    return c;
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    if (typeof Worker === 'undefined') {
      throw new Error('Web Worker is unavailable; use RdkitClient.fromModule() in Node tests.');
    }
    const worker = new Worker(new URL('../workers/rdkit.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (
      ev: MessageEvent<{ id: number; cancelled?: boolean; ok?: boolean; data?: unknown; error?: string }>,
    ) => {
      const { id, cancelled, ok, data, error } = ev.data;
      const entry = this.pending.get(id);
      if (!entry) return;
      this.pending.delete(id);
      if (cancelled) {
        entry.reject(new Error('Cancelled stale RDKit request.'));
      } else if (ok) {
        entry.resolve(data);
      } else {
        entry.reject(new Error(error || 'RDKit WASM error'));
      }
    };
    worker.onerror = (ev) => {
      for (const [, p] of this.pending) p.reject(new Error(ev.message || 'RDKit worker failure'));
      this.pending.clear();
    };
    this.worker = worker;
    return worker;
  }

  public cancelChannel(channel: string): void {
    const id = this.nextId++;
    this.latestByChannel.set(channel, id);
    this.worker?.postMessage({ type: 'cancel', channel, minId: id });
  }

  private async run<T>(channel: string, op: 'analyze' | 'search', payload: unknown): Promise<T> {
    if (this.directModule) {
      if (op === 'analyze') {
        const p = payload as { input: string; highlightSmarts?: string; width?: number; height?: number };
        return analyzeMoleculeWithRdkit(this.directModule, p.input, p) as T;
      }
      const p = payload as { query: string; candidates: RdkitSearchCandidate[] };
      return searchWithRdkit(this.directModule, p.query, p.candidates) as T;
    }

    const id = this.nextId++;
    this.latestByChannel.set(channel, id);
    const worker = this.ensureWorker();
    const result = await new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
      });
      worker.postMessage({ type: 'run', id, channel, op, payload });
    });
    if ((this.latestByChannel.get(channel) ?? 0) > id) {
      throw new Error('Cancelled stale RDKit request.');
    }
    return result;
  }

  public analyzeMolecule(
    input: string,
    options?: { highlightSmarts?: string; width?: number; height?: number },
  ): Promise<RdkitMoleculeAnalysis> {
    return this.run<RdkitMoleculeAnalysis>('analyze', 'analyze', { input, ...options });
  }

  public searchLibrary(query: string, candidates: RdkitSearchCandidate[]): Promise<RdkitSearchHit[]> {
    return this.run<RdkitSearchHit[]>('search', 'search', { query, candidates });
  }

  public dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}

let sharedClient: RdkitClient | null = null;
export function getSharedRdkitClient(): RdkitClient {
  if (!sharedClient) sharedClient = new RdkitClient();
  return sharedClient;
}
