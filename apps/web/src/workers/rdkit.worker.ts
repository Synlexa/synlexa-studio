import initRDKitModule, { type MainModule } from '@rdkit/rdkit';
import {
  analyzeMoleculeWithRdkit,
  searchWithRdkit,
  type RdkitSearchCandidate,
} from '../lib/rdkitCore';

interface RunMsg {
  type: 'run';
  id: number;
  channel: string;
  op: 'analyze' | 'search';
  payload: unknown;
}

interface CancelMsg {
  type: 'cancel';
  channel: string;
  minId: number;
}

type InMsg = RunMsg | CancelMsg;

let rdkitPromise: Promise<MainModule> | null = null;
const latestChannelId = new Map<string, number>();

function getRdkit(): Promise<MainModule> {
  if (!rdkitPromise) {
    rdkitPromise = initRDKitModule({
      locateFile: (file: string) => `/wasm/rdkit/${file}`,
    });
  }
  return rdkitPromise;
}

self.onmessage = async (event: MessageEvent<InMsg>) => {
  const msg = event.data;
  if (msg.type === 'cancel') {
    const prev = latestChannelId.get(msg.channel) ?? 0;
    if (msg.minId > prev) latestChannelId.set(msg.channel, msg.minId);
    return;
  }

  latestChannelId.set(msg.channel, Math.max(latestChannelId.get(msg.channel) ?? 0, msg.id));

  try {
    const rdkit = await getRdkit();
    if ((latestChannelId.get(msg.channel) ?? 0) > msg.id) {
      self.postMessage({ id: msg.id, cancelled: true });
      return;
    }

    if (msg.op === 'analyze') {
      const p = msg.payload as { input: string; highlightSmarts?: string; width?: number; height?: number };
      const data = analyzeMoleculeWithRdkit(rdkit, p.input, p);
      self.postMessage({ id: msg.id, ok: true, data });
      return;
    }

    if (msg.op === 'search') {
      const p = msg.payload as { query: string; candidates: RdkitSearchCandidate[] };
      const data = searchWithRdkit(rdkit, p.query, p.candidates);
      self.postMessage({ id: msg.id, ok: true, data });
      return;
    }

    self.postMessage({ id: msg.id, ok: false, error: `Unknown RDKit worker op: ${String(msg.op)}` });
  } catch (err) {
    self.postMessage({
      id: msg.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
