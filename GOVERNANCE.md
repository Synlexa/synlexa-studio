# Project Governance

Synlexa Studio is maintained by **Synlexa** as an Apache-2.0 open-source scientific software project.

## Guiding Principle

> **Open scientific tools. Commercial cloud infrastructure.**

Local computational engines, parsers, desktop/CLI tools, WebAssembly bindings, browser workbench features, and open-source Python/TypeScript SDKs remain freely available under the **Apache License, Version 2.0**, with zero artificial local capability locks or mandatory cloud accounts.

## Roles

- **Contributors**: Anyone submitting bug reports, documentation updates, benchmark improvements, or pull requests accepted under Apache-2.0 Section 5.
- **Maintainers**: Core engineering and scientific leads responsible for release engineering, ABI stability (`Wasm ABI v1`), deterministic numerical parity (`Native` vs `Wasm` vs `C++20`), security triage, and PR review.
- **Steward / Benevolent Maintainer**: **ATIL YALI** (`@nanobiolog`), founder of Synlexa, retains final release sign-off, trademark stewardship (`TRADEMARKS.md`), and synchronization oversight with Synlexa Cloud distribution channels.

## Decision-Making & ABI Stability

- **Day-to-day PRs**: Reviewed by maintainers against CI (`ci.yml`), version consistency (`scripts/check-version-sync.mjs`), and numerical parity (`benchmarks/run_benchmarks.mjs`).
- **Breaking Changes (`Wasm ABI`, JSON schemas under `schemas/`)**: Require an explicit proposal issue describing schema compatibility and migration impact before breaking `v1` contracts.
- **Cloud Separation**: Commercial billing, multi-tenant cloud orchestration, and hosted proprietary AI/biomarker backends live outside this repository and remain independent from open-source contributions.
