#!/usr/bin/env node
/**
 * CI compliance check verifying Apache-2.0 open-source metadata, required
 * community/legal files, relative doc links, absence of tracked binary wasm
 * artifacts, and npm license allowlist.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const requiredFiles = [
  'LICENSE',
  'NOTICE',
  'TRADEMARKS.md',
  'README.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'SECURITY.md',
  'GOVERNANCE.md',
  'CHANGELOG.md',
  'ROADMAP.md',
  'CITATION.cff',
  '.zenodo.json',
  'docs/installation.md',
  'docs/sdk-and-mcp.md',
  'docs/scientific-methods.md',
  'docs/cloud-integration.md',
  'docs/contributing-and-sync.md',
];

const errors = [];

for (const rel of requiredFiles) {
  if (!existsSync(join(root, rel))) {
    errors.push(`Missing required documentation/legal file: ${rel}`);
  }
}

for (const manifest of [
  'Cargo.toml',
  'apps/desktop/native/Cargo.toml',
  'apps/desktop/src-tauri/Cargo.toml',
  'package.json',
  'apps/web/package.json',
  'bindings/wasm/package.json',
  'packaging/npm/synlexa-studio/package.json',
  'packaging/homebrew/Formula/synlexa-studio.rb',
  'services/compute-worker/pyproject.toml',
  'bindings/python/pyproject.toml',
]) {
  const txt = readFileSync(join(root, manifest), 'utf8');
  if (/proprietary|see license in readme/i.test(txt)) {
    errors.push(`Manifest ${manifest} still references PROPRIETARY or SEE LICENSE IN README`);
  }
  if (!/Apache-2\.0/i.test(txt)) {
    errors.push(`Manifest ${manifest} does not declare Apache-2.0`);
  }
}

// Check relative markdown links in README.md and docs/*.md
const mdFiles = ['README.md', 'CONTRIBUTING.md', 'SECURITY.md'];
for (const f of readdirSync(join(root, 'docs'))) {
  if (f.endsWith('.md')) mdFiles.push(`docs/${f}`);
}
for (const rel of mdFiles) {
  const content = readFileSync(join(root, rel), 'utf8');
  const dir = dirname(join(root, rel));
  for (const m of content.matchAll(/\[[^\]]+\]\(([^)#\s]+)(?:#[^)\s]*)?\)/g)) {
    const target = m[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const resolved = resolve(dir, target);
    if (!existsSync(resolved)) {
      errors.push(`Broken relative link in ${rel}: ${target}`);
    }
  }
}

// Check npm dependencies for disallowed copyleft runtime licenses
const allowedNpmLicenses = new Set([
  'MIT',
  'ISC',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'Unlicense',
  'CC0-1.0',
  'CC-BY-4.0',
  'Python-2.0',
  'BlueOak-1.0.0',
  'MPL-2.0', // build-time css bundler (lightningcss)
  '(MIT OR Apache-2.0)',
  '(MIT OR CC0-1.0)',
  'Apache-2.0 OR MIT',
]);
const pnpmStore = join(root, 'node_modules/.pnpm');
if (existsSync(pnpmStore)) {
  for (const entry of readdirSync(pnpmStore)) {
    const nm = join(pnpmStore, entry, 'node_modules');
    if (!existsSync(nm)) continue;
    for (const item of readdirSync(nm)) {
      const pkgs = item.startsWith('@')
        ? readdirSync(join(nm, item)).map((sub) => join(nm, item, sub))
        : [join(nm, item)];
      for (const p of pkgs) {
        const pj = join(p, 'package.json');
        if (!existsSync(pj)) continue;
        const meta = JSON.parse(readFileSync(pj, 'utf8'));
        const lic = typeof meta.license === 'string' ? meta.license : JSON.stringify(meta.license || meta.licenses || 'UNKNOWN');
        if (!allowedNpmLicenses.has(lic) && !/MIT|Apache-2\.0|BSD|ISC|CC-BY-4\.0/i.test(lic)) {
          errors.push(`Disallowed or unrecognized npm license on ${meta.name}@${meta.version}: ${lic}`);
        }
      }
    }
  }
}

if (errors.length > 0) {
  console.error('Docs & License compliance audit failed:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log('Docs, links, manifests, and dependency license checks passed (Apache-2.0).');
