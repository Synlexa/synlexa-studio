#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import readline from 'node:readline';
import {
  findNativeBinary,
  installDesktopShortcut,
  PKG_ROOT,
  readPackageMeta,
  uninstallDesktopShortcut,
} from '../scripts/desktop-shortcut.mjs';

const pkgRoot = PKG_ROOT;
const pkgMeta = readPackageMeta();
const PKG_VERSION = pkgMeta.version || '0.4.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.cif': 'text/plain; charset=utf-8',
  '.pdb': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function openUrl(url) {
  try {
    if (process.platform === 'darwin') {
      const chromeApp = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
      if (existsSync(chromeApp)) {
        spawn(chromeApp, [`--app=${url}`], { detached: true, stdio: 'ignore' }).unref();
        return;
      }
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', 'msedge', `--app=${url}`], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    // ignore headless environments
  }
}

async function runWasmStdioMcp() {
  const wasmPath = join(pkgRoot, 'wasm', 'synlexa_bio_core.wasm');
  if (!existsSync(wasmPath)) {
    console.error('Synlexa Studio MCP fallback requires wasm/synlexa_bio_core.wasm');
    process.exit(1);
  }
  const wasmBytes = readFileSync(wasmPath);
  const { instance } = await WebAssembly.instantiate(wasmBytes, {});
  const exports = instance.exports;

  const invokeWasm = (op, reqObj) => {
    const jsonBytes = Buffer.from(JSON.stringify({ op, payload: reqObj }), 'utf8');
    const ptr = exports.alloc(jsonBytes.length);
    new Uint8Array(exports.memory.buffer, ptr, jsonBytes.length).set(jsonBytes);
    const outPtr = exports.invoke_json(ptr, jsonBytes.length);
    const outLen = exports.last_result_len();
    exports.dealloc(ptr, jsonBytes.length);
    const text = Buffer.from(exports.memory.buffer, outPtr, outLen).toString('utf8');
    return JSON.parse(text);
  };

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`,
      );
      continue;
    }
    if (msg.method?.startsWith('notifications/')) continue;
    const id = msg.id ?? null;
    if (msg.method === 'initialize') {
      process.stdout.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            serverInfo: { name: 'synlexa-studio-wasm-mcp', version: PKG_VERSION },
            capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
          },
        })}\n`,
      );
    } else if (msg.method === 'ping') {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result: {} })}\n`);
    } else if (msg.method === 'tools/list') {
      process.stdout.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: {
            tools: [
              { name: 'analyze_molecule_smiles', description: 'Compute deterministic SMILES descriptors & 2D layout' },
              { name: 'analyze_gene_crispr', description: 'Analyze coding transcript edit & scan CRISPR PAM sites' },
              { name: 'analyze_peptide', description: 'Compute wild-type vs engineered peptide descriptors' },
              { name: 'inspect_structure', description: 'Inspect mmCIF/PDB chains and ligands' },
              { name: 'analyze_ramachandran', description: 'Compute Ramachandran dihedrals & contacts' },
            ],
          },
        })}\n`,
      );
    } else if (msg.method === 'tools/call') {
      const name = msg.params?.name;
      const args = msg.params?.arguments ?? {};
      const out = invokeWasm(name, args);
      process.stdout.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: {
            isError: !out.ok,
            content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
          },
        })}\n`,
      );
    } else {
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${msg.method}` } })}\n`,
      );
    }
  }
}

async function launchStudioWebHost(args) {
  const nativeHost = findNativeBinary('synlexa-studio-desktop-native');
  const distDir = join(pkgRoot, 'web-dist');
  const iconIcns = join(pkgRoot, 'assets', 'icon.icns');
  const spawnEnv = existsSync(iconIcns)
    ? { ...process.env, SYNLEXA_ICON_PATH: iconIcns }
    : process.env;

  if (nativeHost && existsSync(distDir)) {
    const res = spawnSync(nativeHost, ['--dist', distDir, ...args], {
      stdio: 'inherit',
      env: spawnEnv,
    });
    process.exit(res.status ?? 0);
  }
  if (!existsSync(distDir)) {
    console.error('Synlexa Studio web assets not found. Visit https://www.synlexa.com/download for desktop installers.');
    process.exit(1);
  }
  const portIdx = args.indexOf('--port');
  const hasExplicitPort = portIdx >= 0 && Boolean(args[portIdx + 1]);
  const requestedPort = hasExplicitPort ? Number(args[portIdx + 1]) : 4179;
  const noOpen = args.includes('--no-open');

  const server = http.createServer((req, res) => {
    const urlPath = (req.url || '/').split('?')[0];
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    let target = resolve(distDir, rel);
    if (!target.startsWith(distDir) || !existsSync(target) || statSync(target).isDirectory()) {
      target = resolve(distDir, 'index.html');
    }
    const content = readFileSync(target);
    res.writeHead(200, {
      'Content-Type': MIME[extname(target)] || 'application/octet-stream',
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    });
    res.end(content);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && !hasExplicitPort && requestedPort !== 0) {
      server.listen(0, '127.0.0.1');
      return;
    }
    throw err;
  });

  server.listen(requestedPort, '127.0.0.1', () => {
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : requestedPort;
    const url = `http://127.0.0.1:${port}/`;
    console.log(`Synlexa Studio (Research-Use-Only) running at ${url}`);
    if (!noOpen) openUrl(url);
  });
}

const args = process.argv.slice(2).filter((arg) => !arg.startsWith('-psn_'));
const sub = args[0];

if (
  !sub ||
  sub === 'launch' ||
  sub === 'app' ||
  sub === '--browser' ||
  sub === '--no-open' ||
  sub.startsWith('--port') ||
  sub.startsWith('--auth-callback')
) {
  await launchStudioWebHost(sub === 'launch' || sub === 'app' ? args.slice(1) : args);
} else if (sub === 'install-desktop' || sub === '--install-desktop' || sub === 'desktop-icon') {
  const created = installDesktopShortcut();
  if (created.length === 0) {
    console.log('Desktop shortcut installation is unsupported on this platform.');
  } else {
    console.log('Synlexa Studio desktop icon installed:');
    for (const p of created) console.log(`  - ${p}`);
  }
} else if (sub === 'uninstall-desktop' || sub === '--uninstall-desktop') {
  const removed = uninstallDesktopShortcut();
  console.log(removed.length > 0 ? `Removed: ${removed.join(', ')}` : 'No Synlexa Studio desktop shortcuts found.');
} else if (sub === 'mcp') {
  const nativeCli = findNativeBinary('studio-cli');
  if (nativeCli) {
    const res = spawnSync(nativeCli, args, { stdio: 'inherit' });
    process.exit(res.status ?? 0);
  }
  await runWasmStdioMcp();
} else if (sub === '--help' || sub === '-h' || sub === 'help') {
  console.log(`Synlexa Studio v${PKG_VERSION} (Research-Use-Only)
Usage:
  synlexa-studio                  Launch the local Synlexa Studio workspace
  synlexa-studio install-desktop  Add a clickable Synlexa Studio Desktop & app launcher icon
  synlexa-studio mcp --stdio      Start the stdio MCP server for Claude / Codex / Cursor
  synlexa-studio --version        Print version`);
} else if (sub === '--version' || sub === '-v' || sub === '-V' || sub === 'version') {
  console.log(PKG_VERSION);
} else {
  const nativeCli = findNativeBinary('studio-cli');
  if (nativeCli) {
    const res = spawnSync(nativeCli, args, { stdio: 'inherit' });
    process.exit(res.status ?? 0);
  }
  console.error(`Unknown subcommand "${sub}". Run "synlexa-studio --help" for usage.`);
  process.exit(1);
}
