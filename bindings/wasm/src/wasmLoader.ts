import type {
  AnalyzeRamachandranRequest,
  AnalyzeRamachandranResult,
  BioCoreOp,
  BioCoreResponse,
  WasmBioCoreExports,
} from './types.js';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: false });

export type WasmSource =
  | string
  | URL
  | Response
  | ArrayBuffer
  | ArrayBufferView
  | WebAssembly.Module;

export class WasmAbiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WasmAbiError';
  }
}

function assertExports(exportsObj: WebAssembly.Exports): WasmBioCoreExports {
  const candidate = exportsObj as Partial<WasmBioCoreExports>;
  const required = [
    'memory',
    'alloc',
    'dealloc',
    'abi_version',
    'last_result_len',
    'invoke_json',
    'extract_ca_coords_f64',
  ] as const;

  for (const key of required) {
    if (candidate[key] === undefined) {
      throw new WasmAbiError(
        `Wasm module missing required ABI export "${key}".`,
      );
    }
  }
  return candidate as WasmBioCoreExports;
}

async function instantiateFromSource(
  source: WasmSource,
): Promise<WebAssembly.Instance> {
  const imports: WebAssembly.Imports = {};

  if (source instanceof WebAssembly.Module) {
    return WebAssembly.instantiate(source, imports);
  }

  if (source instanceof ArrayBuffer) {
    const result = await WebAssembly.instantiate(source, imports);
    return result.instance;
  }

  if (ArrayBuffer.isView(source)) {
    const copy = new Uint8Array(source.byteLength);
    copy.set(
      new Uint8Array(source.buffer, source.byteOffset, source.byteLength),
    );
    const result = await WebAssembly.instantiate(copy.buffer, imports);
    return result.instance;
  }

  let response: Response;
  if (typeof source === 'string' || source instanceof URL) {
    response = await fetch(source);
    if (!response.ok) {
      throw new WasmAbiError(
        `Failed to fetch Wasm module (${response.status} ${response.statusText})`,
      );
    }
  } else {
    response = source;
  }

  if (typeof WebAssembly.instantiateStreaming === 'function') {
    try {
      const cloned = response.clone();
      const result = await WebAssembly.instantiateStreaming(cloned, imports);
      return result.instance;
    } catch {
      // Fallback when MIME type is not application/wasm or streaming fails.
    }
  }

  const buffer = await response.arrayBuffer();
  const result = await WebAssembly.instantiate(buffer, imports);
  return result.instance;
}

export class BioCoreWasmSession {
  private readonly exports: WasmBioCoreExports;
  public readonly abiVersion: number;

  constructor(instanceOrExports: WebAssembly.Instance | WasmBioCoreExports) {
    const rawExports =
      'exports' in instanceOrExports
        ? (instanceOrExports as WebAssembly.Instance).exports
        : instanceOrExports;
    this.exports = assertExports(rawExports);
    this.abiVersion = this.exports.abi_version();
    if (this.abiVersion !== 1) {
      throw new WasmAbiError(
        `Unsupported Synlexa Wasm ABI version ${this.abiVersion} (expected 1).`,
      );
    }
  }

  invokeRaw(requestJson: string): string {
    const bytes = textEncoder.encode(requestJson);
    const reqLen = bytes.byteLength;
    const reqPtr = reqLen > 0 ? this.exports.alloc(reqLen) : 0;

    if (reqLen > 0 && reqPtr === 0) {
      throw new WasmAbiError(`Wasm alloc(${reqLen}) returned null pointer.`);
    }

    try {
      if (reqLen > 0) {
        const memView = new Uint8Array(
          this.exports.memory.buffer,
          reqPtr,
          reqLen,
        );
        memView.set(bytes);
      }

      const resPtr = this.exports.invoke_json(reqPtr, reqLen);
      const resLen = this.exports.last_result_len();
      if (resPtr === 0 || resLen === 0) {
        throw new WasmAbiError('Wasm invoke_json returned empty response buffer.');
      }

      // Re-read memory.buffer in case Wasm memory grew during invoke_json.
      const resBytes = new Uint8Array(
        this.exports.memory.buffer,
        resPtr,
        resLen,
      ).slice();
      return textDecoder.decode(resBytes);
    } finally {
      if (reqLen > 0 && reqPtr !== 0) {
        this.exports.dealloc(reqPtr, reqLen);
      }
    }
  }

  invokeJson<TReq, TRes>(
    op: BioCoreOp,
    payload: TReq,
  ): BioCoreResponse<TRes> {
    const requestStr = JSON.stringify({ op, payload });
    const responseStr = this.invokeRaw(requestStr);
    return JSON.parse(responseStr) as BioCoreResponse<TRes>;
  }

  analyzeRamachandran(
    payload: AnalyzeRamachandranRequest,
  ): BioCoreResponse<AnalyzeRamachandranResult> {
    return this.invokeJson<AnalyzeRamachandranRequest, AnalyzeRamachandranResult>(
      'analyze_ramachandran',
      payload,
    );
  }

  extractCaCoordsF64(
    payload: { content: string; chainId?: string },
    maxAtoms = 65536,
  ): Float64Array {
    const reqBytes = textEncoder.encode(JSON.stringify(payload));
    const reqLen = reqBytes.byteLength;
    const reqPtr = this.exports.alloc(reqLen);
    if (reqPtr === 0) {
      throw new WasmAbiError(`Wasm alloc(${reqLen}) failed.`);
    }

    // Allocate extra 8 bytes to allow manual 8-byte alignment if alloc returns 4-byte aligned address.
    const outByteSize = maxAtoms * 4 * 8 + 8;
    const outRawPtr = this.exports.alloc(outByteSize);
    if (outRawPtr === 0) {
      this.exports.dealloc(reqPtr, reqLen);
      throw new WasmAbiError(`Wasm alloc(${outByteSize}) failed for f64 buffer.`);
    }

    const alignedOutPtr = ((outRawPtr + 7) & ~7) >>> 0;

    try {
      new Uint8Array(this.exports.memory.buffer, reqPtr, reqLen).set(reqBytes);
      const atomCount = this.exports.extract_ca_coords_f64(
        reqPtr,
        reqLen,
        alignedOutPtr,
        maxAtoms,
      );
      const count = Math.min(atomCount, maxAtoms);
      const view = new Float64Array(
        this.exports.memory.buffer,
        alignedOutPtr,
        count * 4,
      );
      return view.slice();
    } finally {
      this.exports.dealloc(reqPtr, reqLen);
      this.exports.dealloc(outRawPtr, outByteSize);
    }
  }
}

export async function loadWasmBioCore(
  source: WasmSource,
): Promise<BioCoreWasmSession> {
  const instance = await instantiateFromSource(source);
  return new BioCoreWasmSession(instance);
}
