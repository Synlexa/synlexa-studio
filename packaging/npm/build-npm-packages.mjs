#!/usr/bin/env node
/**
 * Assembles publishable npm package directories under dist/npm/:
 *   - dist/npm/synlexa-studio/ (cross-platform launcher + bundled wasm + web-dist)
 *   - dist/npm/wasm-bridge/    (@synlexa/wasm-bridge compiled JS/TS + .wasm)
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const studioRoot = resolve(__dirname, '../..');
const outRoot = join(studioRoot, 'dist', 'npm');

rmSync(outRoot, { recursive: true, force: true });
mkdirSync(outRoot, { recursive: true });

// 1. synlexa-studio CLI/App/MCP npm package
const mainPkgDir = join(outRoot, 'synlexa-studio');
cpSync(join(__dirname, 'synlexa-studio'), mainPkgDir, { recursive: true });
const launcherMeta = JSON.parse(readFileSync(join(mainPkgDir, 'package.json'), 'utf8'));
const version = launcherMeta.version;

mkdirSync(join(mainPkgDir, 'wasm'), { recursive: true });

const wasmSrc = join(studioRoot, 'apps', 'web', 'public', 'wasm', 'synlexa_bio_core.wasm');
if (existsSync(wasmSrc)) {
  cpSync(wasmSrc, join(mainPkgDir, 'wasm', 'synlexa_bio_core.wasm'));
}
const webDistSrc = join(studioRoot, 'apps', 'web', 'dist');
if (existsSync(webDistSrc)) {
  cpSync(webDistSrc, join(mainPkgDir, 'web-dist'), { recursive: true });
}
for (const docFile of ['README.md', 'LICENSE', 'NOTICE']) {
  const p = join(studioRoot, docFile);
  if (existsSync(p)) cpSync(p, join(mainPkgDir, docFile));
}

// 2. @synlexa/wasm-bridge publishable Wasm package
const wasmPkgDir = join(outRoot, 'wasm-bridge');
mkdirSync(join(wasmPkgDir, 'wasm'), { recursive: true });
cpSync(join(studioRoot, 'bindings', 'wasm', 'src'), join(wasmPkgDir, 'src'), { recursive: true });
cpSync(join(studioRoot, 'bindings', 'wasm', 'ABI.md'), join(wasmPkgDir, 'ABI.md'));
if (existsSync(wasmSrc)) {
  cpSync(wasmSrc, join(wasmPkgDir, 'wasm', 'synlexa_bio_core.wasm'));
}
const origBridgePkg = JSON.parse(readFileSync(join(studioRoot, 'bindings', 'wasm', 'package.json'), 'utf8'));
writeFileSync(
  join(wasmPkgDir, 'package.json'),
  `${JSON.stringify(
    {
      ...origBridgePkg,
      version,
      private: false,
      license: 'Apache-2.0',
      description: 'Deterministic WebAssembly biological & cheminformatics core for Node.js and browsers (RUO).',
      repository: { type: 'git', url: 'https://github.com/Synlexa/synlexa-studio.git' },
      files: ['src/', 'wasm/', 'ABI.md', 'README.md', 'LICENSE', 'NOTICE'],
    },
    null,
    2,
  )}\n`,
);
for (const docFile of ['README.md', 'LICENSE', 'NOTICE']) {
  const p = join(studioRoot, docFile);
  if (existsSync(p)) cpSync(p, join(wasmPkgDir, docFile));
}

console.log(`Assembled npm packages v${version} in ${outRoot}`);
