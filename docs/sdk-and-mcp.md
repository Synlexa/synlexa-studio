# SDK, Wasm ABI v1 & MCP Integration Guide

## 1. Rust Core (`crates/synlexa-bio-core`)

Zero third-party dependencies (`std`-only Rust). Exposes deterministic modules:
- `structure`: bounded PDB & mmCIF parser (50 MiB / 250k atoms, altLoc/insertion-code handling, `experimental_b_factor` vs `prediction_plddt`).
- `superpose`: Needleman-Wunsch sequence matching + double-precision Kabsch SVD rigid alignment (`det(R) = +1`, `mobile_to_reference` row-major 4x4 matrix).
- `peptide`: physicochemical properties, net charge (`pH 7.4`), GRAVY, mutation deltas, `< 5.0 Å` active-site contact shell.
- `genomics`: GRCh38/MANE coding transcript translation & `SpCas9` / `SaCas9` / `Cas12a` PAM enumeration.
- `chemistry`: deterministic SMILES parser, exact formula, molecular weight, Lipinski/Veber metrics, Crippen LogP/TPSA, 2D SVG/graph layout.
- `ramachandran`: backbone $(\phi, \psi)$ dihedrals & $\text{C}\alpha\text{--}\text{C}\alpha$ contact matrices.

## 2. WebAssembly ABI v1 (`@synlexa/wasm-bridge`)

Full linear-memory specification lives in [`bindings/wasm/ABI.md`](../bindings/wasm/ABI.md). Supported ops via `session.invokeJson(op, payload)`:
- `inspect_structure`
- `compare_structures`
- `analyze_peptide`
- `analyze_gene_crispr`
- `analyze_molecule_smiles`
- `analyze_ramachandran`

Plus high-throughput packed coordinate extraction: `session.extractCaCoordsF64({ content, chainId }, maxResidues)`.

## 3. C++20 Reference Core (`core/` & `tools/studio-cli`)

Build and invoke the C++20 CLI cleanly on any platform with CMake 3.24+ & Ninja:

```bash
cmake --preset native-release
cmake --build --preset native-release
./build/native-release/studio-cli-cpp --help
ctest --preset native-release --output-on-failure
```

## 4. Python SDK (`bindings/python`, `synlexa-studio-sdk`)

Provides `SynlexaStudioClient` (wraps `studio-cli`) and `ComputeNodeClient` (talks to `synlexa-compute` GPU endpoints over HTTPS or localhost with SHA-256 artifact checks):

```python
from synlexa_sdk import SynlexaStudioClient, ComputeNodeClient

studio = SynlexaStudioClient()
gene = studio.analyze_gene(transcript="NM_000518.5", codon=7, edit_bp=2, new_base="T", nuclease="SpCas9")
print(gene["targetCodon"]["consequence"])
```

See [`bindings/python/README.md`](../bindings/python/README.md) and [`examples/molecular-workflows/run_sdk_demo.py`](../examples/molecular-workflows/run_sdk_demo.py).

## 5. Model Context Protocol (MCP) Integration

Synlexa Studio implements **JSON-RPC 2.0 MCP (`2024-11-05`)** in two ways:
1. **CLI Stdio MCP** (`studio-cli mcp --stdio` or Node/Wasm fallback `synlexa-studio mcp --stdio`): Exposes deterministic structure, peptide, CRISPR, SMILES, and Ramachandran kernels to **Claude Desktop**, **Claude Code**, **OpenAI Codex**, and **Cursor**.
2. **Native HTTP MCP Host** (`synlexa-studio-desktop-native` at `http://127.0.0.1:<port>/mcp`) + **In-App Browser MCP Server** (`apps/web/src/lib/mcpServer.ts`): Adds workspace inspection and live Europe PMC / ClinicalTrials.gov / RCSB / PubChem connectors.

Example `~/.claude/mcp.json` / client configuration:

```json
{
  "mcpServers": {
    "synlexa-studio": {
      "command": "synlexa-studio",
      "args": ["mcp", "--stdio"]
    }
  }
}
```

## 6. Synlexa Cloud sign-in from the CLI (optional)

Every local command above works signed out and offline. Signing in only adds
Synlexa Cloud features on your plan (cloud AI, plan and usage information).

```bash
studio-cli login              # opens synlexa.com in your browser (OAuth 2.0 + PKCE, loopback redirect)
studio-cli login --device     # no browser on this machine: approve a short code at synlexa.com/activate
studio-cli whoami             # account, plan and cloud models on your plan (--json for scripts)
studio-cli usage              # remaining Synlexa Cloud usage per window (--json for scripts)
studio-cli upgrade --plan pro # opens checkout and waits for the plan change
studio-cli logout             # ends the sign-in on synlexa.com and removes local credentials
```

- Access tokens last one hour and refresh automatically; refresh tokens rotate on each use.
- Credentials are stored in the macOS Keychain or Windows Credential Manager, and in
  `~/.synlexa-studio/credentials.json` (mode 0600) on Linux. Set
  `SYNLEXA_CLI_CREDENTIAL_STORE=file` to use the file everywhere, or
  `SYNLEXA_CLI_CREDENTIALS_FILE=<path>` to choose its location.
- `SYNLEXA_CLOUD_URL` points the CLI at a self-hosted or local website (HTTPS, or `http://localhost` / `http://127.0.0.1` only).
- Tokens are never printed. Each sign-in is listed, and can be revoked, in your synlexa.com account settings.
