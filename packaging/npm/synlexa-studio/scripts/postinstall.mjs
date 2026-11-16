import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { findNativeBinary, installDesktopShortcut, PKG_ROOT, readPackageMeta } from './desktop-shortcut.mjs';

const hasWasm = existsSync(join(PKG_ROOT, 'wasm', 'synlexa_bio_core.wasm'));
if (!hasWasm) {
  console.log('[synlexa-studio] Installed launcher (native runtime or Wasm core will be resolved at runtime).');
}

function getRuntimeArchiveName(version) {
  const key = `${process.platform}-${process.arch}`;
  if (process.platform === 'darwin') return `synlexa-studio-v${version}-universal-apple-darwin.tar.gz`;
  if (key === 'linux-x64') return `synlexa-studio-v${version}-x86_64-unknown-linux-gnu.tar.gz`;
  if (key === 'linux-arm64') return `synlexa-studio-v${version}-aarch64-unknown-linux-gnu.tar.gz`;
  if (key === 'win32-x64') return `Synlexa-Studio-v${version}-windows-x64.zip`;
  if (key === 'win32-arm64') return `Synlexa-Studio-v${version}-windows-arm64.zip`;
  return null;
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFirstAvailable(urls, timeoutMs) {
  let lastErr = null;
  for (const url of urls) {
    try {
      return await fetchWithTimeout(url, timeoutMs);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Download failed');
}

async function ensureVerifiedNativeRuntime(version) {
  const archiveName = getRuntimeArchiveName(version);
  if (!archiveName) return false;

  const home = process.env.HOME || process.env.USERPROFILE || homedir();
  const installDir = process.env.SYNLEXA_INSTALL_DIR || join(home, '.synlexa-studio', 'runtime');
  const versionStampPath = join(installDir, '.version');
  const existingHost = findNativeBinary('synlexa-studio-desktop-native');

  if (existingHost && existsSync(versionStampPath) && readFileSync(versionStampPath, 'utf8').trim() === version) {
    return true;
  }

  const primaryBase =
    process.env.SYNLEXA_RELEASES_BASE || `https://github.com/Synlexa/synlexa-studio/releases/download/v${version}`;
  const mirrorBase = 'https://studio.synlexa.com/releases';

  const sumsBytes = await fetchFirstAvailable(
    [`${primaryBase}/SHA256SUMS.txt`, `${mirrorBase}/SHA256SUMS.txt`],
    15000,
  );
  const sumsText = Buffer.from(sumsBytes).toString('utf8');
  let expectedSha = null;
  for (const line of sumsText.split(/\r?\n/)) {
    const m = line.trim().match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
    if (m && m[2].trim() === archiveName) {
      expectedSha = m[1].toLowerCase();
      break;
    }
  }
  if (!expectedSha) {
    throw new Error(`Checksum for ${archiveName} not found in SHA256SUMS.txt`);
  }

  const archiveBytes = await fetchFirstAvailable(
    [`${primaryBase}/${archiveName}`, `${mirrorBase}/${archiveName}`],
    60000,
  );
  const actualSha = createHash('sha256').update(archiveBytes).digest('hex').toLowerCase();
  if (actualSha !== expectedSha) {
    throw new Error(`SHA-256 verification failed for ${archiveName}`);
  }

  const tmpDir = mkdtempSync(join(tmpdir(), 'synlexa-runtime-'));
  try {
    const archivePath = join(tmpDir, archiveName);
    writeFileSync(archivePath, archiveBytes);

    rmSync(join(installDir, 'bin'), { recursive: true, force: true });
    rmSync(join(installDir, 'web-dist'), { recursive: true, force: true });
    mkdirSync(installDir, { recursive: true });

    if (archiveName.endsWith('.zip')) {
      const res = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          'Unblock-File -Path $env:SYNLEXA_ARCHIVE -ErrorAction SilentlyContinue; Expand-Archive -Path $env:SYNLEXA_ARCHIVE -DestinationPath $env:SYNLEXA_DEST -Force; Get-ChildItem -Path (Join-Path $env:SYNLEXA_DEST "bin") -Filter "*.exe" -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue',
        ],
        {
          stdio: 'pipe',
          env: { ...process.env, SYNLEXA_ARCHIVE: archivePath, SYNLEXA_DEST: installDir },
        },
      );
      if (res.status !== 0) {
        throw new Error(res.stderr?.toString() || 'Failed to extract Windows runtime archive');
      }
    } else {
      const res = spawnSync('tar', ['-xzf', archivePath, '-C', installDir], { stdio: 'pipe' });
      if (res.status !== 0) {
        throw new Error(res.stderr?.toString() || 'Failed to extract runtime archive');
      }
      const binDir = join(installDir, 'bin');
      if (existsSync(binDir)) {
        for (const item of readdirSync(binDir)) {
          chmodSync(join(binDir, item), 0o755);
        }
      }
      if (process.platform === 'darwin') {
        spawnSync('xattr', ['-cr', installDir], { stdio: 'ignore' });
        if (existsSync(binDir)) {
          for (const item of readdirSync(binDir)) {
            spawnSync('codesign', ['--force', '--sign', '-', join(binDir, item)], { stdio: 'ignore' });
          }
        }
      }
    }

    writeFileSync(versionStampPath, `${version}\n`, 'utf8');
    return true;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

const isCi = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
const optOut = process.env.SYNLEXA_NO_DESKTOP_ICON === '1';
const isGlobalInstall = process.env.npm_config_global === 'true' || process.env.SYNLEXA_DESKTOP_ICON === '1';

if (!isCi && !optOut && isGlobalInstall) {
  const meta = readPackageMeta();
  const version = meta.version || '0.4.3';

  if (process.env.SYNLEXA_SKIP_RUNTIME_DOWNLOAD !== '1') {
    try {
      const ok = await ensureVerifiedNativeRuntime(version);
      if (ok) {
        console.log(`[synlexa-studio] Verified native desktop runtime v${version}.`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[synlexa-studio] Native runtime download skipped (${msg}); using bundled Wasm/Web runtime.`);
    }
  }

  try {
    const installed = installDesktopShortcut();
    if (installed.length > 0) {
      console.log(`[synlexa-studio] Added Synlexa Studio launcher icon: ${installed.join(', ')}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[synlexa-studio] Desktop shortcut setup skipped (${msg}). Run "synlexa-studio install-desktop" later to create it.`);
  }
}
