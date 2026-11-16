import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  accessSync,
  chmodSync,
  constants,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir, tmpdir, userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PKG_ROOT = resolve(__dirname, '..');

export const PLATFORM_MAP = {
  'darwin-arm64': '@synlexa/studio-darwin-arm64',
  'darwin-x64': '@synlexa/studio-darwin-x64',
  'linux-x64': '@synlexa/studio-linux-x64-gnu',
  'linux-arm64': '@synlexa/studio-linux-arm64-gnu',
  'win32-x64': '@synlexa/studio-win32-x64-msvc',
  'win32-arm64': '@synlexa/studio-win32-arm64-msvc',
};

const require = createRequire(import.meta.url);

export function readPackageMeta() {
  return JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8'));
}

export function findNativeBinary(name, pkgRoot = PKG_ROOT) {
  const pkgName = PLATFORM_MAP[`${process.platform}-${process.arch}`];
  const ext = process.platform === 'win32' ? '.exe' : '';
  const names =
    process.platform === 'win32' && name === 'synlexa-studio-desktop-native'
      ? ['synlexa-studio-desktop-native.exe', 'synlexa-studio.exe']
      : [`${name}${ext}`];

  if (pkgName) {
    try {
      const pkgJsonPath = require.resolve(`${pkgName}/package.json`);
      for (const binName of names) {
        const candidate = join(dirname(pkgJsonPath), 'bin', binName);
        if (existsSync(candidate)) return candidate;
      }
    } catch {
      // Optional native package not installed; try local/home runtime fallbacks
    }
  }
  for (const binName of names) {
    const localCandidate = join(pkgRoot, 'bin', binName);
    if (existsSync(localCandidate)) return localCandidate;
  }

  const home = process.env.HOME || process.env.USERPROFILE || '';
  const runtimeDir = process.env.SYNLEXA_INSTALL_DIR || (home ? join(home, '.synlexa-studio', 'runtime') : '');
  if (runtimeDir) {
    for (const binName of names) {
      const homeCandidate = join(runtimeDir, 'bin', binName);
      if (existsSync(homeCandidate)) return homeCandidate;
    }
  }
  return null;
}

function isWritableDir(dir) {
  try {
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function escapeShDoubleQuoted(value) {
  return value.replace(/(["\\$`])/g, '\\$1');
}

function quoteDesktopExecArg(value) {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value;
  return `"${value.replace(/(["\\$`])/g, '\\$1')}"`;
}

function buildInfoPlist(version, executableName) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Synlexa Studio</string>
  <key>CFBundleDisplayName</key><string>Synlexa Studio</string>
  <key>CFBundleIdentifier</key><string>com.synlexa.studio</string>
  <key>CFBundleVersion</key><string>${version}</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>${executableName}</string>
  <key>CFBundleIconFile</key><string>icon.icns</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLName</key><string>com.synlexa.studio.auth</string>
      <key>CFBundleURLSchemes</key><array><string>synlexa-studio</string></array>
    </dict>
  </array>
</dict>
</plist>
`;
}

function installMacosDesktopShortcut({ version, nativeHost, nativeCli, distDir, cliEntry, nodeExe }) {
  const home = process.env.HOME || homedir();
  let realHome = home;
  try {
    realHome = userInfo().homedir || home;
  } catch {
    // fallback if passwd entry unavailable
  }
  const useSystemApps = !process.env.SYNLEXA_APP_DIR && home === realHome && isWritableDir('/Applications');
  const appParent = process.env.SYNLEXA_APP_DIR || (useSystemApps ? '/Applications' : join(home, 'Applications'));
  mkdirSync(appParent, { recursive: true });

  const appBundle = join(appParent, 'Synlexa Studio.app');
  const contentsDir = join(appBundle, 'Contents');
  const macosDir = join(contentsDir, 'MacOS');
  const resourcesDir = join(contentsDir, 'Resources');

  rmSync(appBundle, { recursive: true, force: true });
  mkdirSync(macosDir, { recursive: true });
  mkdirSync(resourcesDir, { recursive: true });

  const iconSrc = join(PKG_ROOT, 'assets', 'icon.icns');
  if (existsSync(iconSrc)) {
    cpSync(iconSrc, join(resourcesDir, 'icon.icns'));
  }

  let executableName = 'synlexa-studio-launcher';
  if (nativeHost && existsSync(distDir)) {
    executableName = 'synlexa-studio-desktop-native';
    const destHost = join(macosDir, executableName);
    cpSync(nativeHost, destHost);
    chmodSync(destHost, 0o755);
    if (nativeCli && existsSync(nativeCli)) {
      const destCli = join(macosDir, 'studio-cli');
      cpSync(nativeCli, destCli);
      chmodSync(destCli, 0o755);
    }
    cpSync(distDir, join(resourcesDir, 'web-dist'), { recursive: true });
  } else {
    const launcherPath = join(macosDir, executableName);
    const script = `#!/usr/bin/env sh
set -eu
PORT="\${SYNLEXA_PORT:-4179}"
URL="http://127.0.0.1:\${PORT}/"
NODE_BIN="${escapeShDoubleQuoted(nodeExe)}"
CLI_BIN="${escapeShDoubleQuoted(cliEntry)}"
LOG_FILE="\${HOME:-/tmp}/.synlexa-studio/launcher.log"
mkdir -p "$(dirname "$LOG_FILE")"
if ! curl -fsS --max-time 1 "$URL" >/dev/null 2>&1; then
  nohup "$NODE_BIN" "$CLI_BIN" launch --port "$PORT" --no-open >"$LOG_FILE" 2>&1 &
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS --max-time 1 "$URL" >/dev/null 2>&1; then
      break
    fi
    sleep 0.2
  done
fi
if [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --app="$URL" >/dev/null 2>&1 &
else
  open "$URL"
fi
`;
    writeFileSync(launcherPath, script, 'utf8');
    chmodSync(launcherPath, 0o755);
  }

  writeFileSync(join(contentsDir, 'Info.plist'), buildInfoPlist(version, executableName), 'utf8');

  spawnSync('xattr', ['-cr', appBundle], { stdio: 'ignore' });
  spawnSync('codesign', ['--force', '--deep', '--sign', '-', appBundle], { stdio: 'ignore' });
  spawnSync(
    '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',
    ['-f', appBundle],
    { stdio: 'ignore' },
  );

  const created = [appBundle];
  const desktopDir = process.env.SYNLEXA_DESKTOP_DIR || join(home, 'Desktop');
  if (existsSync(desktopDir) && isWritableDir(desktopDir)) {
    const desktopLink = join(desktopDir, 'Synlexa Studio.app');
    let canWriteLink = true;
    try {
      const st = lstatSync(desktopLink);
      if (st.isSymbolicLink() || st.isFile()) {
        rmSync(desktopLink, { force: true });
      } else {
        canWriteLink = false;
      }
    } catch {
      // Does not exist yet
    }
    if (canWriteLink) {
      symlinkSync(appBundle, desktopLink);
      created.push(desktopLink);
    }
  }
  return created;
}

function resolveLinuxDesktopDir(home) {
  if (process.env.SYNLEXA_DESKTOP_DIR) return process.env.SYNLEXA_DESKTOP_DIR;
  const xdg = spawnSync('xdg-user-dir', ['DESKTOP'], { encoding: 'utf8' });
  if (xdg.status === 0 && xdg.stdout) {
    const candidate = xdg.stdout.trim();
    if (candidate && candidate !== home && existsSync(candidate)) {
      return candidate;
    }
  }
  return join(home, 'Desktop');
}

function installLinuxDesktopShortcut({ nativeHost, distDir, cliEntry, nodeExe }) {
  const home = process.env.HOME || homedir();
  const xdgDataHome = process.env.XDG_DATA_HOME || join(home, '.local', 'share');
  const appsDir = join(xdgDataHome, 'applications');
  const icons256Dir = join(xdgDataHome, 'icons', 'hicolor', '256x256', 'apps');
  const icons1024Dir = join(xdgDataHome, 'icons', 'hicolor', '1024x1024', 'apps');

  mkdirSync(appsDir, { recursive: true });
  mkdirSync(icons256Dir, { recursive: true });
  mkdirSync(icons1024Dir, { recursive: true });

  const icon1024Src = join(PKG_ROOT, 'assets', 'icon.png');
  const icon256Src = join(PKG_ROOT, 'assets', 'icon-256.png');
  const installedIcon1024 = join(icons1024Dir, 'synlexa-studio.png');
  const installedIcon256 = join(icons256Dir, 'synlexa-studio.png');

  if (existsSync(icon1024Src)) cpSync(icon1024Src, installedIcon1024);
  if (existsSync(icon256Src)) {
    cpSync(icon256Src, installedIcon256);
  } else if (existsSync(icon1024Src)) {
    cpSync(icon1024Src, installedIcon256);
  }

  const iconField = existsSync(installedIcon1024) ? installedIcon1024 : 'synlexa-studio';
  const execLine =
    nativeHost && existsSync(distDir)
      ? `${quoteDesktopExecArg(nativeHost)} --dist ${quoteDesktopExecArg(distDir)}`
      : `${quoteDesktopExecArg(nodeExe)} ${quoteDesktopExecArg(cliEntry)} launch`;

  const desktopEntry = `[Desktop Entry]
Version=1.0
Type=Application
Name=Synlexa Studio
GenericName=Computational Biology Workbench
Comment=Deterministic Structural Biology & Cheminformatics Workbench (Research-Use-Only)
Exec=${execLine}
Icon=${iconField}
Categories=Science;Education;Development;
Keywords=Synlexa;Bioinformatics;Protein;MolStar;SMILES;CRISPR;MCP;
Terminal=false
StartupNotify=true
`;

  const created = [];
  const appDesktopFile = join(appsDir, 'synlexa-studio.desktop');
  writeFileSync(appDesktopFile, desktopEntry, 'utf8');
  chmodSync(appDesktopFile, 0o755);
  created.push(appDesktopFile);

  const desktopDir = resolveLinuxDesktopDir(home);
  if (existsSync(desktopDir) && isWritableDir(desktopDir)) {
    const desktopFile = join(desktopDir, 'synlexa-studio.desktop');
    writeFileSync(desktopFile, desktopEntry, 'utf8');
    chmodSync(desktopFile, 0o755);
    spawnSync('gio', ['set', desktopFile, 'metadata::trusted', 'true'], { stdio: 'ignore' });
    created.push(desktopFile);
  }

  spawnSync('update-desktop-database', [appsDir], { stdio: 'ignore' });
  return created;
}

function installWindowsDesktopShortcut({ nativeHost, distDir, cliEntry, nodeExe }) {
  const home = process.env.USERPROFILE || process.env.HOME || homedir();
  const iconIco = join(PKG_ROOT, 'assets', 'icon.ico');
  const targetPath = nativeHost && existsSync(distDir) ? nativeHost : nodeExe;
  const targetArgs =
    nativeHost && existsSync(distDir) ? `--dist "${distDir}"` : `"${cliEntry}" launch`;

  const psScript = `
$ErrorActionPreference = 'Stop'
$WshShell = New-Object -ComObject WScript.Shell
$Targets = @()
$DesktopDir = if ($env:SYNLEXA_DESKTOP_DIR) { $env:SYNLEXA_DESKTOP_DIR } else { [Environment]::GetFolderPath('Desktop') }
$ProgramsDir = if ($env:SYNLEXA_PROGRAMS_DIR) { $env:SYNLEXA_PROGRAMS_DIR } else { [Environment]::GetFolderPath('Programs') }
if ($DesktopDir -and (Test-Path $DesktopDir)) { $Targets += (Join-Path $DesktopDir 'Synlexa Studio.lnk') }
if ($ProgramsDir) {
  New-Item -ItemType Directory -Force -Path $ProgramsDir | Out-Null
  $Targets += (Join-Path $ProgramsDir 'Synlexa Studio.lnk')
}
foreach ($LnkPath in $Targets) {
  $Sc = $WshShell.CreateShortcut($LnkPath)
  $Sc.TargetPath = $env:SYNLEXA_SC_TARGET
  $Sc.Arguments = $env:SYNLEXA_SC_ARGS
  $Sc.WorkingDirectory = $env:SYNLEXA_SC_WORKDIR
  $Sc.Description = 'Synlexa Studio — Deterministic Structural Biology & Cheminformatics Workbench (RUO)'
  $Sc.WindowStyle = 7
  if ($env:SYNLEXA_SC_ICON -and (Test-Path $env:SYNLEXA_SC_ICON)) {
    $Sc.IconLocation = "$($env:SYNLEXA_SC_ICON),0"
  }
  $Sc.Save()
  Write-Output $LnkPath
}
`;

  const res = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        SYNLEXA_SC_TARGET: targetPath,
        SYNLEXA_SC_ARGS: targetArgs,
        SYNLEXA_SC_ICON: existsSync(iconIco) ? iconIco : '',
        SYNLEXA_SC_WORKDIR: home,
      },
    },
  );
  if (res.status !== 0) {
    throw new Error(res.stderr || 'Failed to create Windows desktop shortcut');
  }
  return (res.stdout || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Installs a clickable Synlexa Studio icon onto the user's Desktop and OS app launcher.
 */
export function installDesktopShortcut({ platform = process.platform } = {}) {
  const meta = readPackageMeta();
  const version = meta.version || '0.4.1';
  const nativeHost = findNativeBinary('synlexa-studio-desktop-native');
  const nativeCli = findNativeBinary('studio-cli');
  const distDir = join(PKG_ROOT, 'web-dist');
  const cliEntry = join(PKG_ROOT, 'bin', 'synlexa-studio.mjs');
  const nodeExe = process.execPath;

  const opts = { version, nativeHost, nativeCli, distDir, cliEntry, nodeExe };
  if (platform === 'darwin') return installMacosDesktopShortcut(opts);
  if (platform === 'linux') return installLinuxDesktopShortcut(opts);
  if (platform === 'win32') return installWindowsDesktopShortcut(opts);
  return [];
}

/**
 * Removes Synlexa Studio Desktop / Applications shortcuts created by npm install.
 */
export function uninstallDesktopShortcut({ platform = process.platform } = {}) {
  const removed = [];
  const home = process.env.HOME || process.env.USERPROFILE || homedir();
  const candidates = [];

  if (platform === 'darwin') {
    const desktopDir = process.env.SYNLEXA_DESKTOP_DIR || join(home, 'Desktop');
    const desktopLink = join(desktopDir, 'Synlexa Studio.app');
    try {
      if (lstatSync(desktopLink).isSymbolicLink()) candidates.push(desktopLink);
    } catch {
      // ignore
    }
    const appDir = process.env.SYNLEXA_APP_DIR;
    if (appDir) candidates.push(join(appDir, 'Synlexa Studio.app'));
    candidates.push(join(home, 'Applications', 'Synlexa Studio.app'));
    let realHome = home;
    try {
      realHome = userInfo().homedir || home;
    } catch {
      // ignore
    }
    if (home === realHome && isWritableDir('/Applications')) candidates.push('/Applications/Synlexa Studio.app');
  } else if (platform === 'linux') {
    const xdgDataHome = process.env.XDG_DATA_HOME || join(home, '.local', 'share');
    candidates.push(join(xdgDataHome, 'applications', 'synlexa-studio.desktop'));
    candidates.push(join(resolveLinuxDesktopDir(home), 'synlexa-studio.desktop'));
  } else if (platform === 'win32') {
    const desktopDir = process.env.SYNLEXA_DESKTOP_DIR || join(home, 'Desktop');
    const programsDir =
      process.env.SYNLEXA_PROGRAMS_DIR ||
      join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    candidates.push(join(desktopDir, 'Synlexa Studio.lnk'));
    candidates.push(join(programsDir, 'Synlexa Studio.lnk'));
  }

  for (const target of candidates) {
    if (existsSync(target)) {
      rmSync(target, { recursive: true, force: true });
      removed.push(target);
    }
  }
  const stateDir = join(home, '.synlexa-studio');
  if (existsSync(stateDir)) {
    for (const entry of readdirSync(stateDir)) {
      if (entry.startsWith('.desktop-setup-v')) {
        rmSync(join(stateDir, entry), { force: true });
      }
    }
  }
  return removed;
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

/**
 * Downloads and SHA-256 verifies the native desktop runtime archive into ~/.synlexa-studio/runtime.
 */
export async function ensureVerifiedNativeRuntime(version) {
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

/**
 * Ensures the native runtime and Desktop/launcher shortcut are provisioned once per version.
 * Covers both npm postinstall and npm v12+ first-launch execution (when allowScripts defaults off).
 */
export async function ensureStudioDesktopSetup({ force = false, quiet = false } = {}) {
  const isCi = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
  const optOut = process.env.SYNLEXA_NO_DESKTOP_ICON === '1';
  if (isCi || optOut) return [];

  const meta = readPackageMeta();
  const version = meta.version || '0.4.3';
  const home = process.env.HOME || process.env.USERPROFILE || homedir();
  const stateDir = join(home, '.synlexa-studio');
  const markerPath = join(stateDir, `.desktop-setup-v${version}`);

  if (!force && existsSync(markerPath)) {
    return [];
  }

  if (process.env.SYNLEXA_SKIP_RUNTIME_DOWNLOAD !== '1') {
    try {
      const ok = await ensureVerifiedNativeRuntime(version);
      if (ok && !quiet) {
        console.log(`[synlexa-studio] Verified native desktop runtime v${version}.`);
      }
    } catch (err) {
      if (!quiet) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[synlexa-studio] Native runtime download skipped (${msg}); using bundled Wasm/Web runtime.`);
      }
    }
  }

  let installed = [];
  try {
    installed = installDesktopShortcut();
    if (installed.length > 0 && !quiet) {
      console.log(`[synlexa-studio] Added Synlexa Studio launcher icon: ${installed.join(', ')}`);
    }
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(markerPath, `${new Date().toISOString()}\n`, 'utf8');
  } catch (err) {
    if (!quiet) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[synlexa-studio] Desktop shortcut setup skipped (${msg}). Run "synlexa-studio install-desktop" later to create it.`);
    }
  }
  return installed;
}
