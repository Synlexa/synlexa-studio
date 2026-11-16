import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, '..');
const hasWasm = existsSync(join(pkgRoot, 'wasm', 'synlexa_bio_core.wasm'));

if (!hasWasm) {
  console.log('[synlexa-studio] Installed CLI wrapper (platform binary or Wasm core will be resolved at runtime).');
}
