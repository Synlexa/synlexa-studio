# Synlexa Studio Wasm ABI Contract v1 (`synlexa_bio_core.wasm`)

Target: `wasm32-unknown-unknown` (`crates/studio-wasm`, compiled to `apps/web/public/wasm/synlexa_bio_core.wasm`)
All functions operate deterministically with zero network/filesystem/DOM dependencies and return UTF-8 JSON payloads (and typed float64/uint32 coordinate buffers where requested).

## Exported Linear-Memory ABI Functions

1. `alloc(len: usize) -> *mut u8`
   Allocates `len` bytes in Wasm linear memory for caller writes.
2. `dealloc(ptr: *mut u8, len: usize)`
   Frees a buffer previously allocated via `alloc`.
3. `abi_version() -> u32`
   Returns `1`.
4. `last_result_len() -> usize`
   Returns the byte length of the UTF-8 buffer returned by the most recent call.
5. `invoke_json(req_ptr: *const u8, req_len: usize) -> *const u8`
   Takes a UTF-8 JSON request envelope and returns a pointer to a static/retained UTF-8 JSON response buffer of length `last_result_len()`.
   (Caller reads `Uint8Array(memory.buffer, ptr, last_result_len())` and decodes UTF-8.)
6. `extract_ca_coords_f64(req_ptr: *const u8, req_len: usize, out_ptr: *mut f64, max_atoms: usize) -> usize`
   Fast binary path writing packed `[x, y, z, b_or_plddt, ...]` (stride 4 `f64` per C-alpha) directly into a pre-allocated Wasm linear-memory `Float64Array` slice; returns atom count written.

## JSON Request / Response Envelope (`invoke_json`)

### Request Envelope
```json
{
  "op": "inspect_structure" | "compare_structures" | "analyze_peptide" | "analyze_gene_crispr" | "analyze_molecule_smiles" | "analyze_ramachandran",
  "payload": { ... }
}
```

### Response Envelope
```json
{
  "ok": true,
  "op": "...",
  "data": { ... },
  "error": null
}
```
On error:
```json
{
  "ok": false,
  "op": "...",
  "data": null,
  "error": {
    "code": "ERR_AMBIGUOUS_CHAIN" | "ERR_OVERSIZED_INPUT" | "ERR_MALFORMED_STRUCTURE" | "ERR_NO_COORDINATES" | "ERR_INVALID_SMILES" | "ERR_INVALID_INPUT",
    "message": "...",
    "details": { ... }
  }
}
```

## Operation Payloads & Outputs

### 1. `inspect_structure`
Payload:
`{ "label": string, "content": string, "sourceTypeHint"?: "experimental" | "prediction" | "auto", "sourceUrl"?: string, "dataRevision"?: string, "retrievedAtUtc"?: string, "license"?: string }`
Returns:
`{ "sha256": string, "format": "mmcif" | "pdb", "modelIndex": number, "confidenceKind": "experimental_b_factor" | "prediction_plddt" | "none", "chains": [{ "chainId": string, "authChainId": string, "observedCaCount": number, "declaredSeqLength": number | null, "denominatorKind": "declared_polymer_sequence" | "coordinate_only", "sequence1Letter": string, "hasAltLocs": boolean, "hasInsertionCodes": boolean, "residues": [{ "seqId": number, "insCode": string, "resName3": string, "resCode1": string, "ca": [number, number, number] | null, "bOrPlddt": number | null }] }], "ligands": [{ "resName": string, "chainId": string, "seqId": number, "atoms": [{ "name": string, "element": string, "xyz": [number, number, number] }] }] }`

### 2. `compare_structures`
Payload:
`{ "refLabel": string, "refContent": string, "refChain"?: string, "refMeta"?: object, "mobLabel": string, "mobContent": string, "mobChain"?: string, "mobMeta"?: object, "paeJson"?: string }`
- If a structure has >1 polymer chain and its chain parameter is omitted/empty, returns `ERR_AMBIGUOUS_CHAIN` with `details.chains`.
- Returns full `ComparisonResultV1` PLUS `refDisplayAtoms` / `mobTransformedCa` (`[[x,y,z], ...]`), `refContacts` (Zn/ligand coordination & pocket residues within 4.5 A), and validated `paeMatrixSummary` (`{ "status": "valid"|"missing"|"incompatible_shape", "size": number, "maxPae": number | null }`).

### 3. `analyze_peptide`
Payload:
`{ "sequence": string, "mutations"?: string[], "sliceStart"?: number, "sliceEnd"?: number, "structureContent"?: string, "chainId"?: string, "focusSeqId"?: number }`
Returns:
`{ "ruoNotice": string, "wildType": PeptideDescriptors, "engineered": PeptideDescriptors, "deltas": { "mwAverageDa": number, "mwMonoisotopicDa": number, "pi": number, "chargeAtPh74": number, "gravy": number, "stericVolumeDeltaA3": number }, "titrationCurve": [{ "ph": number, "wtCharge": number, "engCharge": number }], "gravyProfile": [{ "index": number, "res": string, "wtScore": number, "engScore": number }], "appliedMutations": [{ "notation": string, "pos": number, "from": string, "to": string, "notes": string[] }], "local3dContacts": [{ "seqId": number, "resName3": string, "distanceAngstrom": number }] }`

### 4. `analyze_gene_crispr`
Payload:
`{ "transcriptId"?: string, "codingDna"?: string, "targetCodonIndex": number, "baseEditIndex"?: number, "newBase"?: "A"|"C"|"G"|"T", "nuclease"?: "SpCas9"|"SaCas9"|"Cas12a" }`
Returns:
`{ "ruoNotice": string, "transcriptId": string, "geneSymbol": string, "assembly": string, "cdsLengthBp": number, "proteinLengthAa": number, "targetCodon": { "codonIndex1": number, "dnaStartBp1": number, "wtCodon": string, "wtAa": string, "editedCodon": string, "editedAa": string, "consequence": "synonymous"|"missense"|"nonsense"|"unchanged" }, "pamSites": [{ "nuclease": string, "pam": string, "strand": "+"|"-", "protospacer": string, "cutBp1": number, "distanceToTargetCodonBp": number, "gcPercent": number, "hasPolyT": boolean }] }`

### 5. `analyze_molecule_smiles`
Payload:
`{ "name"?: string, "smiles": string }`
Returns:
`{ "ruoNotice": string, "name": string, "smiles": string, "formula": string, "molecularWeight": number, "exactMass": number, "heavyAtomCount": number, "ringCount": number, "aromaticAtomCount": number, "hbd": number, "hba": number, "rotatableBonds": number, "tpsa": number, "crippenLogP": number, "lipinskiViolations": number, "veberCompliant": boolean, "layout2d": { "atoms": [{ "id": number, "element": string, "charge": number, "aromatic": boolean, "x": number, "y": number }], "bonds": [{ "from": number, "to": number, "order": 1|2|3|4 }] } }`

### 6. `analyze_ramachandran`
Payload:
`{ "content": string, "chainId"?: string }`
- Enforces `ERR_AMBIGUOUS_CHAIN` with `details.chains` if >1 polymer chain is present and `chainId` is omitted/empty.
Returns:
`{ "ruoNotice": string, "chainId": string, "authChainId": string, "format": "mmcif" | "pdb", "residueCount": number, "residues": [{ "seqId": number, "insCode": string, "resName3": string, "resCode1": string, "phiDeg": number | null, "psiDeg": number | null, "secondary": "helix" | "sheet" | "loop", "region": "favored" | "allowed" | "outlier" | "terminal" }], "secondaryCounts": { "helix": number, "sheet": number, "loop": number }, "regionCounts": { "favored": number, "allowed": number, "outlier": number }, "contactPairs": [[number, number, number]] }`
