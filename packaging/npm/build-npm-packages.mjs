#!/usr/bin/env node
/**
 * Assembles publishable npm package directories under dist/npm/:
 *   - dist/npm/synlexa-studio/ (@synlexa/studio launcher + bundled wasm + web-dist + desktop icons)
 *   - dist/npm/wasm-bridge/    (@synlexa/wasm-bridge compiled JS/TS + .wasm)
 *   - dist/npm/studio-<plat>/  (@synlexa/studio-<plat> native binaries when --platform-bins-dir is provided)
 */
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

const platformBinsDir = getFlag('--platform-bins-dir');
const webDistSrc = getFlag('--web-dist') || join(studioRoot, 'apps', 'web', 'dist');
const wasmSrc = getFlag('--wasm') || join(studioRoot, 'apps', 'web', 'public', 'wasm', 'synlexa_bio_core.wasm');

rmSync(outRoot, { recursive: true, force: true });
mkdirSync(outRoot, { recursive: true });

// 1. @synlexa/studio CLI/App/MCP npm package
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

// 3. Optional native binary packages (@synlexa/studio-<os>-<arch>)
const PLATFORM_TARGETS = [
  { key: 'darwin-arm64', pkgName: '@synlexa/studio-darwin-arm64', os: 'darwin', cpu: 'arm64', ext: '' },
  { key: 'darwin-x64', pkgName: '@synlexa/studio-darwin-x64', os: 'darwin', cpu: 'x64', ext: '' },
  { key: 'linux-x64-gnu', pkgName: '@synlexa/studio-linux-x64-gnu', os: 'linux', cpu: 'x64', ext: '' },
  { key: 'linux-arm64-gnu', pkgName: '@synlexa/studio-linux-arm64-gnu', os: 'linux', cpu: 'arm64', ext: '' },
  { key: 'win32-x64-msvc', pkgName: '@synlexa/studio-win32-x64-msvc', os: 'win32', cpu: 'x64', ext: '.exe' },
  { key: 'win32-arm64-msvc', pkgName: '@synlexa/studio-win32-arm64-msvc', os: 'win32', cpu: 'arm64', ext: '.exe' },
];

const assembledPlatforms = [];
if (platformBinsDir && existsSync(platformBinsDir)) {
  for (const target of PLATFORM_TARGETS) {
    const srcDir = join(platformBinsDir, target.key);
    if (!existsSync(srcDir)) continue;
    const cliBin = join(srcDir, `studio-cli${target.ext}`);
    const hostBin = join(srcDir, `synlexa-studio-desktop-native${target.ext}`);
    if (!existsSync(cliBin) || !existsSync(hostBin)) {
      throw new Error(`Missing native binaries in ${srcDir} (expected studio-cli${target.ext} and synlexa-studio-desktop-native${target.ext})`);
    }
    const pkgDir = join(outRoot, `studio-${target.key}`);
    const binOut = join(pkgDir, 'bin');
    mkdirSync(binOut, { recursive: true });
    for (const [src, name] of [
      [cliBin, `studio-cli${target.ext}`],
      [hostBin, `synlexa-studio-desktop-native${target.ext}`],
    ]) {
      const dst = join(binOut, name);
      cpSync(src, dst);
      if (!target.ext) chmodSync(dst, 0o755);
    }
    for (const docFile of ['README.md', 'LICENSE', 'NOTICE']) {
      const p = join(studioRoot, docFile);
      if (existsSync(p)) cpSync(p, join(pkgDir, docFile));
    }
    writeFileSync(
      join(pkgDir, 'package.json'),
      `${JSON.stringify(
        {
          name: target.pkgName,
          version,
          description: `Native desktop host and CLI binaries (${target.key}) for @synlexa/studio (Research-Use-Only).`,
          license: 'Apache-2.0',
          repository: { type: 'git', url: 'https://github.com/Synlexa/synlexa-studio.git' },
          homepage: 'https://www.synlexa.com/download',
          os: [target.os],
          cpu: [target.cpu],
          files: ['bin/', 'README.md', 'LICENSE', 'NOTICE'],
        },
        null,
        2,
      )}\n`,
    );
    assembledPlatforms.push(target.pkgName);
  }
}

console.log(
  `Assembled npm packages v${version} in ${outRoot} (platforms: ${assembledPlatforms.length > 0 ? assembledPlatforms.join(', ') : 'none'})`,
);
