# Synlexa Studio Public Roadmap

This roadmap tracks upcoming capabilities for the **Apache-2.0 open-source Synlexa Studio** workbench, SDKs, and self-hosted compute connectors (`Research-Use-Only`).

## Near-Term (v0.4.x – v0.5.0)
- **Wasm ABI v1 Expansion**: Export C++/Rust molecular surface/pocket volume kernels and batch multi-chain RMSD comparisons directly in WebAssembly workers.
- **Python SDK (`synlexa-studio-sdk`) on PyPI**: Native PyO3 bindings alongside subprocess CLI/compute-node client, enabling zero-subprocess in-memory numpy array interoperability.
- **Standalone Tauri v2 Binary Releases**: Signed/bundled optional Tauri installers alongside the zero-dependency native WebView launcher.
- **Workflow DAG Export Improvements**: Verified Nextflow DSL2 and Snakemake workflow export templates for structure prediction -> docking -> MD pipelines.
- **Expanded Scientific Fixtures**: Additional experimental crystal/cryo-EM complexes with ligand pocket benchmarks and crystallographic symmetry checks.

## Medium-Term (v0.6.x+)
- **Plugin SDK & Community Registry Spec**: Automated validation GitHub Action for community-contributed `synlexa-plugin.v1.schema.json` manifests.
- **JupyterLab / Colab Widget Embeds**: Lightweight `@synlexa/wasm-bridge` + Mol\* viewer widget for notebooks.
- **Zenodo DOI Archiving**: Automated versioned software citation DOIs on tagged releases.

## Always Free & Local vs. Synlexa Cloud
- **Remains Open Source (Apache-2.0)**: Local structure parsing, 3D superposition, peptide/CRISPR/SMILES/RDKit/Mol\* workbenches, CLI, MCP server, local BYOK vault, SDKs, and self-hosted Colab/CUDA compute bridge.
- **Optional Commercial Cloud (`Synlexa Cloud`)**: Managed GPU orchestration, metered high-throughput jobs, hosted AI research agents, multi-tenant team RBAC/SSO/audit logs, and proprietary biomarker evidence synthesis.
