//! WebAssembly ABI v1 (`wasm32-unknown-unknown`) exports for Synlexa Studio.

use std::cell::RefCell;
use std::slice;

use synlexa_bio_core::chemistry::analyze_molecule_smiles;
use synlexa_bio_core::genomics::analyze_gene_crispr;
use synlexa_bio_core::json::{parse_json, JsonValue};
use synlexa_bio_core::peptide::analyze_peptide;
use synlexa_bio_core::ramachandran::analyze_ramachandran;
use synlexa_bio_core::structure::{parse_structure, SourceTypeHint};
use synlexa_bio_core::superpose::{compare_structures, select_chain_index, StructureMeta};
use synlexa_bio_core::CoreError;

thread_local! {
    static LAST_RESULT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static LAST_LEN: RefCell<usize> = const { RefCell::new(0) };
}

#[no_mangle]
pub extern "C" fn abi_version() -> u32 {
    1
}

#[no_mangle]
pub extern "C" fn last_result_len() -> usize {
    LAST_LEN.with(|l| *l.borrow())
}

#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut buf = Vec::<u8>::with_capacity(len.max(1));
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

/// # Safety
/// `ptr` must have been allocated by `alloc(len)`.
#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    if ptr.is_null() {
        return;
    }
    let _ = Vec::from_raw_parts(ptr, 0, len.max(1));
}

fn store_response(bytes: Vec<u8>) -> *const u8 {
    let len = bytes.len();
    LAST_LEN.with(|l| *l.borrow_mut() = len);
    LAST_RESULT.with(|cell| {
        let mut slot = cell.borrow_mut();
        *slot = bytes;
        slot.as_ptr()
    })
}

fn make_error_envelope(op: &str, err: &CoreError) -> Vec<u8> {
    JsonValue::object(vec![
        ("ok", JsonValue::Bool(false)),
        ("op", JsonValue::String(op.to_string())),
        ("data", JsonValue::Null),
        ("error", err.to_json()),
    ])
    .to_json_string()
    .into_bytes()
}

fn make_ok_envelope(op: &str, data: JsonValue) -> Vec<u8> {
    JsonValue::object(vec![
        ("ok", JsonValue::Bool(true)),
        ("op", JsonValue::String(op.to_string())),
        ("data", data),
        ("error", JsonValue::Null),
    ])
    .to_json_string()
    .into_bytes()
}

fn extract_meta(obj: Option<&JsonValue>) -> StructureMeta {
    let Some(m) = obj else {
        return StructureMeta::default();
    };
    StructureMeta {
        source_url: m
            .get("sourceUrl")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        data_revision: m
            .get("dataRevision")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        retrieved_at_utc: m
            .get("retrievedAtUtc")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        license: m
            .get("license")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    }
}

fn dispatch_op(op: &str, payload: &JsonValue) -> Result<JsonValue, CoreError> {
    match op {
        "inspect_structure" => {
            let content = payload
                .get("content")
                .and_then(|v| v.as_str())
                .ok_or_else(|| {
                    CoreError::new("ERR_INVALID_INPUT", "Missing payload.content string")
                })?;
            let hint = SourceTypeHint::from_opt_str(
                payload.get("sourceTypeHint").and_then(|v| v.as_str()),
            );
            let parsed = parse_structure(content, hint)?;
            Ok(parsed.to_inspect_json())
        }
        "compare_structures" => {
            let ref_label = payload
                .get("refLabel")
                .and_then(|v| v.as_str())
                .unwrap_or("reference");
            let ref_content = payload
                .get("refContent")
                .and_then(|v| v.as_str())
                .ok_or_else(|| {
                    CoreError::new("ERR_INVALID_INPUT", "Missing payload.refContent")
                })?;
            let ref_chain = payload.get("refChain").and_then(|v| v.as_str());
            let ref_meta = extract_meta(payload.get("refMeta"));

            let mob_label = payload
                .get("mobLabel")
                .and_then(|v| v.as_str())
                .unwrap_or("mobile");
            let mob_content = payload
                .get("mobContent")
                .and_then(|v| v.as_str())
                .ok_or_else(|| {
                    CoreError::new("ERR_INVALID_INPUT", "Missing payload.mobContent")
                })?;
            let mob_chain = payload.get("mobChain").and_then(|v| v.as_str());
            let mob_meta = extract_meta(payload.get("mobMeta"));
            let pae_json = payload.get("paeJson").and_then(|v| v.as_str());
            let created_at = payload
                .get("createdAtUtc")
                .and_then(|v| v.as_str())
                .unwrap_or("1970-01-01T00:00:00Z");

            let ref_parsed = parse_structure(ref_content, SourceTypeHint::Auto)?;
            let mob_parsed = parse_structure(mob_content, SourceTypeHint::Auto)?;
            let cmp = compare_structures(
                ref_label,
                ref_parsed,
                ref_chain,
                ref_meta,
                mob_label,
                mob_parsed,
                mob_chain,
                mob_meta,
                pae_json,
                "wasm-rust",
                created_at,
            )?;
            Ok(cmp.to_json())
        }
        "analyze_peptide" => {
            let sequence = payload
                .get("sequence")
                .and_then(|v| v.as_str())
                .ok_or_else(|| {
                    CoreError::new("ERR_INVALID_INPUT", "Missing payload.sequence")
                })?;
            let mutations: Vec<String> = payload
                .get("mutations")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|item| item.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            let slice_start = payload.get("sliceStart").and_then(|v| v.as_usize());
            let slice_end = payload.get("sliceEnd").and_then(|v| v.as_usize());
            let structure_content = payload.get("structureContent").and_then(|v| v.as_str());
            let chain_id = payload.get("chainId").and_then(|v| v.as_str());
            let focus_seq_id = payload
                .get("focusSeqId")
                .and_then(|v| v.as_i64())
                .map(|v| v as i32);

            let res = analyze_peptide(
                sequence,
                &mutations,
                slice_start,
                slice_end,
                structure_content,
                chain_id,
                focus_seq_id,
            )?;
            Ok(res.to_json())
        }
        "analyze_gene_crispr" => {
            let transcript_id = payload.get("transcriptId").and_then(|v| v.as_str());
            let coding_dna = payload.get("codingDna").and_then(|v| v.as_str());
            let target_codon = payload
                .get("targetCodonIndex")
                .and_then(|v| v.as_usize())
                .unwrap_or(1);
            let base_edit = payload.get("baseEditIndex").and_then(|v| v.as_usize());
            let new_base = payload.get("newBase").and_then(|v| v.as_str());
            let nuclease = payload.get("nuclease").and_then(|v| v.as_str());

            let res = analyze_gene_crispr(
                transcript_id,
                coding_dna,
                target_codon,
                base_edit,
                new_base,
                nuclease,
            )?;
            Ok(res.to_json())
        }
        "analyze_molecule_smiles" => {
            let name = payload.get("name").and_then(|v| v.as_str());
            let smiles = payload
                .get("smiles")
                .and_then(|v| v.as_str())
                .ok_or_else(|| {
                    CoreError::new("ERR_INVALID_SMILES", "Missing payload.smiles")
                })?;
            let res = analyze_molecule_smiles(name, smiles)?;
            Ok(res.to_json())
        }
        "analyze_ramachandran" => {
            let content = payload
                .get("content")
                .and_then(|v| v.as_str())
                .ok_or_else(|| {
                    CoreError::new("ERR_INVALID_INPUT", "Missing payload.content string")
                })?;
            let chain_id = payload.get("chainId").and_then(|v| v.as_str());
            let res = analyze_ramachandran(content, chain_id)?;
            Ok(res.to_json())
        }
        other => Err(CoreError::new(
            "ERR_INVALID_INPUT",
            format!("Unsupported operation '{}'", other),
        )),
    }
}

/// # Safety
/// `req_ptr` must point to `req_len` valid readable bytes in Wasm linear memory.
#[no_mangle]
pub unsafe extern "C" fn invoke_json(req_ptr: *const u8, req_len: usize) -> *const u8 {
    if req_ptr.is_null() {
        let err = CoreError::new("ERR_INVALID_INPUT", "Null request pointer");
        return store_response(make_error_envelope("", &err));
    }
    let bytes = slice::from_raw_parts(req_ptr, req_len);
    let raw = match std::str::from_utf8(bytes) {
        Ok(s) => s,
        Err(_) => {
            let err = CoreError::new("ERR_INVALID_INPUT", "Request is not valid UTF-8");
            return store_response(make_error_envelope("", &err));
        }
    };
    let req = match parse_json(raw) {
        Ok(v) => v,
        Err(e) => {
            let err = CoreError::new("ERR_INVALID_INPUT", e.to_string());
            return store_response(make_error_envelope("", &err));
        }
    };
    let op = req
        .get("op")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let payload = req
        .get("payload")
        .cloned()
        .unwrap_or_else(|| JsonValue::object(vec![]));

    match dispatch_op(&op, &payload) {
        Ok(data) => store_response(make_ok_envelope(&op, data)),
        Err(err) => store_response(make_error_envelope(&op, &err)),
    }
}

/// Fast binary path writing packed `[x, y, z, b_or_plddt, ...]` into `out_ptr`.
/// Returns number of C-alpha atoms written (up to `max_atoms`).
/// # Safety
/// `req_ptr` must point to `req_len` readable bytes; `out_ptr` must point to `max_atoms * 4` writable `f64`s.
#[no_mangle]
pub unsafe extern "C" fn extract_ca_coords_f64(
    req_ptr: *const u8,
    req_len: usize,
    out_ptr: *mut f64,
    max_atoms: usize,
) -> usize {
    if req_ptr.is_null() || out_ptr.is_null() || max_atoms == 0 {
        return 0;
    }
    let bytes = slice::from_raw_parts(req_ptr, req_len);
    let Ok(raw) = std::str::from_utf8(bytes) else {
        return 0;
    };
    let Ok(req) = parse_json(raw) else {
        return 0;
    };
    let Some(content) = req.get("content").and_then(|v| v.as_str()) else {
        return 0;
    };
    let chain_req = req.get("chainId").and_then(|v| v.as_str());
    let Ok(parsed) = parse_structure(content, SourceTypeHint::Auto) else {
        return 0;
    };
    let Ok(chain_idx) = select_chain_index(&parsed, chain_req, "extract_ca") else {
        return 0;
    };
    let out_slice = slice::from_raw_parts_mut(out_ptr, max_atoms * 4);
    let mut written = 0usize;
    for res in &parsed.chains[chain_idx].residues {
        if written >= max_atoms {
            break;
        }
        if let Some([x, y, z]) = res.ca {
            let base = written * 4;
            out_slice[base] = x;
            out_slice[base + 1] = y;
            out_slice[base + 2] = z;
            out_slice[base + 3] = res.b_or_plddt.unwrap_or(0.0);
            written += 1;
        }
    }
    written
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wasm_dispatch_analyze_ramachandran() {
        let pdb = "\
ATOM      1  N   ALA A   1       0.000   0.000   0.000  1.00 10.00           N  
ATOM      2  CA  ALA A   1       1.458   0.000   0.000  1.00 10.00           C  
ATOM      3  C   ALA A   1       2.009   1.420   0.000  1.00 10.00           C  
ATOM      4  N   GLY A   2       1.450   2.550   0.500  1.00 10.00           N  
ATOM      5  CA  GLY A   2       1.950   3.850   0.950  1.00 10.00           C  
ATOM      6  C   GLY A   2       3.400   3.950   1.350  1.00 10.00           C  
";
        let payload = JsonValue::object(vec![("content", JsonValue::String(pdb.to_string()))]);
        let res = dispatch_op("analyze_ramachandran", &payload).unwrap();
        assert_eq!(res.get("chainId").and_then(|v| v.as_str()), Some("A"));
        assert_eq!(res.get("residueCount").and_then(|v| v.as_usize()), Some(2));
        assert!(res.get("secondaryCounts").is_some());
        assert!(res.get("regionCounts").is_some());
        assert!(res.get("contactPairs").is_some());
    }
}
