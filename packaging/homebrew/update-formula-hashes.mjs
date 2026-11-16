#!/usr/bin/env node
/**
 * Updates version + SHA-256 digests in packaging/homebrew/Formula/synlexa-studio.rb
 * and packaging/homebrew/Casks/synlexa-studio.rb from a release artifacts directory.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [, , versionArg, artifactsDirArg] = process.argv;
if (!versionArg || !artifactsDirArg) {
  console.error('Usage: node update-formula-hashes.mjs <version> <artifacts-dir>');
  process.exit(1);
}

const version = versionArg.replace(/^v/, '');
const artifactsDir = resolve(artifactsDirArg);

function sha256Of(filename) {
  const full = join(artifactsDir, filename);
  if (!existsSync(full)) return null;
  return createHash('sha256').update(readFileSync(full)).digest('hex');
}

const macSha = sha256Of(`synlexa-studio-v${version}-universal-apple-darwin.tar.gz`);
const linuxX64Sha = sha256Of(`synlexa-studio-v${version}-x86_64-unknown-linux-gnu.tar.gz`);
const linuxArmSha = sha256Of(`synlexa-studio-v${version}-aarch64-unknown-linux-gnu.tar.gz`);
const dmgSha = sha256Of(`Synlexa-Studio-v${version}-universal-apple-darwin.dmg`);

const formulaPath = resolve(import.meta.dirname, 'Formula/synlexa-studio.rb');
let formula = readFileSync(formulaPath, 'utf8');
formula = formula.replace(/version "[^"]+"/, `version "${version}"`);
const hashes = [macSha, linuxX64Sha, linuxArmSha];
let idx = 0;
formula = formula.replace(/sha256 "[^"]+"/g, (match) => {
  const next = hashes[idx++];
  return next ? `sha256 "${next}"` : match;
});
writeFileSync(formulaPath, formula);

const caskPath = resolve(import.meta.dirname, 'Casks/synlexa-studio.rb');
let cask = readFileSync(caskPath, 'utf8');
cask = cask.replace(/version "[^"]+"/, `version "${version}"`);
if (dmgSha) {
  cask = cask.replace(/sha256 (?::no_check|"[^"]+")/, `sha256 "${dmgSha}"`);
}
writeFileSync(caskPath, cask);

console.log('Updated Homebrew Formula & Cask for version', version);
