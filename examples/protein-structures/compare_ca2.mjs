#!/usr/bin/env node
/**
 * Example: Load Synlexa Bio-Core WebAssembly in Node.js (ABI v1) and run
 * deterministic float64 Kabsch superposition for Carbonic Anhydrase II.
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../..');

const [wasmBytes, refCif, mobCif, paeJson] = await Promise.all([
  readFile(resolve(root, 'apps/web/public/wasm/synlexa_bio_core.wasm')),
  readFile(resolve(root, 'tests/fixtures/3HS4.cif'), 'utf8'),
  readFile(resolve(root, 'tests/fixtures/AF-P00918-F1-model_v6.cif'), 'utf8'),
  readFile(resolve(root, 'tests/fixtures/AF-P00918-F1-predicted_aligned_error_v6.json'), 'utf8'),
]);

const { instance } = await WebAssembly.instantiate(new Uint8Array(wasmBytes), {});
const exp = instance.exports;
const enc = new TextEncoder();
const dec = new TextDecoder('utf-8');

const req = enc.encode(
  JSON.stringify({
    op: 'compare_structures',
    payload: {
      refLabel: '3HS4.cif',
      refContent: refCif,
      refChain: 'A',
      mobLabel: 'AF-P00918-F1-model_v6.cif',
      mobContent: mobCif,
      mobChain: 'A',
      paeJson,
    },
  }),
);
const ptr = exp.alloc(req.byteLength);
let out;
try {
  new Uint8Array(exp.memory.buffer, ptr, req.byteLength).set(req);
  const resPtr = exp.invoke_json(ptr, req.byteLength);
  const resLen = exp.last_result_len();
  out = JSON.parse(dec.decode(new Uint8Array(exp.memory.buffer, resPtr, resLen)));
} finally {
  exp.dealloc(ptr, req.byteLength);
}

if (!out.ok) {
  console.error(out.error);
  process.exit(1);
}

console.log({
  matchedCaCount: out.data.metrics.matchedCaCount,
  rmsdAngstrom: out.data.metrics.rmsdAngstrom,
  paeStatus: out.data.metrics.paeStatus,
  ruoNotice: out.data.ruoNotice,
});
