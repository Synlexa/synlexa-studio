# Scientific Methods, Parity & Scope

> **Intended-Use Boundary:** Outputs are computational research estimates for discovery and translational science. They are **not** clinically validated diagnostic or therapeutic metrics.

## 1. Structure Parsing & Uncertainty Separation

- **Formats**: Bounded `.cif` (mmCIF) and `.pdb` parsers enforcing a `50 MiB` byte limit and `250,000` atom ceiling (`ERR_INPUT_TOO_LARGE`).
- **Confidence Separation**: Experimental structures carry `confidenceKind = "experimental_b_factor"` (crystallographic B-factor), whereas computed models carry `"prediction_plddt"` (`0..100` pLDDT). These scales are never mixed in downstream reports.
- **Chain Disambiguation**: Multi-polymer inputs require an explicit chain identifier (`--ref-chain` / `--mob-chain`); omitting it triggers `ERR_AMBIGUOUS_CHAIN` listing candidate chains rather than silently picking chain A.
- **PAE Validation**: Predicted Aligned Error matrices are validated as square $N \times N$ matrices matching the mobile polymer coordinate sequence length.

## 2. Sequence Alignment & Kabsch `float64` Superposition

- Extracted polymer residues between reference and mobile chains are aligned using deterministic Needleman-Wunsch with deterministic residue-ID tie-breaking.
- Rigid-body alignment uses IEEE-754 double-precision (`f64`) Kabsch covariance/eigendecomposition, enforcing a proper rotation ($\det(R) = +1$, reflection guard) yielding row-major 4x4 transform matrix (`mobile_to_reference`).
- Coverage denominators distinguish `declared_polymer_sequence` (mmCIF `_entity_poly_seq`) from `coordinate_only`.

### Verified Benchmark Parity (`benchmarks/run_benchmarks.mjs`)

| Pair | Matched $\text{C}\alpha$ | RMSD ($\text{\AA}$) | Native vs. Wasm $\|\Delta\text{RMSD}\|$ |
|---|---|---|---|
| `3HS4.cif` (A) vs `AF-P00918-F1-model_v6.cif` (A) + PAE | `257` | `0.368394` | `0.00e+0` |
| `3HS4.pdb` (A) vs `AF-P00918-F1-model_v6.pdb` (A) | `257` | `0.368394` | `0.00e+0` |
| `1UBQ.cif` (A) vs `AF-P0CG48-F1-model_v6.cif` (A) | `38` | `3.691604` | `0.00e+0` |
| `1A3N.cif` (B) vs `AF-P68871-F1-model_v6.cif` (A) | `145` | `0.519695` | `0.00e+0` |
| `1LZ1.cif` (A) vs `AF-P61626-F1-model_v6.cif` (A) | `130` | `0.421539` | `0.00e+0` |
| Synthetic 40-C$\alpha$ rigid transform | `40` | `0.000000` | `0.00e+0` |

Native vs. Wasm Ramachandran backbone angles across the 5 structure fixtures match within `<= 1.01e-12` degrees with `0` contact-map mismatches.

## 3. Small-Molecule Descriptors & RDKit WASM

- **Zero-dependency Rust SMILES engine** (`crates/synlexa-bio-core/src/chemistry.rs`) computes deterministic exact formulas, average/exact masses, Lipinski/Veber rules, TPSA, Crippen LogP, and 2D ring/chain layout offline (`ΔMW <= 0.063 Da` against PubChem rounded molecular weight across the 6-compound benchmark panel: Acetazolamide, Dorzolamide, Imatinib, Aspirin, Caffeine, Metformin).
- **Web IDE RDKit WASM (`@rdkit/rdkit`, BSD-3-Clause)** additionally computes canonical SMILES, InChI, InChIKey, Murcko-style substructure matching (SMARTS), V2000 MOL parsing for the 2D sketcher, Morgan fingerprints, Labute ASA, and PAINS/Brenk structural alerts inside `rdkit.worker.ts`.

## 4. Peptide, CRISPR & Literature Provenance

- **Literature/Trial APIs**: Queries live public Europe PMC and ClinicalTrials.gov API v2 endpoints directly from the user's client, keeping returned PMIDs, PMCIDs, DOIs, NCT IDs, source URLs, and UTC retrieval timestamps verbatim without fabrication (`null` when absent).
