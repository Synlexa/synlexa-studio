# Changelog

All notable changes to Synlexa Studio are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.1] - 2026-11-16

### Added
- **Shared 3D Workspace Bridge (`Studio3DBridge` & `Project3DContextBanner`)**: Synchronized 3D focus, residue/pocket highlighting, docking box state, and active project assets across Chemistry, Peptide, CRISPR, Ramachandran, Sequence Deviation, Results, Workflow Canvas, Compute Nodes, Plugins, and Library workbenches (`WorkbenchShared.tsx`, `studioBridge.ts`).
- **2D Sketcher & RDKit SMARTS Enhancements**: Added `carboxyl` and `amide` sketcher templates (`sketcherGraph.ts`) and full multi-match SMARTS atom/bond highlighting (`rdkitCore.ts`, `rdkitAndSketcher.test.ts`).
- **Split Pane & Side-by-Side Controls**: Added `merge_split` layout action and pane merge button (`workspaceLayout.ts`, `EditorArea.tsx`), plus direct side-by-side split buttons in `ToolsPanel` (`Shell.tsx`).

### Changed
- **Workbench UI Polish**: Replaced decorative star icons with domain icons (`FlaskConical`, `Brain`) across `WorkbenchShared`, `SequenceDeviationTrack`, `RamachandranPanel`, `ThinkingProcessPanel`, and `ChemistryWorkbench`.

## [0.4.0] - 2026-11-16

### Added
- **Apache License 2.0 Open-Source Release** under https://github.com/Synlexa/synlexa-studio (`LICENSE`, `NOTICE`, `TRADEMARKS.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `GOVERNANCE.md`, `CITATION.cff`, `ROADMAP.md`, `.zenodo.json`).
- **Python SDK (`bindings/python`, `synlexa-studio-sdk`)** providing typed access to local `studio-cli` deterministic kernels (`compare_structures`, `inspect_structure`, `analyze_peptide`, `analyze_gene`, `analyze_smiles`, `analyze_ramachandran`) and remote/local `synlexa-compute` GPU jobs.
- **Developer Documentation & Reproducible Examples**: Added `docs/installation.md`, `docs/sdk-and-mcp.md`, `docs/scientific-methods.md`, `docs/cloud-integration.md`, `docs/contributing-and-sync.md`, and runnable examples under `examples/`.
- **Build & Version Automation**: Added `scripts/prepare-wasm.mjs` (removes 7.5 MiB of prebuilt `.wasm` blobs from git and builds/copies from source on demand), `scripts/check-version-sync.mjs`, and `scripts/bump-version.mjs` to enforce unified versioning across Rust, Tauri, npm, Python, installers, and Homebrew.
- **Unified CI Pipeline (`.github/workflows/ci.yml`)**: Automated Rust, C++20 CTest, WebAssembly, TypeScript/Vitest, Python SDK + compute-worker tests, Native-vs-Wasm parity benchmarks, Gitleaks secret scan, license audit, and doc checks.
- **Rich Markdown & Thinking Trace UI**: Structured `MarkdownContent` and `ThinkingProcessPanel` components across `AssistantView` and `GeminiAgentPanel` (`markdownAndThinking.test.ts`).

### Changed
- **Dynamic Version Injection**: Replaced hardcoded version strings in `studio-cli`, `synlexa-studio-desktop-native`, Vite Web IDE (`SettingsView`, `mcpServer`), and `synlexa-studio` npm launcher with build-time/manifest values.
- **Configurable Optional Cloud Endpoints**: Parameterized `VITE_SYNLEXA_CLOUD_URL` in `apps/web/src/lib/studioAuth.ts` (defaults to `https://synlexa.com`).
- **Packaging & Tap Alignment**: Updated `install.sh`, `install.ps1`, Homebrew Formula & Cask (`postflight_steps`, removed deprecated `verified:`), and `release.yml` for GitHub Releases under `Synlexa/synlexa-studio` alongside CDN mirror fallback.

## [0.3.0] - 2026-11-16

### Added
- Multi-project workspace store (`projectsStore.ts`), live agent thinking trace UI, and per-category tool permission gates (`toolPermissions.ts`).
- Interactive Tutorial Guide modal (`TutorialGuideModal.tsx`).
- Colab/GPU external compute bridge (`synlexa-compute` + `synlexa_colab_gpu.ipynb`), Mol\* Pro 3D viewer, RDKit WASM 2D sketcher & PAINS/Brenk alerts, workflow DAG canvas, and plugin registry.

## [0.2.0] - 2026-11-16

### Added
- Native macOS AppKit / WKWebView window launcher (`apps/desktop/native/src/macos_window.m`).
- Multi-OS release packaging (`macOS` Universal `.dmg`/`.tar.gz`, `Linux` `.AppImage`/`.deb`/`.tar.gz`, `Windows` x64/arm64 `.zip`, npm tarballs, `install.sh`, `install.ps1`, Homebrew Formula/Cask).

## [0.1.0] - 2026-11-15

### Added
- Initial pure-Rust deterministic core (`synlexa-bio-core`), C++20 reference implementation (`core/`), `studio-cli`, `studio-wasm` ABI v1, `@synlexa/wasm-bridge`, and offline Web IDE (`@synlexa/studio-web`) with pinned RCSB/AlphaFold DB/PubChem benchmarks.
