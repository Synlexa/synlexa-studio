#!/usr/bin/env node
/**
 * Atomically bumps every manifest, installer, Homebrew recipe, Python SDK,
 * Rust workspace crate, CITATION.cff, and release workflow default to <newVersion>,
 * then runs check-version-sync.mjs to verify consistency.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const next = (process.argv[2] || '').replace(/^v/, '');

if (!/^\d+\.\d+\.\d+$/.test(next)) {
  console.error('Usage: node scripts/bump-version.mjs <major.minor.patch>');
  process.exit(1);
}

function edit(rel, replacer) {
  const full = join(root, rel);
  const src = readFileSync(full, 'utf8');
  const out = replacer(src);
  if (src !== out) {
    writeFileSync(full, out);
  }
}

for (const jsonRel of [
  'package.json',
  'apps/web/package.json',
  'bindings/wasm/package.json',
  'apps/desktop/src-tauri/tauri.conf.json',
]) {
  edit(jsonRel, (s) => {
    const obj = JSON.parse(s);
    obj.version = next;
    return `${JSON.stringify(obj, null, 2)}\n`;
  });
}

edit('packaging/npm/synlexa-studio/package.json', (s) => {
  const obj = JSON.parse(s);
  obj.version = next;
  for (const k of Object.keys(obj.optionalDependencies ?? {})) {
    obj.optionalDependencies[k] = next;
  }
  return `${JSON.stringify(obj, null, 2)}\n`;
});

edit('Cargo.toml', (s) => s.replace(/(^version\s*=\s*)"[^"]+"/m, `$1"${next}"`));
edit('apps/desktop/native/Cargo.toml', (s) => s.replace(/(^version\s*=\s*)"[^"]+"/m, `$1"${next}"`));
edit('apps/desktop/src-tauri/Cargo.toml', (s) => s.replace(/(^version\s*=\s*)"[^"]+"/m, `$1"${next}"`));
edit('services/compute-worker/pyproject.toml', (s) => s.replace(/(^version\s*=\s*)"[^"]+"/m, `$1"${next}"`));
edit('services/compute-worker/synlexa_compute/__init__.py', (s) => s.replace(/(^__version__\s*=\s*)"[^"]+"/m, `$1"${next}"`));
edit('bindings/python/pyproject.toml', (s) => s.replace(/(^version\s*=\s*)"[^"]+"/m, `$1"${next}"`));
edit('bindings/python/synlexa_sdk/__init__.py', (s) => s.replace(/(^__version__\s*=\s*)"[^"]+"/m, `$1"${next}"`));
edit('packaging/install.sh', (s) => s.replace(/(SYNLEXA_VERSION:-)[0-9]+\.[0-9]+\.[0-9]+/, `$1${next}`));
edit('packaging/install.ps1', (s) => s.replace(/(else\s*\{\s*")[0-9]+\.[0-9]+\.[0-9]+("\s*\})/, `$1${next}$2`));
edit('packaging/homebrew/Formula/synlexa-studio.rb', (s) => s.replace(/(^\s*version\s+)"[^"]+"/m, `$1"${next}"`));
edit('packaging/homebrew/Casks/synlexa-studio.rb', (s) => s.replace(/(^\s*version\s+)"[^"]+"/m, `$1"${next}"`));
edit('CITATION.cff', (s) => s.replace(/(^version:\s*)"[^"]+"/m, `$1"${next}"`));
edit('.github/workflows/release.yml', (s) =>
  s
    .replace(/(description:\s*"Release version tag \(e\.g\. )[0-9]+\.[0-9]+\.[0-9]+("\))/, `$1${next}$2`)
    .replace(/(default:\s*")[0-9]+\.[0-9]+\.[0-9]+(")/g, `$1${next}$2`)
    .replace(/(inputs\.version\s*\|\|\s*')[0-9]+\.[0-9]+\.[0-9]+(')/g, `$1${next}$2`),
);

// Refresh Cargo.lock files if cargo is installed
try {
  execFileSync('cargo', ['generate-lockfile'], { cwd: root, stdio: 'inherit' });
  execFileSync('cargo', ['generate-lockfile', '--manifest-path', 'apps/desktop/native/Cargo.toml'], {
    cwd: root,
    stdio: 'inherit',
  });
} catch {
  console.warn('Warning: Could not refresh Cargo.lock (cargo unavailable).');
}

execFileSync('node', [join(root, 'scripts/check-version-sync.mjs')], { cwd: root, stdio: 'inherit' });
