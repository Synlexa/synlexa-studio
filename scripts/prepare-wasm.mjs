#!/usr/bin/env node
/**
 * Prepares WebAssembly runtime artifacts under apps/web/public/wasm/ from
 * source and installed npm dependencies so prebuilt binaries do not need to be
 * committed to Git.
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const force = process.argv.includes('--force');
const req = createRequire(import.meta.url);

function newestMtimeMs(dirOrFile) {
  if (!existsSync(dirOrFile)) return 0;
  const st = statSync(dirOrFile);
  if (st.isFile()) return st.mtimeMs;
  let latest = st.mtimeMs;
  for (const entry of readdirSync(dirOrFile, { withFileTypes: true })) {
    const full = join(dirOrFile, entry.name);
    if (entry.name === 'target' || entry.name === 'node_modules') continue;
    latest = Math.max(latest, entry.isDirectory() ? newestMtimeMs(full) : statSync(full).mtimeMs);
  }
  return latest;
}

// 1. Sync @rdkit/rdkit WASM from installed node_modules
const rdkitDest = join(root, 'apps/web/public/wasm/rdkit/RDKit_minimal.wasm');
let rdkitSrc = null;
for (const candidate of [
  join(root, 'apps/web/node_modules/@rdkit/rdkit/dist/RDKit_minimal.wasm'),
  join(root, 'node_modules/@rdkit/rdkit/dist/RDKit_minimal.wasm'),
]) {
  if (existsSync(candidate)) {
    rdkitSrc = candidate;
    break;
  }
}
if (!rdkitSrc) {
  try {
    const pkgJson = req.resolve('@rdkit/rdkit/package.json', { paths: [join(root, 'apps/web'), root] });
    const cand = join(dirname(pkgJson), 'dist/RDKit_minimal.wasm');
    if (existsSync(cand)) rdkitSrc = cand;
  } catch {
    // ignore
  }
}
if (!rdkitSrc) {
  console.error('Error: @rdkit/rdkit WASM binary not found. Run `pnpm install` first.');
  process.exit(1);
}
mkdirSync(dirname(rdkitDest), { recursive: true });
const needRdkitCopy =
  force ||
  !existsSync(rdkitDest) ||
  statSync(rdkitDest).size !== statSync(rdkitSrc).size;
if (needRdkitCopy) {
  copyFileSync(rdkitSrc, rdkitDest);
  console.log(`Synced RDKit WASM (${statSync(rdkitDest).size} bytes) -> ${rdkitDest}`);
}

// 2. Build synlexa_bio_core.wasm from crates/studio-wasm if missing or stale
const bioWasmDest = join(root, 'apps/web/public/wasm/synlexa_bio_core.wasm');
const bioWasmTarget = join(root, 'target/wasm32-unknown-unknown/release/studio_wasm.wasm');
const rustSourceMtime = Math.max(
  newestMtimeMs(join(root, 'Cargo.toml')),
  newestMtimeMs(join(root, 'crates/synlexa-bio-core')),
  newestMtimeMs(join(root, 'crates/studio-wasm')),
);
const destMtime = existsSync(bioWasmDest) ? statSync(bioWasmDest).mtimeMs : 0;

if (force || !existsSync(bioWasmDest) || rustSourceMtime > destMtime) {
  try {
    execFileSync(
      'cargo',
      ['build', '-p', 'studio-wasm', '--target', 'wasm32-unknown-unknown', '--release'],
      { cwd: root, stdio: 'inherit' },
    );
  } catch (err) {
    console.error(
      '\nFailed to build studio-wasm. Ensure the wasm32 target is installed:\n  rustup target add wasm32-unknown-unknown\n',
    );
    throw err;
  }
  mkdirSync(dirname(bioWasmDest), { recursive: true });
  copyFileSync(bioWasmTarget, bioWasmDest);
  console.log(`Built synlexa_bio_core.wasm (${statSync(bioWasmDest).size} bytes) -> ${bioWasmDest}`);
}
