# Contributing to Synlexa Studio

Thank you for helping make open computational biology software faster, safer, and easier to verify.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold a welcoming, constructive, research-oriented community.

## Scientific & Intended-Use Integrity

Synlexa Studio is **Research-Use-Only (RUO)** software:

- Never fabricate or hardcode unverified PMIDs, DOIs, NCT IDs, p-values, or experimental structures.
- Preserve provenance fields (`sourceUrl`, `license`, `retrievedAtUtc`, SHA-256 digests) across every loader, schema, and report export.
- Keep deterministic engines (`crates/synlexa-bio-core` and `core/`) pure, IEEE-754 `float64` consistent across Native and WebAssembly, and free of diagnostic or therapeutic claims.

## Local Development Setup

### Prerequisites

- **Rust** (`rustup`) with `wasm32-unknown-unknown` target:
  ```bash
  rustup target add wasm32-unknown-unknown
  ```
- **Node.js >= 20** and **pnpm 9**:
  ```bash
  corepack enable && corepack prepare pnpm@9.5.0 --activate
  ```
- **Optional (for C++20 reference suite)**: `cmake >= 3.24`, `ninja`, and a C++20 compiler (`clang++` / `g++`)
- **Optional (for Python SDK / GPU compute worker)**: Python `>= 3.10` and `pytest`

### Quick Verification Commands

```bash
# 1. Install JS dependencies and prepare Wasm assets (RDKit + studio-wasm)
pnpm install
node scripts/prepare-wasm.mjs

# 2. Check version synchronization across all packages and manifests
node scripts/check-version-sync.mjs

# 3. Rust core, CLI, Wasm crate & native desktop host tests
cargo test --workspace --locked
cargo test --manifest-path apps/desktop/native/Cargo.toml --locked

# 4. Web IDE typecheck, unit/UI suite & production build
pnpm --filter @synlexa/studio-web lint
pnpm --filter @synlexa/studio-web test
pnpm --filter @synlexa/studio-web build

# 5. Native vs. WebAssembly numerical parity benchmark (<= 1e-6 A)
cargo build -p studio-cli --release
node benchmarks/run_benchmarks.mjs

# 6. C++20 reference engine suite (optional when CMake + Ninja installed)
cmake --preset native-debug
cmake --build --preset native-debug
ctest --preset native-debug --output-on-failure

# 7. Python SDK & compute worker tests
PYTHONPATH=bindings/python python3 -m unittest discover -s bindings/python/tests -v
python3 -m pytest services/compute-worker/tests -q
```

## Pull Request Workflow

1. Fork [`Synlexa/synlexa-studio`](https://github.com/Synlexa/synlexa-studio) and create a focused branch (`feat/...` or `fix/...`).
2. Keep changes scoped and include tests for any behavioral change.
3. Ensure `node scripts/check-version-sync.mjs`, `cargo test --workspace --locked`, Web tests, and parity benchmarks pass locally.
4. Do **not** commit compiled `.wasm` files under `apps/web/public/wasm/` or local build directories (`build/`, `dist/`, `target/`) — CI builds Wasm artifacts reproducibly from source.
5. Do **not** modify package versions in feature PRs unless performing a coordinated release using `node scripts/bump-version.mjs <x.y.z>`. See [`docs/contributing-and-sync.md`](docs/contributing-and-sync.md) for how public PRs stay synchronized with private deployment mirrors.

## Contributor License Agreement (Apache-2.0 Inbound = Outbound)

Under **Section 5 of the Apache License, Version 2.0**, any Contribution intentionally submitted for inclusion in Synlexa Studio is governed by the Apache License, Version 2.0 without any additional terms or restrictions.
