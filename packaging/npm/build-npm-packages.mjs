#!/usr/bin/env node
/**
 * Assembles the two publishable npm packages under dist/npm/:
 *   - dist/npm/synlexa-studio/ (@synlexa/studio cross-platform app + desktop icon + wasm + web-dist)
 *   - dist/npm/wasm-bridge/    (@synlexa/wasm-bridge JS/TS WebAssembly SDK + .wasm)
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const studioRoot = resolve(__dirname, '../..');
const outRoot = join(studioRoot, 'dist', 'npm');

function getFlag(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return resolve(process.argv[idx + 1]);
  return null;
}

const webDistSrc = getFlag('--web-dist') || join(studioRoot, 'apps', 'web', 'dist');
const wasmSrc = getFlag('--wasm') || join(studioRoot, 'apps', 'web', 'public', 'wasm', 'synlexa_bio_core.wasm');

rmSync(outRoot, { recursive: true, force: true });
mkdirSync(outRoot, { recursive: true });

// 1. @synlexa/studio (All-in-one Desktop App + CLI + MCP + Desktop Icon)
const mainPkgDir = join(outRoot, 'synlexa-studio');
cpSync(join(__dirname, 'synlexa-studio'), mainPkgDir, { recursive: true });
const launcherMeta = JSON.parse(readFileSync(join(mainPkgDir, 'package.json'), 'utf8'));
const version = launcherMeta.version;

mkdirSync(join(mainPkgDir, 'wasm'), { recursive: true });
mkdirSync(join(mainPkgDir, 'assets'), { recursive: true });

if (existsSync(wasmSrc)) {
  cpSync(wasmSrc, join(mainPkgDir, 'wasm', 'synlexa_bio_core.wasm'));
}
if (existsSync(webDistSrc)) {
  cpSync(webDistSrc, join(mainPkgDir, 'web-dist'), { recursive: true });
}

const iconDir = join(studioRoot, 'apps', 'desktop', 'src-tauri', 'icons');
for (const [srcName, dstName] of [
  ['icon.icns', 'icon.icns'],
  ['icon.ico', 'icon.ico'],
  ['icon.png', 'icon.png'],
  ['128x128@2x.png', 'icon-256.png'],
]) {
  const iconPath = join(iconDir, srcName);
  if (existsSync(iconPath)) {
    cpSync(iconPath, join(mainPkgDir, 'assets', dstName));
  }
}

for (const docFile of ['LICENSE', 'NOTICE']) {
  const p = join(studioRoot, docFile);
  if (existsSync(p)) cpSync(p, join(mainPkgDir, docFile));
}

// 2. @synlexa/wasm-bridge (Developer WebAssembly SDK)
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
      description: 'For JS/TS Developers: WebAssembly biological & cheminformatics SDK for Node.js and browsers (not the desktop app; Research-Use-Only).',
      repository: { type: 'git', url: 'git+https://github.com/Synlexa/synlexa-studio.git' },
      homepage: 'https://www.synlexa.com/docs',
      files: ['src/', 'wasm/', 'ABI.md', 'README.md', 'LICENSE', 'NOTICE'],
    },
    null,
    2,
  )}\n`,
);
const wasmReadme = join(studioRoot, 'bindings', 'wasm', 'README.md');
if (existsSync(wasmReadme)) cpSync(wasmReadme, join(wasmPkgDir, 'README.md'));
for (const docFile of ['LICENSE', 'NOTICE']) {
  const p = join(studioRoot, docFile);
  if (existsSync(p)) cpSync(p, join(wasmPkgDir, docFile));
}

console.log(`Assembled npm packages v${version} in ${outRoot} (@synlexa/studio, @synlexa/wasm-bridge)`);
