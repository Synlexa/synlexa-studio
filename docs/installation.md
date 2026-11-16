# Installation Guide

> **Research-Use-Only (RUO):** All Synlexa Studio distributions are for computational research and evaluation only. Not for diagnostic or treatment decisions.

## Browser IDE (Zero Install)

Open [https://studio.synlexa.com](https://studio.synlexa.com) in any modern Chromium, Firefox, or Safari browser. Computation runs client-side in WebAssembly workers (`synlexa_bio_core.wasm` and `RDKit_minimal.wasm`) with Mol\* WebGL2 rendering and IndexedDB `state.vscdb` AES-256-GCM credential storage.

## One-Line Command-Line Installers

### macOS & Linux (`curl`)

```bash
curl -fsSL https://github.com/Synlexa/synlexa-studio/releases/latest/download/install.sh | sh
```

- Installs `synlexa-studio` and `studio-cli` into `~/.local/bin` and the runtime into `~/.synlexa-studio/runtime`.
- On macOS, builds `Synlexa Studio.app` inside `/Applications` (or `~/Applications`) and strips quarantine attributes locally.
- Override target version or directories with `SYNLEXA_VERSION`, `SYNLEXA_INSTALL_DIR`, or `SYNLEXA_BIN_DIR`.

### Windows PowerShell (`irm`)

```powershell
irm https://github.com/Synlexa/synlexa-studio/releases/latest/download/install.ps1 | iex
```

- Auto-detects `x64` vs `arm64`, unpacks binaries into `%USERPROFILE%\.synlexa-studio\runtime`, unblocks executables, and adds `bin` to User `PATH`.

## Homebrew (macOS & Linux)

```bash
brew tap Synlexa/tap
brew install synlexa-studio
```

For the macOS `.app` bundle on Apple Silicon or Intel:

```bash
brew install --cask Synlexa/tap/synlexa-studio
```

Verify installation:

```bash
studio-cli --version
synlexa-studio mcp --stdio <<< '{"jsonrpc":"2.0","id":1,"method":"initialize"}'
```

## npm Package (Cross-Platform Launcher & Wasm Core)

Install globally with Node.js >= 18:

```bash
npm install -g https://github.com/Synlexa/synlexa-studio/releases/download/v0.4.0/synlexa-studio-0.4.0.tgz
synlexa-studio
```

Use the Wasm SDK inside Node.js/TypeScript applications:

```bash
npm install https://github.com/Synlexa/synlexa-studio/releases/download/v0.4.0/synlexa-wasm-bridge-0.4.0.tgz
```

## Python Packages (`synlexa-studio-sdk` & `synlexa-compute`)

```bash
# Lightweight zero-dependency Python SDK (wraps local studio-cli & compute nodes)
pip install -e ./bindings/python

# Optional GPU / external solver worker (for Colab, local CUDA, or HPC clusters)
cd services/compute-worker
pip install -e ".[server,chemistry,simulation,ai,ml]"
python3 -m synlexa_compute.server --port 4180
```

## Google Colab & Docker GPU

- **Google Colab (T4 / L4 / A100)**: Open [`services/compute-worker/colab/synlexa_colab_gpu.ipynb`](../services/compute-worker/colab/synlexa_colab_gpu.ipynb) in Colab, check the toolboxes you want (`RDKit`, `AutoDock Vina`, `PySCF`, `OpenMM`, `Boltz-2`, `Chemprop`), run the pairing cell, and paste the `synlexa-node://...` URI into **Synlexa Studio -> Compute Nodes**.
- **Docker GPU**:
  ```bash
  cd services/compute-worker
  docker build -f Dockerfile.gpu -t synlexa-compute:latest .
  docker run --gpus all -p 4180:4180 synlexa-compute:latest
  ```

## Direct Archives & SHA-256 Verification

Every tagged release publishes `SHA256SUMS.txt` alongside:

| Platform | Archive |
|---|---|
| macOS Universal (Apple Silicon + Intel) | `Synlexa-Studio-v0.4.0-universal-apple-darwin.dmg`, `synlexa-studio-v0.4.0-universal-apple-darwin.tar.gz` |
| Windows (`x64` / `arm64`) | `Synlexa-Studio-v0.4.0-windows-x64.zip`, `Synlexa-Studio-v0.4.0-windows-arm64.zip` |
| Linux (`x86_64` / `aarch64`) | `Synlexa-Studio-v0.4.0-universal-x86_64.AppImage`, `Synlexa-Studio-v0.4.0-linux-amd64.deb`, `Synlexa-Studio-v0.4.0-linux-arm64.deb`, `synlexa-studio-v0.4.0-x86_64-unknown-linux-gnu.tar.gz`, `synlexa-studio-v0.4.0-aarch64-unknown-linux-gnu.tar.gz` |

Verify downloaded archives with:

```bash
shasum -a 256 -c SHA256SUMS.txt --ignore-missing
```
