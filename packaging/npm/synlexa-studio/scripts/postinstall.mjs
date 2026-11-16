import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { installDesktopShortcut, PKG_ROOT } from './desktop-shortcut.mjs';

const hasWasm = existsSync(join(PKG_ROOT, 'wasm', 'synlexa_bio_core.wasm'));
if (!hasWasm) {
  console.log('[synlexa-studio] Installed CLI wrapper (platform binary or Wasm core will be resolved at runtime).');
}

const isCi = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
const optOut = process.env.SYNLEXA_NO_DESKTOP_ICON === '1';
const isGlobalInstall = process.env.npm_config_global === 'true' || process.env.SYNLEXA_DESKTOP_ICON === '1';

if (!isCi && !optOut && isGlobalInstall) {
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
