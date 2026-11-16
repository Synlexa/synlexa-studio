# `synlexa-studio-sdk` (Python SDK)

> **Research-Use-Only (RUO):** Outputs from `synlexa-studio-sdk` are computational estimates for exploratory research and must not be used for diagnostic, therapeutic, or clinical decisions.

Zero-dependency Apache-2.0 Python SDK providing:
1. **`SynlexaStudioClient`**: Calls the local deterministic `studio-cli` engine (or `cargo run -p studio-cli`) for PDB/mmCIF inspection, IEEE-754 `float64` Kabsch structural superposition, Ramachandran dihedrals, peptide mutation analysis, MANE/CRISPR PAM scanning, and SMILES descriptors.
2. **`ComputeNodeClient`**: Connects to a self-hosted or Google Colab `synlexa-compute` node (`/v1/health`, `/v1/capabilities`, `/v1/jobs`, `/v1/jobs/{id}/artifacts/{name}`) with SHA-256 verification.

## Quickstart

```bash
pip install -e ./bindings/python
```

```python
from synlexa_sdk import SynlexaStudioClient

studio = SynlexaStudioClient()
mol = studio.analyze_smiles("CC(=O)Nc1nnc(S(N)(=O)=O)s1", name="Acetazolamide")
print(mol["formula"], mol["molecularWeight"])

cmp = studio.compare_structures(
    ref_path="tests/fixtures/3HS4.cif",
    mob_path="tests/fixtures/AF-P00918-F1-model_v6.cif",
    ref_chain="A",
    mob_chain="A",
    pae_path="tests/fixtures/AF-P00918-F1-predicted_aligned_error_v6.json",
)
print(cmp["metrics"]["matchedCaCount"], cmp["metrics"]["rmsdAngstrom"])
```
