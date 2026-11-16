#!/usr/bin/env node
/**
 * Smoke test for npm package assembly, CLI flags, and sandboxed Desktop shortcut creation.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../..');
const rootVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

const tmpRoot = mkdtempSync(join(tmpdir(), 'synlexa-npm-test-'));
try {
  const binsDir = join(tmpRoot, 'platform-bins');
  for (const [key, ext] of [
    ['darwin-arm64', ''],
    ['darwin-x64', ''],
    ['linux-x64-gnu', ''],
    ['linux-arm64-gnu', ''],
    ['win32-x64-msvc', '.exe'],
    ['win32-arm64-msvc', '.exe'],
  ]) {
    const dir = join(binsDir, key);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `studio-cli${ext}`), '#!/bin/sh\necho mock\n', 'utf8');
    writeFileSync(join(dir, `synlexa-studio-desktop-native${ext}`), '#!/bin/sh\necho mock\n', 'utf8');
  }

  // Ensure web-dist fallback exists for assembly test even if web build wasn't run locally
  const webDist = join(tmpRoot, 'web-dist');
  mkdirSync(webDist, { recursive: true });
  writeFileSync(join(webDist, 'index.html'), '<!doctype html><html><body>Synlexa Studio</body></html>\n');

  execFileSync(
    process.execPath,
    [
      join(root, 'packaging/npm/build-npm-packages.mjs'),
      '--platform-bins-dir',
      binsDir,
      '--web-dist',
      webDist,
    ],
    { cwd: root, stdio: 'pipe' },
  );

  const mainPkg = JSON.parse(readFileSync(join(root, 'dist/npm/synlexa-studio/package.json'), 'utf8'));
  assert.equal(mainPkg.name, '@synlexa/studio');
  assert.equal(mainPkg.version, rootVersion);
  assert.ok(existsSync(join(root, 'dist/npm/synlexa-studio/assets/icon.icns')));
  assert.ok(existsSync(join(root, 'dist/npm/synlexa-studio/assets/icon.ico')));
  assert.ok(existsSync(join(root, 'dist/npm/synlexa-studio/assets/icon.png')));

  for (const dirName of [
    'studio-darwin-arm64',
    'studio-darwin-x64',
    'studio-linux-x64-gnu',
    'studio-linux-arm64-gnu',
    'studio-win32-x64-msvc',
    'studio-win32-arm64-msvc',
    'wasm-bridge',
    'synlexa-studio',
  ]) {
    const pkgJson = JSON.parse(readFileSync(join(root, 'dist/npm', dirName, 'package.json'), 'utf8'));
    assert.ok(pkgJson.name.startsWith('@synlexa/'), `${dirName} must be scoped under @synlexa/`);
    assert.equal(pkgJson.version, rootVersion);
    assert.equal(pkgJson.license, 'Apache-2.0');
  }

  const cliEntry = join(root, 'dist/npm/synlexa-studio/bin/synlexa-studio.mjs');
  assert.equal(execFileSync(process.execPath, [cliEntry, '--version'], { encoding: 'utf8' }).trim(), rootVersion);
  assert.equal(execFileSync(process.execPath, [cliEntry, '-V'], { encoding: 'utf8' }).trim(), rootVersion);
  const helpOut = execFileSync(process.execPath, [cliEntry, '-psn_0_1234', '--help'], { encoding: 'utf8' });
  assert.match(helpOut, /install-desktop/);

  // Test sandboxed Desktop + App launcher shortcut creation and cleanup on macOS/Linux
  if (process.platform === 'darwin' || process.platform === 'linux') {
    const fakeHome = join(tmpRoot, 'fake-home');
    const fakeDesktop = join(fakeHome, 'Desktop');
    mkdirSync(fakeDesktop, { recursive: true });
    const sandboxEnv = {
      ...process.env,
      HOME: fakeHome,
      XDG_DATA_HOME: join(fakeHome, '.local', 'share'),
      SYNLEXA_DESKTOP_DIR: fakeDesktop,
      CI: '',
      GITHUB_ACTIONS: '',
    };

    execFileSync(process.execPath, [cliEntry, 'install-desktop'], { env: sandboxEnv, stdio: 'pipe' });

    if (process.platform === 'darwin') {
      const appPath = join(fakeHome, 'Applications', 'Synlexa Studio.app');
      const desktopLink = join(fakeDesktop, 'Synlexa Studio.app');
      assert.ok(existsSync(join(appPath, 'Contents', 'Info.plist')));
      assert.ok(existsSync(join(appPath, 'Contents', 'Resources', 'icon.icns')));
      assert.ok(lstatSync(desktopLink).isSymbolicLink());
    } else if (process.platform === 'linux') {
      const appDesktop = join(fakeHome, '.local', 'share', 'applications', 'synlexa-studio.desktop');
      const desktopShortcut = join(fakeDesktop, 'synlexa-studio.desktop');
      assert.ok(existsSync(appDesktop));
      assert.ok(existsSync(desktopShortcut));
      assert.match(readFileSync(desktopShortcut, 'utf8'), /Name=Synlexa Studio/);
    }

    execFileSync(process.execPath, [cliEntry, 'uninstall-desktop'], { env: sandboxEnv, stdio: 'pipe' });
    if (process.platform === 'darwin') {
      assert.ok(!existsSync(join(fakeHome, 'Applications', 'Synlexa Studio.app')));
      assert.ok(!existsSync(join(fakeDesktop, 'Synlexa Studio.app')));
    } else {
      assert.ok(!existsSync(join(fakeDesktop, 'synlexa-studio.desktop')));
    }
  }

  console.log(`npm packaging & desktop icon smoke tests passed (v${rootVersion}).`);
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
  // Restore standard build-npm-packages output without mock platform binaries
  execFileSync(process.execPath, [join(root, 'packaging/npm/build-npm-packages.mjs')], { cwd: root, stdio: 'pipe' });
}
