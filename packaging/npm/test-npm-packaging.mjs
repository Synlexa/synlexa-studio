#!/usr/bin/env node
/**
 * Smoke test for @synlexa/studio & @synlexa/wasm-bridge assembly, CLI flags,
 * package README clarity, and sandboxed Desktop shortcut creation.
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
  // Ensure web-dist fallback exists for assembly test even if web build wasn't run locally
  const webDist = join(tmpRoot, 'web-dist');
  mkdirSync(webDist, { recursive: true });
  writeFileSync(join(webDist, 'index.html'), '<!doctype html><html><body>Synlexa Studio</body></html>\n');

  execFileSync(
    process.execPath,
    [join(root, 'packaging/npm/build-npm-packages.mjs'), '--web-dist', webDist],
    { cwd: root, stdio: 'pipe' },
  );

  const mainPkg = JSON.parse(readFileSync(join(root, 'dist/npm/synlexa-studio/package.json'), 'utf8'));
  assert.equal(mainPkg.name, '@synlexa/studio');
  assert.equal(mainPkg.version, rootVersion);
  assert.equal(mainPkg.optionalDependencies, undefined);
  assert.match(mainPkg.description, /macOS/i);
  assert.ok(existsSync(join(root, 'dist/npm/synlexa-studio/assets/icon.icns')));
  assert.ok(existsSync(join(root, 'dist/npm/synlexa-studio/assets/icon.ico')));
  assert.ok(existsSync(join(root, 'dist/npm/synlexa-studio/assets/icon.png')));

  const studioReadme = readFileSync(join(root, 'dist/npm/synlexa-studio/README.md'), 'utf8');
  assert.match(studioReadme, /macOS \(Apple Silicon M1–M4 & Intel\)/);
  assert.match(studioReadme, new RegExp(`v${rootVersion}`));

  const bridgePkg = JSON.parse(readFileSync(join(root, 'dist/npm/wasm-bridge/package.json'), 'utf8'));
  assert.equal(bridgePkg.name, '@synlexa/wasm-bridge');
  assert.equal(bridgePkg.version, rootVersion);
  assert.equal(bridgePkg.license, 'Apache-2.0');
  const bridgeReadme = readFileSync(join(root, 'dist/npm/wasm-bridge/README.md'), 'utf8');
  assert.match(bridgeReadme, /Developer WebAssembly SDK/);

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
      SYNLEXA_SKIP_RUNTIME_DOWNLOAD: '1',
      CI: '',
      GITHUB_ACTIONS: '',
    };

    execFileSync(process.execPath, [cliEntry, 'install-desktop'], { env: sandboxEnv, stdio: 'pipe' });
    assert.ok(existsSync(join(fakeHome, '.synlexa-studio', `.desktop-setup-v${rootVersion}`)));

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
    assert.ok(!existsSync(join(fakeHome, '.synlexa-studio', `.desktop-setup-v${rootVersion}`)));

    // Verify npm v12+ first-launch setup runs automatically when postinstall was skipped
    const shortcutMod = await import(join(root, 'dist/npm/synlexa-studio/scripts/desktop-shortcut.mjs'));
    const savedEnv = { ...process.env };
    Object.assign(process.env, sandboxEnv);
    try {
      const firstRunCreated = await shortcutMod.ensureStudioDesktopSetup({ force: false, quiet: true });
      assert.ok(firstRunCreated.length > 0);
      assert.ok(existsSync(join(fakeHome, '.synlexa-studio', `.desktop-setup-v${rootVersion}`)));
      const secondRunCreated = await shortcutMod.ensureStudioDesktopSetup({ force: false, quiet: true });
      assert.equal(secondRunCreated.length, 0);
    } finally {
      process.env = savedEnv;
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
  execFileSync(process.execPath, [join(root, 'packaging/npm/build-npm-packages.mjs')], { cwd: root, stdio: 'pipe' });
}
