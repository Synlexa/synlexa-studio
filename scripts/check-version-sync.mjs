#!/usr/bin/env node
/**
 * Verifies that every workspace manifest, Rust crate, Python package, installer,
 * Homebrew recipe, CI default, and CITATION.cff share the exact same release version.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function read(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

const rootPkg = JSON.parse(read('package.json'));
const expected = rootPkg.version;
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(expected)) {
  console.error(`Invalid root package.json version: ${expected}`);
  process.exit(1);
}

const checks = [];

function checkExact(label, actual) {
  checks.push({ label, actual, ok: actual === expected });
}

function matchGroup(rel, regex) {
  const m = read(rel).match(regex);
  return m ? m[1] : '<missing>';
}

checkExact('apps/web/package.json', JSON.parse(read('apps/web/package.json')).version);
checkExact('bindings/wasm/package.json', JSON.parse(read('bindings/wasm/package.json')).version);

const npmLauncher = JSON.parse(read('packaging/npm/synlexa-studio/package.json'));
checkExact('packaging/npm/synlexa-studio/package.json', npmLauncher.version);
for (const [depName, depVer] of Object.entries(npmLauncher.optionalDependencies ?? {})) {
  checkExact(`packaging/npm optionalDependencies[${depName}]`, depVer);
}

checkExact('Cargo.toml [workspace.package]', matchGroup('Cargo.toml', /\[workspace\.package\][\s\S]*?^version\s*=\s*"([^"]+)"/m));
checkExact('apps/desktop/native/Cargo.toml', matchGroup('apps/desktop/native/Cargo.toml', /^version\s*=\s*"([^"]+)"/m));
checkExact('apps/desktop/src-tauri/Cargo.toml', matchGroup('apps/desktop/src-tauri/Cargo.toml', /^version\s*=\s*"([^"]+)"/m));
checkExact('apps/desktop/src-tauri/tauri.conf.json', JSON.parse(read('apps/desktop/src-tauri/tauri.conf.json')).version);

checkExact('services/compute-worker/pyproject.toml', matchGroup('services/compute-worker/pyproject.toml', /^version\s*=\s*"([^"]+)"/m));
checkExact('services/compute-worker/__init__.py', matchGroup('services/compute-worker/synlexa_compute/__init__.py', /^__version__\s*=\s*"([^"]+)"/m));

checkExact('bindings/python/pyproject.toml', matchGroup('bindings/python/pyproject.toml', /^version\s*=\s*"([^"]+)"/m));
checkExact('bindings/python/synlexa_sdk/__init__.py', matchGroup('bindings/python/synlexa_sdk/__init__.py', /^__version__\s*=\s*"([^"]+)"/m));

checkExact('packaging/install.sh', matchGroup('packaging/install.sh', /SYNLEXA_VERSION:-([0-9]+\.[0-9]+\.[0-9]+)/));
checkExact('packaging/install.ps1', matchGroup('packaging/install.ps1', /else\s*\{\s*"([^"]+)"\s*\}/));
checkExact('packaging/homebrew/Formula/synlexa-studio.rb', matchGroup('packaging/homebrew/Formula/synlexa-studio.rb', /^\s*version\s+"([^"]+)"/m));
checkExact('packaging/homebrew/Casks/synlexa-studio.rb', matchGroup('packaging/homebrew/Casks/synlexa-studio.rb', /^\s*version\s+"([^"]+)"/m));
checkExact('packaging/npm/synlexa-studio/README.md', matchGroup('packaging/npm/synlexa-studio/README.md', /synlexa-studio-([0-9]+\.[0-9]+\.[0-9]+)\.tgz/));
checkExact('bindings/wasm/README.md', matchGroup('bindings/wasm/README.md', /synlexa-wasm-bridge-([0-9]+\.[0-9]+\.[0-9]+)\.tgz/));
checkExact('CITATION.cff', matchGroup('CITATION.cff', /^version:\s*"([^"]+)"/m));

const releaseYml = read('.github/workflows/release.yml');
const releaseMatches = [...releaseYml.matchAll(/(?:default:\s*"|inputs\.version\s*\|\|\s*')([0-9]+\.[0-9]+\.[0-9]+)/g)];
for (let i = 0; i < releaseMatches.length; i++) {
  checkExact(`.github/workflows/release.yml default #${i + 1}`, releaseMatches[i][1]);
}

const failures = checks.filter((c) => !c.ok);
if (failures.length > 0) {
  console.error(`Version drift detected (expected ${expected}):`);
  for (const f of failures) {
    console.error(`  - ${f.label}: found ${f.actual}`);
  }
  process.exit(1);
}

console.log(`All ${checks.length + 1} versioned files are synchronized at ${expected}.`);
