import {
  BioCoreWasmSession,
  loadWasmBioCore,
  type BioCoreOp,
  type BioCoreResponse,
} from '@synlexa/wasm-bridge';

interface WorkerRunMessage {
  type: 'run';
  id: number;
  channel: string;
  op: BioCoreOp;
  payload: unknown;
  wasmUrl?: string;
}

interface WorkerCancelMessage {
  type: 'cancel';
  channel: string;
  minId: number;
}

type WorkerInMessage = WorkerRunMessage | WorkerCancelMessage;

let sessionPromise: Promise<BioCoreWasmSession> | null = null;
const latestChannelId = new Map<string, number>();

function getSession(wasmUrl = '/wasm/synlexa_bio_core.wasm'): Promise<BioCoreWasmSession> {
  if (!sessionPromise) {
    sessionPromise = loadWasmBioCore(wasmUrl);
  }
  return sessionPromise;
}

self.onmessage = async (event: MessageEvent<WorkerInMessage>) => {
  const msg = event.data;

  if (msg.type === 'cancel') {
    const prev = latestChannelId.get(msg.channel) ?? 0;
    if (msg.minId > prev) {
      latestChannelId.set(msg.channel, msg.minId);
    }
    return;
  }

  latestChannelId.set(
    msg.channel,
    Math.max(latestChannelId.get(msg.channel) ?? 0, msg.id),
  );

  try {
    const session = await getSession(msg.wasmUrl);

    // Drop stale request before calling Wasm if superseded while Wasm loaded.
    if ((latestChannelId.get(msg.channel) ?? 0) > msg.id) {
      self.postMessage({ id: msg.id, cancelled: true });
      return;
    }

    const response: BioCoreResponse<unknown> = session.invokeJson(
      msg.op,
      msg.payload,
    );

    if ((latestChannelId.get(msg.channel) ?? 0) > msg.id) {
      self.postMessage({ id: msg.id, cancelled: true });
      return;
    }

    self.postMessage({ id: msg.id, cancelled: false, response });
  } catch (err) {
    // Allow retry if Wasm failed to initialize cleanly.
    if (!sessionPromise) {
      sessionPromise = null;
    }
    self.postMessage({
      id: msg.id,
      cancelled: false,
      fatalError: err instanceof Error ? err.message : String(err),
    });
  }
};
