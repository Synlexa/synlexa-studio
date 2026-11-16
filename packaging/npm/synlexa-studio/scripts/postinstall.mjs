import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ensureStudioDesktopSetup, PKG_ROOT } from './desktop-shortcut.mjs';

const hasWasm = existsSync(join(PKG_ROOT, 'wasm', 'synlexa_bio_core.wasm'));
if (!hasWasm) {
  console.log('[synlexa-studio] Installed launcher (native runtime or Wasm core will be resolved at runtime).');
}

const isGlobalInstall = process.env.npm_config_global === 'true' || process.env.SYNLEXA_DESKTOP_ICON === '1';
if (isGlobalInstall) {
  await ensureStudioDesktopSetup({ force: true });
}
