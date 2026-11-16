//! Bounded PDB and mmCIF structure parser plus AlphaFold PAE validator.

use std::collections::HashMap;

use crate::json::{opt_f64, opt_usize, parse_json, JsonValue};
use crate::sha256::sha256_hex;
use crate::CoreError;

pub const MAX_INPUT_BYTES: usize = 50 * 1024 * 1024;
pub const MAX_ATOMS: usize = 250_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StructureFormat {
    Mmcif,
    Pdb,
}

impl StructureFormat {
    pub fn as_str(self) -> &'static str {
        match self {
            StructureFormat::Mmcif => "mmcif",
            StructureFormat::Pdb => "pdb",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfidenceKind {
    ExperimentalBFactor,
    PredictionPlddt,
    None,
}

impl ConfidenceKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ConfidenceKind::ExperimentalBFactor => "experimental_b_factor",
            ConfidenceKind::PredictionPlddt => "prediction_plddt",
            ConfidenceKind::None => "none",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceTypeHint {
    Auto,
    Experimental,
    Prediction,
}

impl SourceTypeHint {
    pub fn from_opt_str(s: Option<&str>) -> Self {
        match s.map(|v| v.trim().to_ascii_lowercase()).as_deref() {
            Some("experimental") => SourceTypeHint::Experimental,
            Some("prediction") => SourceTypeHint::Prediction,
            _ => SourceTypeHint::Auto,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AtomRecord {
    pub name: String,
    pub element: String,
    pub xyz: [f64; 3],
    pub occupancy: f64,
    pub b_or_plddt: f64,
    pub alt_loc: char,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Residue {
    pub seq_id: i32,
    pub label_seq_id: Option<i32>,
    pub ins_code: String,
    pub res_name3: String,
    pub res_code1: char,
    pub ca: Option<[f64; 3]>,
    pub ca_alt_loc: char,
    pub ca_occupancy: f64,
    pub b_or_plddt: Option<f64>,
    pub atoms: Vec<AtomRecord>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Chain {
    pub chain_id: String,
    pub auth_chain_id: String,
    pub residues: Vec<Residue>,
    pub declared_sequence: Option<String>,
    pub has_alt_locs: bool,
    pub has_insertion_codes: bool,
}

impl Chain {
    pub fn observed_ca_count(&self) -> usize {
        self.residues.iter().filter(|r| r.ca.is_some()).count()
    }

    pub fn observed_sequence_1letter(&self) -> String {
        self.residues
            .iter()
            .filter(|r| r.ca.is_some())
            .map(|r| r.res_code1)
            .collect()
    }

    pub fn declared_seq_length(&self) -> Option<usize> {
        self.declared_sequence.as_ref().map(|s| s.len())
    }

    pub fn denominator_kind(&self) -> &'static str {
        if self.declared_sequence.is_some() {
            "declared_polymer_sequence"
        } else {
            "coordinate_only"
        }
    }

    pub fn model_residue_count(&self) -> usize {
        self.declared_seq_length()
            .unwrap_or_else(|| self.observed_ca_count())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Ligand {
    pub res_name: String,
    pub chain_id: String,
    pub seq_id: i32,
    pub ins_code: String,
    pub atoms: Vec<AtomRecord>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedStructure {
    pub sha256: String,
    pub format: StructureFormat,
    pub model_index: i32,
    pub confidence_kind: ConfidenceKind,
    pub chains: Vec<Chain>,
    pub ligands: Vec<Ligand>,
}

impl ParsedStructure {
    pub fn to_inspect_json(&self) -> JsonValue {
        let chains_json: Vec<JsonValue> = self
            .chains
            .iter()
            .map(|c| {
                let obs_ca = c.observed_ca_count();
                let decl_len = c.declared_seq_length();
                let seq_1 = c
                    .declared_sequence
                    .clone()
                    .unwrap_or_else(|| c.observed_sequence_1letter());
                let res_json: Vec<JsonValue> = c
                    .residues
                    .iter()
                    .map(|r| {
                        let ca_val = match r.ca {
                            Some([x, y, z]) => JsonValue::Array(vec![
                                JsonValue::Number(x),
                                JsonValue::Number(y),
                                JsonValue::Number(z),
                            ]),
                            None => JsonValue::Null,
                        };
                        JsonValue::object(vec![
                            ("seqId", JsonValue::Number(r.seq_id as f64)),
                            ("insCode", JsonValue::String(r.ins_code.clone())),
                            ("resName3", JsonValue::String(r.res_name3.clone())),
                            ("resCode1", JsonValue::String(r.res_code1.to_string())),
                            ("ca", ca_val),
                            ("bOrPlddt", opt_f64(r.b_or_plddt)),
                        ])
                    })
                    .collect();
                JsonValue::object(vec![
                    ("chainId", JsonValue::String(c.chain_id.clone())),
                    ("authChainId", JsonValue::String(c.auth_chain_id.clone())),
                    ("observedCaCount", JsonValue::Number(obs_ca as f64)),
                    ("declaredSeqLength", opt_usize(decl_len)),
                    (
                        "denominatorKind",
                        JsonValue::String(c.denominator_kind().to_string()),
                    ),
                    ("sequence1Letter", JsonValue::String(seq_1)),
                    ("hasAltLocs", JsonValue::Bool(c.has_alt_locs)),
                    (
                        "hasInsertionCodes",
                        JsonValue::Bool(c.has_insertion_codes),
                    ),
                    ("residues", JsonValue::Array(res_json)),
                ])
            })
            .collect();

        let ligands_json: Vec<JsonValue> = self
            .ligands
            .iter()
            .map(|lig| {
                let atoms_json: Vec<JsonValue> = lig
                    .atoms
                    .iter()
                    .map(|a| {
                        JsonValue::object(vec![
                            ("name", JsonValue::String(a.name.clone())),
                            ("element", JsonValue::String(a.element.clone())),
                            (
                                "xyz",
                                JsonValue::Array(vec![
                                    JsonValue::Number(a.xyz[0]),
                                    JsonValue::Number(a.xyz[1]),
                                    JsonValue::Number(a.xyz[2]),
                                ]),
                            ),
                        ])
                    })
                    .collect();
                JsonValue::object(vec![
                    ("resName", JsonValue::String(lig.res_name.clone())),
                    ("chainId", JsonValue::String(lig.chain_id.clone())),
                    ("seqId", JsonValue::Number(lig.seq_id as f64)),
                    ("atoms", JsonValue::Array(atoms_json)),
                ])
            })
            .collect();

        JsonValue::object(vec![
            ("sha256", JsonValue::String(self.sha256.clone())),
            (
                "format",
                JsonValue::String(self.format.as_str().to_string()),
            ),
            ("modelIndex", JsonValue::Number(self.model_index as f64)),
            (
                "confidenceKind",
                JsonValue::String(self.confidence_kind.as_str().to_string()),
            ),
            ("chains", JsonValue::Array(chains_json)),
            ("ligands", JsonValue::Array(ligands_json)),
        ])
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PaeValidation {
    pub status: &'static str, // "valid" | "missing" | "incompatible_shape"
    pub size: usize,
    pub max_pae: Option<f64>,
    pub matrix: Vec<Vec<f64>>,
}

impl PaeValidation {
    pub fn to_summary_json(&self) -> JsonValue {
        JsonValue::object(vec![
            ("status", JsonValue::String(self.status.to_string())),
            ("size", JsonValue::Number(self.size as f64)),
            ("maxPae", opt_f64(self.max_pae)),
        ])
    }
}

pub fn validate_pae_json(
    pae_json: Option<&str>,
    expected_residues: usize,
) -> PaeValidation {
    let raw = match pae_json {
        Some(s) if !s.trim().is_empty() => s.trim(),
        _ => {
            return PaeValidation {
                status: "missing",
                size: 0,
                max_pae: None,
                matrix: Vec::new(),
            }
        }
    };

    let parsed = match parse_json(raw) {
        Ok(v) => v,
        Err(_) => {
            return PaeValidation {
                status: "incompatible_shape",
                size: 0,
                max_pae: None,
                matrix: Vec::new(),
            }
        }
    };

    let entry = match &parsed {
        JsonValue::Array(items) => match items.first() {
            Some(first) => first,
            None => {
                return PaeValidation {
                    status: "incompatible_shape",
                    size: 0,
                    max_pae: None,
                    matrix: Vec::new(),
                }
            }
        },
        JsonValue::Object(_) => &parsed,
        _ => {
            return PaeValidation {
                status: "incompatible_shape",
                size: 0,
                max_pae: None,
                matrix: Vec::new(),
            }
        }
    };

    let max_pae = entry
        .get("max_predicted_aligned_error")
        .and_then(|v| v.as_f64());

    let matrix_arr = match entry.get("predicted_aligned_error").and_then(|v| v.as_array()) {
        Some(arr) => arr,
        None => {
            return PaeValidation {
                status: "incompatible_shape",
                size: 0,
                max_pae,
                matrix: Vec::new(),
            }
        }
    };

    let n = matrix_arr.len();
    if n == 0 || n != expected_residues {
        return PaeValidation {
            status: "incompatible_shape",
            size: n,
            max_pae,
            matrix: Vec::new(),
        };
    }

    let mut matrix = Vec::with_capacity(n);
    for row_val in matrix_arr {
        let row_arr = match row_val.as_array() {
            Some(r) if r.len() == n => r,
            _ => {
                return PaeValidation {
                    status: "incompatible_shape",
                    size: n,
                    max_pae,
                    matrix: Vec::new(),
                }
            }
        };
        let mut row = Vec::with_capacity(n);
        for cell in row_arr {
            match cell.as_f64() {
                Some(v) if v.is_finite() => row.push(v),
                _ => {
                    return PaeValidation {
                        status: "incompatible_shape",
                        size: n,
                        max_pae,
                        matrix: Vec::new(),
                    }
                }
            }
        }
        matrix.push(row);
    }

    PaeValidation {
        status: "valid",
        size: n,
        max_pae,
        matrix,
    }
}

pub fn res3_to_1(res3: &str) -> char {
    match res3.trim().to_ascii_uppercase().as_str() {
        "ALA" => 'A',
        "ARG" => 'R',
        "ASN" => 'N',
        "ASP" => 'D',
        "CYS" => 'C',
        "GLN" => 'Q',
        "GLU" => 'E',
        "GLY" => 'G',
        "HIS" => 'H',
        "ILE" => 'I',
        "LEU" => 'L',
        "LYS" => 'K',
        "MET" | "MSE" => 'M',
        "PHE" => 'F',
        "PRO" => 'P',
        "SER" => 'S',
        "THR" => 'T',
        "TRP" => 'W',
        "TYR" => 'Y',
        "VAL" => 'V',
        "SEC" => 'U',
        "PYL" => 'O',
        "ASX" => 'B',
        "GLX" => 'Z',
        _ => 'X',
    }
}

fn is_water(res_name: &str) -> bool {
    matches!(
        res_name.trim().to_ascii_uppercase().as_str(),
        "HOH" | "DOD" | "WAT" | "H2O"
    )
}

fn is_better_alt_loc(new_alt: char, new_occ: f64, cur_alt: char, cur_occ: f64) -> bool {
    let new_blank = new_alt == ' ';
    let cur_blank = cur_alt == ' ';
    if new_blank != cur_blank {
        return new_blank;
    }
    if (new_occ - cur_occ).abs() > 1e-6 {
        return new_occ > cur_occ;
    }
    if new_alt == 'A' && cur_alt != 'A' {
        return true;
    }
    if cur_alt == 'A' && new_alt != 'A' {
        return false;
    }
    new_alt < cur_alt
}

fn upsert_atom(atoms: &mut Vec<AtomRecord>, candidate: AtomRecord) {
    if let Some(existing) = atoms.iter_mut().find(|a| a.name == candidate.name) {
        if is_better_alt_loc(
            candidate.alt_loc,
            candidate.occupancy,
            existing.alt_loc,
            existing.occupancy,
        ) {
            *existing = candidate;
        }
    } else {
        atoms.push(candidate);
    }
}

/// Parse a PDB or mmCIF string with strict size/atom bounds and confidence-type detection.
pub fn parse_structure(
    content: &str,
    hint: SourceTypeHint,
) -> Result<ParsedStructure, CoreError> {
    if content.len() > MAX_INPUT_BYTES {
        return Err(CoreError::new(
            "ERR_OVERSIZED_INPUT",
            format!(
                "Structure input exceeds {} byte limit (got {} bytes)",
                MAX_INPUT_BYTES,
                content.len()
            ),
        ));
    }
    if content.trim().is_empty() {
        return Err(CoreError::new(
            "ERR_MALFORMED_STRUCTURE",
            "Structure input is empty",
        ));
    }

    let sha256 = sha256_hex(content.as_bytes());
    let format = detect_format(content)?;

    match format {
        StructureFormat::Mmcif => parse_mmcif(content, sha256, hint),
        StructureFormat::Pdb => parse_pdb(content, sha256, hint),
    }
}

fn detect_format(content: &str) -> Result<StructureFormat, CoreError> {
    let mut saw_pdb_keyword = false;
    for line in content.lines().take(200) {
        let t = line.trim_start();
        if t.is_empty() || t.starts_with('#') {
            continue;
        }
        if t.starts_with("data_") || t.starts_with("loop_") || t.starts_with("_atom_site.") {
            return Ok(StructureFormat::Mmcif);
        }
        if t.starts_with("HEADER")
            || t.starts_with("TITLE")
            || t.starts_with("COMPND")
            || t.starts_with("SEQRES")
            || t.starts_with("MODEL ")
            || t.starts_with("ATOM  ")
            || t.starts_with("HETATM")
        {
            saw_pdb_keyword = true;
        }
    }
    if saw_pdb_keyword {
        return Ok(StructureFormat::Pdb);
    }
    // Scan full file for _atom_site. or ATOM/HETATM fallback
    if content.contains("_atom_site.") {
        return Ok(StructureFormat::Mmcif);
    }
    if content.lines().any(|l| l.starts_with("ATOM  ") || l.starts_with("HETATM")) {
        return Ok(StructureFormat::Pdb);
    }
    Err(CoreError::new(
        "ERR_MALFORMED_STRUCTURE",
        "Input is neither recognizable mmCIF nor PDB format",
    ))
}

#[derive(Debug, Clone)]
struct CifToken {
    text: String,
    quoted: bool,
}

fn tokenize_cif(content: &str) -> Result<Vec<CifToken>, CoreError> {
    let bytes = content.as_bytes();
    let len = bytes.len();
    let mut i = 0;
    let mut tokens = Vec::with_capacity(4096);

    while i < len {
        let b = bytes[i];
        // Skip whitespace
        if b == b' ' || b == b'\t' || b == b'\r' || b == b'\n' {
            i += 1;
            continue;
        }
        // Comment to end of line
        if b == b'#' {
            while i < len && bytes[i] != b'\n' {
                i += 1;
            }
            continue;
        }
        // Semicolon multiline text block at start of line
        if b == b';' && (i == 0 || bytes[i - 1] == b'\n' || bytes[i - 1] == b'\r') {
            i += 1;
            let start = i;
            let mut found_end = false;
            while i < len {
                if bytes[i] == b';' && (bytes[i - 1] == b'\n' || bytes[i - 1] == b'\r') {
                    let raw = &content[start..i];
                    let cleaned = raw.replace(['\r', '\n'], "");
                    tokens.push(CifToken {
                        text: cleaned,
                        quoted: true,
                    });
                    i += 1;
                    found_end = true;
                    break;
                }
                i += 1;
            }
            if !found_end {
                return Err(CoreError::new(
                    "ERR_MALFORMED_STRUCTURE",
                    "Unterminated mmCIF semicolon text field",
                ));
            }
            continue;
        }
        // Quoted string ('...' or "...")
        if b == b'\'' || b == b'"' {
            let quote = b;
            i += 1;
            let start = i;
            let mut found_end = false;
            while i < len {
                if bytes[i] == quote
                    && (i + 1 == len || matches!(bytes[i + 1], b' ' | b'\t' | b'\r' | b'\n'))
                {
                    tokens.push(CifToken {
                        text: content[start..i].to_string(),
                        quoted: true,
                    });
                    i += 1;
                    found_end = true;
                    break;
                }
                if bytes[i] == b'\n' {
                    break;
                }
                i += 1;
            }
            if !found_end {
                return Err(CoreError::new(
                    "ERR_MALFORMED_STRUCTURE",
                    "Unterminated quoted string in mmCIF",
                ));
            }
            continue;
        }
        // Unquoted token
        let start = i;
        while i < len && !matches!(bytes[i], b' ' | b'\t' | b'\r' | b'\n') {
            i += 1;
        }
        tokens.push(CifToken {
            text: content[start..i].to_string(),
            quoted: false,
        });
    }
    Ok(tokens)
}

fn is_cif_keyword(w: &str) -> bool {
    let lower = w.to_ascii_lowercase();
    lower == "loop_"
        || lower.starts_with("data_")
        || lower.starts_with("save_")
        || lower == "stop_"
        || lower == "global_"
}

fn clean_cif_seq(raw: &str) -> String {
    raw.chars()
        .filter(|c| c.is_ascii_alphabetic())
        .map(|c| c.to_ascii_uppercase())
        .collect()
}

struct ChainBuilder {
    chain_id: String,
    auth_chain_id: String,
    has_alt_locs: bool,
    has_insertion_codes: bool,
    residues: Vec<Residue>,
    res_index: HashMap<(i32, String), usize>,
}

impl ChainBuilder {
    fn new(chain_id: String, auth_chain_id: String) -> Self {
        Self {
            chain_id,
            auth_chain_id,
            has_alt_locs: false,
            has_insertion_codes: false,
            residues: Vec::new(),
            res_index: HashMap::new(),
        }
    }

    fn add_atom(
        &mut self,
        seq_id: i32,
        label_seq_id: Option<i32>,
        ins_code: String,
        res_name3: String,
        atom: AtomRecord,
    ) {
        if atom.alt_loc != ' ' {
            self.has_alt_locs = true;
        }
        if !ins_code.is_empty() {
            self.has_insertion_codes = true;
        }
        let key = (seq_id, ins_code.clone());
        let idx = if let Some(&existing_idx) = self.res_index.get(&key) {
            existing_idx
        } else {
            let new_idx = self.residues.len();
            self.res_index.insert(key, new_idx);
            self.residues.push(Residue {
                seq_id,
                label_seq_id,
                ins_code,
                res_name3: res_name3.clone(),
                res_code1: res3_to_1(&res_name3),
                ca: None,
                ca_alt_loc: ' ',
                ca_occupancy: -1.0,
                b_or_plddt: None,
                atoms: Vec::new(),
            });
            new_idx
        };

        let res = &mut self.residues[idx];
        if atom.name == "CA" {
            let should_replace = res.ca.is_none()
                || is_better_alt_loc(atom.alt_loc, atom.occupancy, res.ca_alt_loc, res.ca_occupancy);
            if should_replace {
                res.ca = Some(atom.xyz);
                res.ca_alt_loc = atom.alt_loc;
                res.ca_occupancy = atom.occupancy;
                res.b_or_plddt = Some(atom.b_or_plddt);
            }
        }
        upsert_atom(&mut res.atoms, atom);
    }
}

fn parse_mmcif(
    content: &str,
    sha256: String,
    hint: SourceTypeHint,
) -> Result<ParsedStructure, CoreError> {
    let tokens = tokenize_cif(content)?;
    let n = tokens.len();
    let mut i = 0;

    let mut is_alphafold_or_prediction = false;
    // entity_id -> (seq_one_letter, strand_ids)
    let mut entity_poly_seq_str: HashMap<String, String> = HashMap::new();
    let mut entity_poly_strands: HashMap<String, Vec<String>> = HashMap::new();
    // entity_id -> Vec<(num, mon_id)>
    let mut entity_poly_seq_rows: HashMap<String, Vec<(i32, String)>> = HashMap::new();

    // Chain builders keyed by chain_id (label_asym_id)
    let mut chain_order: Vec<String> = Vec::new();
    let mut chains_map: HashMap<String, ChainBuilder> = HashMap::new();
    // Chain -> entity_id observed in ATOM
    let mut chain_entity: HashMap<String, String> = HashMap::new();

    // Ligands keyed by (auth_or_label_chain, seq_id, ins_code, res_name)
    let mut ligand_order: Vec<(String, i32, String, String)> = Vec::new();
    let mut ligands_map: HashMap<(String, i32, String, String), Ligand> = HashMap::new();

    let mut atom_count: usize = 0;
    let mut first_model: Option<i32> = None;
    let mut any_nonzero_b = false;

    while i < n {
        let tok_ref = &tokens[i];
        let tok = &tok_ref.text;
        let lower = tok.to_ascii_lowercase();

        if !tok_ref.quoted && (lower.starts_with("data_af-") || lower.starts_with("data_mgyp")) {
            is_alphafold_or_prediction = true;
            i += 1;
            continue;
        }

        if !tok_ref.quoted && lower == "loop_" {
            i += 1;
            let mut cols: Vec<String> = Vec::new();
            while i < n {
                let col_tok = &tokens[i];
                if !col_tok.quoted && col_tok.text.starts_with('_') {
                    cols.push(col_tok.text.clone());
                    i += 1;
                } else {
                    break;
                }
            }
            if cols.is_empty() {
                continue;
            }
            let ncols = cols.len();
            let category = cols[0].split('.').next().unwrap_or("").to_ascii_lowercase();

            // Read rows belonging to this loop
            let mut row_vals: Vec<String> = Vec::with_capacity(ncols);
            while i < n {
                let w_tok = &tokens[i];
                let w = &w_tok.text;
                if !w_tok.quoted && ((w.starts_with('_') && w.contains('.')) || is_cif_keyword(w)) {
                    break;
                }
                row_vals.push(w.clone());
                i += 1;
                if row_vals.len() == ncols {
                    if category == "_entity_poly" {
                        let mut eid = String::new();
                        let mut seq_can = String::new();
                        let mut seq_raw = String::new();
                        let mut strands = String::new();
                        for (c_idx, col_name) in cols.iter().enumerate() {
                            let val = &row_vals[c_idx];
                            match col_name.as_str() {
                                "_entity_poly.entity_id" => eid = val.clone(),
                                "_entity_poly.pdbx_seq_one_letter_code_can" => {
                                    seq_can = clean_cif_seq(val)
                                }
                                "_entity_poly.pdbx_seq_one_letter_code" => {
                                    seq_raw = clean_cif_seq(val)
                                }
                                "_entity_poly.pdbx_strand_id" => strands = val.clone(),
                                _ => {}
                            }
                        }
                        let seq = if !seq_can.is_empty() { seq_can } else { seq_raw };
                        if !eid.is_empty() && !seq.is_empty() {
                            entity_poly_seq_str.insert(eid.clone(), seq);
                        }
                        if !eid.is_empty() && !strands.is_empty() && strands != "?" && strands != "."
                        {
                            let list = strands
                                .split(',')
                                .map(|s| s.trim().to_string())
                                .filter(|s| !s.is_empty())
                                .collect();
                            entity_poly_strands.insert(eid, list);
                        }
                    } else if category == "_entity_poly_seq" {
                        let mut eid = String::new();
                        let mut num: Option<i32> = None;
                        let mut mon = String::new();
                        for (c_idx, col_name) in cols.iter().enumerate() {
                            let val = &row_vals[c_idx];
                            match col_name.as_str() {
                                "_entity_poly_seq.entity_id" => eid = val.clone(),
                                "_entity_poly_seq.num" => num = val.parse().ok(),
                                "_entity_poly_seq.mon_id" => mon = val.clone(),
                                _ => {}
                            }
                        }
                        if !eid.is_empty() && !mon.is_empty() {
                            entity_poly_seq_rows
                                .entry(eid)
                                .or_default()
                                .push((num.unwrap_or(0), mon));
                        }
                    } else if category == "_ma_qa_metric" || category == "_ma_qa_metric_local" {
                        for val in &row_vals {
                            if val.eq_ignore_ascii_case("pLDDT") {
                                is_alphafold_or_prediction = true;
                            }
                        }
                    } else if category == "_atom_site" {
                        atom_count += 1;
                        if atom_count > MAX_ATOMS {
                            return Err(CoreError::new(
                                "ERR_OVERSIZED_INPUT",
                                format!("Atom count exceeds maximum of {}", MAX_ATOMS),
                            ));
                        }
                        process_mmcif_atom_row(
                            &cols,
                            &row_vals,
                            &mut first_model,
                            &mut any_nonzero_b,
                            &mut chain_order,
                            &mut chains_map,
                            &mut chain_entity,
                            &mut ligand_order,
                            &mut ligands_map,
                        )?;
                    }
                    row_vals.clear();
                }
            }
            if !row_vals.is_empty() {
                return Err(CoreError::new(
                    "ERR_MALFORMED_STRUCTURE",
                    format!("Incomplete mmCIF loop row in category {}", category),
                ));
            }
            continue;
        }

        // Single tag-value pair
        if !tok_ref.quoted && tok.starts_with('_') && i + 1 < n {
            let tag = tok.to_ascii_lowercase();
            let val = &tokens[i + 1].text;
            if tag == "_entry.id"
                && (val.to_ascii_uppercase().starts_with("AF-")
                    || val.to_ascii_uppercase().starts_with("MGYP"))
            {
                is_alphafold_or_prediction = true;
            } else if tag == "_struct.title"
                && (val.to_ascii_lowercase().contains("alphafold")
                    || val.to_ascii_lowercase().contains("esmfold")
                    || val.to_ascii_lowercase().contains("colabfold"))
            {
                is_alphafold_or_prediction = true;
            } else if tag.starts_with("_entity_poly.") {
                // Single-row _entity_poly without loop_
                if tag == "_entity_poly.pdbx_seq_one_letter_code_can"
                    || tag == "_entity_poly.pdbx_seq_one_letter_code"
                {
                    let seq = clean_cif_seq(val);
                    if !seq.is_empty() {
                        // Prefer canonical when both appear
                        if tag == "_entity_poly.pdbx_seq_one_letter_code_can"
                            || !entity_poly_seq_str.contains_key("1")
                        {
                            entity_poly_seq_str.insert("1".to_string(), seq);
                        }
                    }
                } else if tag == "_entity_poly.pdbx_strand_id" && val != "?" && val != "." {
                    let list = val
                        .split(',')
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .collect();
                    entity_poly_strands.insert("1".to_string(), list);
                }
            }
            i += 2;
            continue;
        }

        i += 1;
    }

    // Also parse _entity_poly.entity_id properly if there were multiple single-row _entity_poly blocks
    // (For standard single-entity mmCIF like 3HS4 & AF-P00918, entity_id is "1").
    let mut chains: Vec<Chain> = Vec::with_capacity(chain_order.len());
    for cid in chain_order {
        if let Some(builder) = chains_map.remove(&cid) {
            let eid = chain_entity.get(&cid).cloned().unwrap_or_else(|| "1".to_string());
            let mut declared_seq = entity_poly_seq_str.get(&eid).cloned();
            if declared_seq.is_none() {
                // Match by strand ID
                for (e, strands) in &entity_poly_strands {
                    if strands.iter().any(|s| s == &builder.auth_chain_id || s == &builder.chain_id)
                    {
                        if let Some(s) = entity_poly_seq_str.get(e) {
                            declared_seq = Some(s.clone());
                            break;
                        }
                    }
                }
            }
            if declared_seq.is_none() {
                if let Some(rows) = entity_poly_seq_rows.get(&eid) {
                    let mut sorted = rows.clone();
                    sorted.sort_by_key(|(num, _)| *num);
                    let seq: String = sorted.iter().map(|(_, m)| res3_to_1(m)).collect();
                    if !seq.is_empty() {
                        declared_seq = Some(seq);
                    }
                }
            }
            let chain = Chain {
                chain_id: builder.chain_id,
                auth_chain_id: builder.auth_chain_id,
                residues: builder.residues,
                declared_sequence: declared_seq,
                has_alt_locs: builder.has_alt_locs,
                has_insertion_codes: builder.has_insertion_codes,
            };
            if chain.observed_ca_count() > 0 {
                chains.push(chain);
            }
        }
    }

    if chains.is_empty() {
        return Err(CoreError::new(
            "ERR_NO_COORDINATES",
            "No polymer C-alpha coordinates found in mmCIF input",
        ));
    }

    let ligands: Vec<Ligand> = ligand_order
        .into_iter()
        .filter_map(|k| ligands_map.remove(&k))
        .collect();

    let confidence_kind = match hint {
        SourceTypeHint::Experimental => {
            if any_nonzero_b {
                ConfidenceKind::ExperimentalBFactor
            } else {
                ConfidenceKind::None
            }
        }
        SourceTypeHint::Prediction => ConfidenceKind::PredictionPlddt,
        SourceTypeHint::Auto => {
            if is_alphafold_or_prediction {
                ConfidenceKind::PredictionPlddt
            } else if any_nonzero_b {
                ConfidenceKind::ExperimentalBFactor
            } else {
                ConfidenceKind::None
            }
        }
    };

    Ok(ParsedStructure {
        sha256,
        format: StructureFormat::Mmcif,
        model_index: first_model.unwrap_or(1),
        confidence_kind,
        chains,
        ligands,
    })
}

#[allow(clippy::too_many_arguments)]
fn process_mmcif_atom_row(
    cols: &[String],
    row: &[String],
    first_model: &mut Option<i32>,
    any_nonzero_b: &mut bool,
    chain_order: &mut Vec<String>,
    chains_map: &mut HashMap<String, ChainBuilder>,
    chain_entity: &mut HashMap<String, String>,
    ligand_order: &mut Vec<(String, i32, String, String)>,
    ligands_map: &mut HashMap<(String, i32, String, String), Ligand>,
) -> Result<(), CoreError> {
    let mut group_pdb = "";
    let mut type_symbol = "";
    let mut label_atom_id = "";
    let mut auth_atom_id = "";
    let mut label_alt_id = ".";
    let mut label_comp_id = "";
    let mut auth_comp_id = "";
    let mut label_asym_id = "";
    let mut auth_asym_id = "";
    let mut label_entity_id = "";
    let mut label_seq_id = "";
    let mut auth_seq_id = "";
    let mut ins_code = "";
    let mut x_str = "";
    let mut y_str = "";
    let mut z_str = "";
    let mut occ_str = "1.0";
    let mut b_str = "0.0";
    let mut model_str = "1";

    for (idx, col) in cols.iter().enumerate() {
        let val = row[idx].as_str();
        match col.as_str() {
            "_atom_site.group_PDB" => group_pdb = val,
            "_atom_site.type_symbol" => type_symbol = val,
            "_atom_site.label_atom_id" => label_atom_id = val,
            "_atom_site.auth_atom_id" => auth_atom_id = val,
            "_atom_site.label_alt_id" => label_alt_id = val,
            "_atom_site.label_comp_id" => label_comp_id = val,
            "_atom_site.auth_comp_id" => auth_comp_id = val,
            "_atom_site.label_asym_id" => label_asym_id = val,
            "_atom_site.auth_asym_id" => auth_asym_id = val,
            "_atom_site.label_entity_id" => label_entity_id = val,
            "_atom_site.label_seq_id" => label_seq_id = val,
            "_atom_site.auth_seq_id" => auth_seq_id = val,
            "_atom_site.pdbx_PDB_ins_code" => ins_code = val,
            "_atom_site.Cartn_x" => x_str = val,
            "_atom_site.Cartn_y" => y_str = val,
            "_atom_site.Cartn_z" => z_str = val,
            "_atom_site.occupancy" => occ_str = val,
            "_atom_site.B_iso_or_equiv" => b_str = val,
            "_atom_site.pdbx_PDB_model_num" => model_str = val,
            _ => {}
        }
    }

    let model_num: i32 = model_str.parse().unwrap_or(1);
    match *first_model {
        None => *first_model = Some(model_num),
        Some(m) if m != model_num => return Ok(()),
        _ => {}
    }

    let x: f64 = x_str.parse().map_err(|_| {
        CoreError::new("ERR_MALFORMED_STRUCTURE", "Invalid Cartn_x coordinate in mmCIF")
    })?;
    let y: f64 = y_str.parse().map_err(|_| {
        CoreError::new("ERR_MALFORMED_STRUCTURE", "Invalid Cartn_y coordinate in mmCIF")
    })?;
    let z: f64 = z_str.parse().map_err(|_| {
        CoreError::new("ERR_MALFORMED_STRUCTURE", "Invalid Cartn_z coordinate in mmCIF")
    })?;
    if !x.is_finite() || !y.is_finite() || !z.is_finite() {
        return Err(CoreError::new(
            "ERR_MALFORMED_STRUCTURE",
            "Non-finite coordinate in mmCIF",
        ));
    }

    let occupancy: f64 = occ_str.parse().unwrap_or(1.0);
    let b_or_plddt: f64 = b_str.parse().unwrap_or(0.0);
    if b_or_plddt.abs() > 1e-9 {
        *any_nonzero_b = true;
    }

    let atom_name = if !label_atom_id.is_empty() && label_atom_id != "?" && label_atom_id != "." {
        label_atom_id.to_string()
    } else {
        auth_atom_id.to_string()
    };
    let comp_id = if !label_comp_id.is_empty() && label_comp_id != "?" && label_comp_id != "." {
        label_comp_id.to_string()
    } else {
        auth_comp_id.to_string()
    };
    let chain_id = if !label_asym_id.is_empty() && label_asym_id != "?" && label_asym_id != "." {
        label_asym_id.to_string()
    } else if !auth_asym_id.is_empty() && auth_asym_id != "?" && auth_asym_id != "." {
        auth_asym_id.to_string()
    } else {
        "A".to_string()
    };
    let auth_chain = if !auth_asym_id.is_empty() && auth_asym_id != "?" && auth_asym_id != "." {
        auth_asym_id.to_string()
    } else {
        chain_id.clone()
    };

    let alt_loc = match label_alt_id {
        "." | "?" | "" => ' ',
        s => s.chars().next().unwrap_or(' '),
    };

    let ins = match ins_code {
        "." | "?" | "" => String::new(),
        s => s.to_string(),
    };

    let element = if !type_symbol.is_empty() && type_symbol != "?" && type_symbol != "." {
        type_symbol.to_string()
    } else {
        atom_name
            .chars()
            .take(1)
            .collect::<String>()
            .to_ascii_uppercase()
    };

    let parsed_label_seq: Option<i32> = label_seq_id.parse().ok();
    let parsed_auth_seq: Option<i32> = auth_seq_id.parse().ok();
    let seq_id = parsed_auth_seq.or(parsed_label_seq).unwrap_or(0);

    let atom = AtomRecord {
        name: atom_name,
        element,
        xyz: [x, y, z],
        occupancy,
        b_or_plddt,
        alt_loc,
    };

    if group_pdb == "HETATM" {
        if is_water(&comp_id) {
            return Ok(());
        }
        let key = (chain_id.clone(), seq_id, ins.clone(), comp_id.clone());
        if !ligands_map.contains_key(&key) {
            ligand_order.push(key.clone());
            ligands_map.insert(
                key.clone(),
                Ligand {
                    res_name: comp_id,
                    chain_id,
                    seq_id,
                    ins_code: ins,
                    atoms: Vec::new(),
                },
            );
        }
        if let Some(lig) = ligands_map.get_mut(&key) {
            upsert_atom(&mut lig.atoms, atom);
        }
        return Ok(());
    }

    // Polymer ATOM
    if !chains_map.contains_key(&chain_id) {
        chain_order.push(chain_id.clone());
        chains_map.insert(
            chain_id.clone(),
            ChainBuilder::new(chain_id.clone(), auth_chain),
        );
    }
    if !label_entity_id.is_empty() && label_entity_id != "?" && label_entity_id != "." {
        chain_entity
            .entry(chain_id.clone())
            .or_insert_with(|| label_entity_id.to_string());
    }
    if let Some(builder) = chains_map.get_mut(&chain_id) {
        builder.add_atom(seq_id, parsed_label_seq, ins, comp_id, atom);
    }

    Ok(())
}

fn slice_col(line: &str, start0: usize, end0: usize) -> &str {
    let bytes = line.as_bytes();
    if start0 >= bytes.len() {
        return "";
    }
    let end = end0.min(bytes.len());
    std::str::from_utf8(&bytes[start0..end]).unwrap_or("")
}

fn parse_pdb(
    content: &str,
    sha256: String,
    hint: SourceTypeHint,
) -> Result<ParsedStructure, CoreError> {
    let mut is_alphafold_or_prediction = false;
    let mut seqres_map: HashMap<String, String> = HashMap::new();
    let mut chain_order: Vec<String> = Vec::new();
    let mut chains_map: HashMap<String, ChainBuilder> = HashMap::new();

    let mut ligand_order: Vec<(String, i32, String, String)> = Vec::new();
    let mut ligands_map: HashMap<(String, i32, String, String), Ligand> = HashMap::new();

    let mut atom_count: usize = 0;
    let mut first_model: Option<i32> = None;
    let mut current_model: i32 = 1;
    let mut in_ignored_model = false;
    let mut any_nonzero_b = false;

    for line in content.lines() {
        if line.starts_with("TITLE")
            || line.starts_with("HEADER")
            || line.starts_with("REMARK")
            || line.starts_with("COMPND")
        {
            let lower = line.to_ascii_lowercase();
            if lower.contains("alphafold")
                || lower.contains("plddt")
                || lower.contains("colabfold")
                || lower.contains("esmfold")
            {
                is_alphafold_or_prediction = true;
            }
            continue;
        }

        if line.starts_with("SEQRES") {
            let chain_ch = slice_col(line, 11, 12).trim();
            let chain_id = if chain_ch.is_empty() { "A" } else { chain_ch };
            let residues_part = slice_col(line, 19, 70);
            let entry = seqres_map.entry(chain_id.to_string()).or_default();
            for token in residues_part.split_whitespace() {
                entry.push(res3_to_1(token));
            }
            continue;
        }

        if line.starts_with("MODEL ") {
            let num: i32 = slice_col(line, 10, 14).trim().parse().unwrap_or(1);
            current_model = num;
            if let Some(fm) = first_model {
                in_ignored_model = fm != num;
            } else {
                first_model = Some(num);
                in_ignored_model = false;
            }
            continue;
        }

        if line.starts_with("ENDMDL") {
            in_ignored_model = first_model.is_some();
            continue;
        }

        let is_atom = line.starts_with("ATOM  ");
        let is_het = line.starts_with("HETATM");
        if !is_atom && !is_het {
            continue;
        }

        atom_count += 1;
        if atom_count > MAX_ATOMS {
            return Err(CoreError::new(
                "ERR_OVERSIZED_INPUT",
                format!("Atom count exceeds maximum of {}", MAX_ATOMS),
            ));
        }

        if in_ignored_model {
            continue;
        }
        if first_model.is_none() {
            first_model = Some(current_model);
        }

        if line.len() < 54 {
            return Err(CoreError::new(
                "ERR_MALFORMED_STRUCTURE",
                "Truncated PDB ATOM/HETATM coordinate record",
            ));
        }

        let atom_name = slice_col(line, 12, 16).trim().to_string();
        let alt_loc = slice_col(line, 16, 17).chars().next().unwrap_or(' ');
        let res_name3 = slice_col(line, 17, 20).trim().to_string();
        let chain_raw = slice_col(line, 21, 22).trim();
        let chain_id = if chain_raw.is_empty() {
            "A".to_string()
        } else {
            chain_raw.to_string()
        };
        let seq_id: i32 = slice_col(line, 22, 26).trim().parse().map_err(|_| {
            CoreError::new("ERR_MALFORMED_STRUCTURE", "Invalid PDB residue sequence number")
        })?;
        let ins_raw = slice_col(line, 26, 27).trim();
        let ins_code = ins_raw.to_string();

        let x: f64 = slice_col(line, 30, 38).trim().parse().map_err(|_| {
            CoreError::new("ERR_MALFORMED_STRUCTURE", "Invalid PDB X coordinate")
        })?;
        let y: f64 = slice_col(line, 38, 46).trim().parse().map_err(|_| {
            CoreError::new("ERR_MALFORMED_STRUCTURE", "Invalid PDB Y coordinate")
        })?;
        let z: f64 = slice_col(line, 46, 54).trim().parse().map_err(|_| {
            CoreError::new("ERR_MALFORMED_STRUCTURE", "Invalid PDB Z coordinate")
        })?;
        if !x.is_finite() || !y.is_finite() || !z.is_finite() {
            return Err(CoreError::new(
                "ERR_MALFORMED_STRUCTURE",
                "Non-finite coordinate in PDB",
            ));
        }

        let occupancy: f64 = slice_col(line, 54, 60).trim().parse().unwrap_or(1.0);
        let b_or_plddt: f64 = slice_col(line, 60, 66).trim().parse().unwrap_or(0.0);
        if b_or_plddt.abs() > 1e-9 {
            any_nonzero_b = true;
        }
        let elem_raw = slice_col(line, 76, 78).trim();
        let element = if !elem_raw.is_empty() {
            elem_raw.to_string()
        } else {
            atom_name
                .chars()
                .find(|c| c.is_ascii_alphabetic())
                .map(|c| c.to_ascii_uppercase().to_string())
                .unwrap_or_else(|| "C".to_string())
        };

        let atom = AtomRecord {
            name: atom_name,
            element,
            xyz: [x, y, z],
            occupancy,
            b_or_plddt,
            alt_loc,
        };

        if is_het {
            if is_water(&res_name3) {
                continue;
            }
            let key = (chain_id.clone(), seq_id, ins_code.clone(), res_name3.clone());
            if !ligands_map.contains_key(&key) {
                ligand_order.push(key.clone());
                ligands_map.insert(
                    key.clone(),
                    Ligand {
                        res_name: res_name3,
                        chain_id,
                        seq_id,
                        ins_code,
                        atoms: Vec::new(),
                    },
                );
            }
            if let Some(lig) = ligands_map.get_mut(&key) {
                upsert_atom(&mut lig.atoms, atom);
            }
            continue;
        }

        if !chains_map.contains_key(&chain_id) {
            chain_order.push(chain_id.clone());
            chains_map.insert(
                chain_id.clone(),
                ChainBuilder::new(chain_id.clone(), chain_id.clone()),
            );
        }
        if let Some(builder) = chains_map.get_mut(&chain_id) {
            builder.add_atom(seq_id, None, ins_code, res_name3, atom);
        }
    }

    let mut chains: Vec<Chain> = Vec::with_capacity(chain_order.len());
    for cid in chain_order {
        if let Some(builder) = chains_map.remove(&cid) {
            let declared_seq = seqres_map.get(&cid).cloned();
            let chain = Chain {
                chain_id: builder.chain_id,
                auth_chain_id: builder.auth_chain_id,
                residues: builder.residues,
                declared_sequence: declared_seq,
                has_alt_locs: builder.has_alt_locs,
                has_insertion_codes: builder.has_insertion_codes,
            };
            if chain.observed_ca_count() > 0 {
                chains.push(chain);
            }
        }
    }

    if chains.is_empty() {
        return Err(CoreError::new(
            "ERR_NO_COORDINATES",
            "No polymer C-alpha coordinates found in PDB input",
        ));
    }

    let ligands: Vec<Ligand> = ligand_order
        .into_iter()
        .filter_map(|k| ligands_map.remove(&k))
        .collect();

    let confidence_kind = match hint {
        SourceTypeHint::Experimental => {
            if any_nonzero_b {
                ConfidenceKind::ExperimentalBFactor
            } else {
                ConfidenceKind::None
            }
        }
        SourceTypeHint::Prediction => ConfidenceKind::PredictionPlddt,
        SourceTypeHint::Auto => {
            if is_alphafold_or_prediction {
                ConfidenceKind::PredictionPlddt
            } else if any_nonzero_b {
                ConfidenceKind::ExperimentalBFactor
            } else {
                ConfidenceKind::None
            }
        }
    };

    Ok(ParsedStructure {
        sha256,
        format: StructureFormat::Pdb,
        model_index: first_model.unwrap_or(1),
        confidence_kind,
        chains,
        ligands,
    })
}
