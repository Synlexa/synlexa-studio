//! Native CLI & stdio MCP server for Synlexa Studio (`inspect`, `compare`, `peptide`, `gene`, `smiles`, `ramachandran`, `mcp`),
//! plus Synlexa Cloud sign-in (`login`, `whoami`, `usage`, `upgrade`, `logout`).

mod cloud;

use std::env;
use std::fs;
use std::io::{self, BufRead, Write};
use std::path::PathBuf;
use std::process;
use std::time::{SystemTime, UNIX_EPOCH};

use synlexa_bio_core::chemistry::analyze_molecule_smiles;
use synlexa_bio_core::genomics::analyze_gene_crispr;
use synlexa_bio_core::json::{parse_json, JsonValue};
use synlexa_bio_core::peptide::analyze_peptide;
use synlexa_bio_core::ramachandran::analyze_ramachandran;
use synlexa_bio_core::structure::{parse_structure, SourceTypeHint};
use synlexa_bio_core::superpose::{compare_structures, StructureMeta};
use synlexa_bio_core::{CoreError, RUO_NOTICE};

fn utc_now_iso8601() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Howard Hinnant civil-from-days algorithm
    let z = (secs / 86400) as i64 + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    let rem = secs % 86400;
    let hh = rem / 3600;
    let mm = (rem % 3600) / 60;
    let ss = rem % 60;
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year, m, d, hh, mm, ss
    )
}

fn read_text(path: &str) -> Result<String, CoreError> {
    fs::read_to_string(path).map_err(|e| {
        CoreError::new(
            "ERR_INVALID_INPUT",
            format!("Failed to read '{}': {}", path, e),
        )
    })
}

fn write_output(out_path: Option<&str>, text: &str) -> Result<(), CoreError> {
    if let Some(p) = out_path {
        fs::write(p, text).map_err(|e| {
            CoreError::new(
                "ERR_INVALID_INPUT",
                format!("Failed to write '{}': {}", p, e),
            )
        })?;
    } else {
        println!("{}", text);
    }
    Ok(())
}

fn take_opt(args: &[String], flag: &str) -> Option<String> {
    args.iter()
        .position(|a| a == flag)
        .and_then(|idx| args.get(idx + 1).cloned())
}

fn take_multi(args: &[String], flag: &str) -> Vec<String> {
    let mut vals = Vec::new();
    let mut i = 0;
    while i < args.len() {
        if args[i] == flag {
            if let Some(v) = args.get(i + 1) {
                for part in v.split(',') {
                    let trimmed = part.trim();
                    if !trimmed.is_empty() {
                        vals.push(trimmed.to_string());
                    }
                }
                i += 2;
                continue;
            }
        }
        i += 1;
    }
    vals
}

fn print_usage() {
    eprintln!(
        "Synlexa Studio CLI & MCP Server (Research-Use-Only)\n\
         Usage:\n\
         \x20 studio-cli inspect --input <path> [--hint auto|experimental|prediction] [--out <path>]\n\
         \x20 studio-cli compare --ref <path> [--ref-chain <id>] --mob <path> [--mob-chain <id>] [--pae <path>] [--out <path>]\n\
         \x20 studio-cli peptide --seq <sequence> [--mut <H94A,...>] [--slice-start <1>] [--slice-end <N>] [--structure <path>] [--chain <id>] [--focus <seqId>] [--out <path>]\n\
         \x20 studio-cli gene [--transcript <NM_000067.3>] [--dna <seq>] --codon <1-based> [--edit-bp <idx>] [--new-base <A|C|G|T>] [--nuclease <SpCas9|SaCas9|Cas12a|all>] [--out <path>]\n\
         \x20 studio-cli smiles --smiles <smiles> [--name <label>] [--out <path>]\n\
         \x20 studio-cli ramachandran --input <path> [--chain <id>] [--out <path>]\n\
         \x20 studio-cli mcp [--stdio]\n\
         \n\
         Synlexa Cloud account (local tools never need sign-in):\n\
         \x20 studio-cli login [--device] [--no-browser]\n\
         \x20 studio-cli whoami [--json]\n\
         \x20 studio-cli usage [--json]\n\
         \x20 studio-cli upgrade [--plan starter|pro|team]\n\
         \x20 studio-cli logout\n\
         \x20 studio-cli --version"
    );
}

fn resolve_vscdb_path() -> PathBuf {
    let home = env::var("HOME")
        .or_else(|_| env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".synlexa-studio").join("state.vscdb")
}

fn mcp_vault_status_json() -> JsonValue {
    let db_path = resolve_vscdb_path();
    let exists = db_path.exists();
    JsonValue::object(vec![
        ("dbPath", JsonValue::String(db_path.to_string_lossy().to_string())),
        ("tableName", JsonValue::String("ItemTable".to_string())),
        ("exists", JsonValue::Bool(exists)),
        ("encrypted", JsonValue::Bool(true)),
        ("cipher", JsonValue::String("vscdb-enc-v1 (machine-bound HMAC-SHA256)".to_string())),
        ("ruoNotice", JsonValue::String(RUO_NOTICE.to_string())),
    ])
}

fn schema_prop(ty: &str, desc: &str) -> JsonValue {
    JsonValue::object(vec![
        ("type", JsonValue::String(ty.to_string())),
        ("description", JsonValue::String(desc.to_string())),
    ])
}

fn mcp_tool_entry(name: &str, desc: &str, props: Vec<(&str, JsonValue)>, req: Vec<&str>) -> JsonValue {
    JsonValue::object(vec![
        ("name", JsonValue::String(name.to_string())),
        ("description", JsonValue::String(desc.to_string())),
        (
            "inputSchema",
            JsonValue::object(vec![
                ("type", JsonValue::String("object".to_string())),
                ("properties", JsonValue::object(props)),
                (
                    "required",
                    JsonValue::Array(req.into_iter().map(|s| JsonValue::String(s.to_string())).collect()),
                ),
            ]),
        ),
    ])
}

fn mcp_tools_list() -> JsonValue {
    JsonValue::Array(vec![
        mcp_tool_entry(
            "inspect_structure",
            "Parse PDB or mmCIF text/file and inspect chains, residues, ligands, SHA-256, and confidence kind.",
            vec![
                ("path", schema_prop("string", "Local path to .cif or .pdb file")),
                ("content", schema_prop("string", "Inline mmCIF or PDB text (if path omitted)")),
                ("hint", schema_prop("string", "auto | experimental | prediction")),
            ],
            vec![],
        ),
        mcp_tool_entry(
            "compare_structures",
            "Run deterministic float64 Kabsch rigid superposition on two structures (files or inline text).",
            vec![
                ("refPath", schema_prop("string", "Reference mmCIF/PDB file path")),
                ("mobPath", schema_prop("string", "Mobile mmCIF/PDB file path")),
                ("refContent", schema_prop("string", "Inline reference mmCIF/PDB text")),
                ("mobContent", schema_prop("string", "Inline mobile mmCIF/PDB text")),
                ("refChain", schema_prop("string", "Optional reference chain ID")),
                ("mobChain", schema_prop("string", "Optional mobile chain ID")),
                ("paePath", schema_prop("string", "Optional AlphaFold PAE JSON path")),
            ],
            vec![],
        ),
        mcp_tool_entry(
            "analyze_peptide",
            "Compute wild-type vs mutated peptide biophysical descriptors (MW, pI, charge@7.4, GRAVY) and optional 3D contacts.",
            vec![
                ("sequence", schema_prop("string", "1-letter amino acid sequence")),
                ("mutations", schema_prop("string", "Comma-separated mutations, e.g. H94A,T199V")),
                ("focusSeqId", schema_prop("integer", "Optional residue sequence ID")),
            ],
            vec!["sequence"],
        ),
        mcp_tool_entry(
            "analyze_gene_crispr",
            "Evaluate coding-transcript codon edit consequence and scan SpCas9/SaCas9/Cas12a PAM sites.",
            vec![
                ("transcriptId", schema_prop("string", "NM_000067.3, NM_000518.5, or NM_000546.6")),
                ("codon", schema_prop("integer", "1-based target codon index")),
                ("editBp", schema_prop("integer", "Optional 1-based CDS base edit position")),
                ("newBase", schema_prop("string", "A | C | G | T")),
                ("nuclease", schema_prop("string", "SpCas9 | SaCas9 | Cas12a | all")),
            ],
            vec!["codon"],
        ),
        mcp_tool_entry(
            "analyze_molecule_smiles",
            "Compute deterministic molecular formula, MW, exact mass, TPSA, cLogP, Lipinski/Veber metrics, and 2D coordinates from SMILES.",
            vec![
                ("smiles", schema_prop("string", "SMILES string")),
                ("name", schema_prop("string", "Optional compound label")),
            ],
            vec!["smiles"],
        ),
        mcp_tool_entry(
            "analyze_ramachandran",
            "Compute backbone (phi, psi) dihedrals, secondary structure counts, and C-alpha contacts.",
            vec![
                ("path", schema_prop("string", "Local mmCIF/PDB file path")),
                ("content", schema_prop("string", "Inline mmCIF/PDB text")),
                ("chainId", schema_prop("string", "Optional polymer chain ID")),
            ],
            vec![],
        ),
        mcp_tool_entry(
            "vault_status",
            "Inspect local encrypted state.vscdb BYOK storage path and metadata (no raw keys returned).",
            vec![],
            vec![],
        ),
    ])
}

fn mcp_ok(id: JsonValue, result: JsonValue) -> JsonValue {
    JsonValue::object(vec![
        ("jsonrpc", JsonValue::String("2.0".to_string())),
        ("id", id),
        ("result", result),
    ])
}

fn mcp_err(id: JsonValue, code: i64, message: &str) -> JsonValue {
    JsonValue::object(vec![
        ("jsonrpc", JsonValue::String("2.0".to_string())),
        ("id", id),
        (
            "error",
            JsonValue::object(vec![
                ("code", JsonValue::Number(code as f64)),
                ("message", JsonValue::String(message.to_string())),
            ]),
        ),
    ])
}

fn execute_mcp_tool(name: &str, args: &JsonValue) -> Result<JsonValue, CoreError> {
    match name {
        "inspect_structure" => {
            let content = if let Some(p) = args.get("path").and_then(|v| v.as_str()) {
                read_text(p)?
            } else if let Some(c) = args.get("content").and_then(|v| v.as_str()) {
                c.to_string()
            } else {
                return Err(CoreError::new("ERR_INVALID_INPUT", "inspect_structure requires 'path' or 'content'"));
            };
            let hint = SourceTypeHint::from_opt_str(args.get("hint").and_then(|v| v.as_str()));
            Ok(parse_structure(&content, hint)?.to_inspect_json())
        }
        "compare_structures" => {
            let ref_path = args.get("refPath").and_then(|v| v.as_str());
            let mob_path = args.get("mobPath").and_then(|v| v.as_str());
            let ref_content = match (ref_path, args.get("refContent").and_then(|v| v.as_str())) {
                (Some(p), _) => read_text(p)?,
                (None, Some(c)) => c.to_string(),
                _ => return Err(CoreError::new("ERR_INVALID_INPUT", "compare_structures requires 'refPath' or 'refContent'")),
            };
            let mob_content = match (mob_path, args.get("mobContent").and_then(|v| v.as_str())) {
                (Some(p), _) => read_text(p)?,
                (None, Some(c)) => c.to_string(),
                _ => return Err(CoreError::new("ERR_INVALID_INPUT", "compare_structures requires 'mobPath' or 'mobContent'")),
            };
            let pae_content = match args.get("paePath").and_then(|v| v.as_str()) {
                Some(p) => Some(read_text(p)?),
                None => None,
            };
            let ref_parsed = parse_structure(&ref_content, SourceTypeHint::Auto)?;
            let mob_parsed = parse_structure(&mob_content, SourceTypeHint::Auto)?;
            let cmp = compare_structures(
                ref_path.unwrap_or("reference.cif"),
                ref_parsed,
                args.get("refChain").and_then(|v| v.as_str()),
                StructureMeta::default(),
                mob_path.unwrap_or("mobile.cif"),
                mob_parsed,
                args.get("mobChain").and_then(|v| v.as_str()),
                StructureMeta::default(),
                pae_content.as_deref(),
                "native-rust",
                &utc_now_iso8601(),
            )?;
            Ok(cmp.to_json())
        }
        "analyze_peptide" => {
            let seq = args
                .get("sequence")
                .and_then(|v| v.as_str())
                .ok_or_else(|| CoreError::new("ERR_INVALID_INPUT", "analyze_peptide requires 'sequence'"))?;
            let mutations: Vec<String> = args
                .get("mutations")
                .and_then(|v| v.as_str())
                .map(|s| {
                    s.split(',')
                        .map(|m| m.trim().to_string())
                        .filter(|m| !m.is_empty())
                        .collect()
                })
                .unwrap_or_default();
            let focus = args.get("focusSeqId").and_then(|v| v.as_i64()).map(|n| n as i32);
            Ok(analyze_peptide(seq, &mutations, None, None, None, None, focus)?.to_json())
        }
        "analyze_gene_crispr" => {
            let transcript = args.get("transcriptId").and_then(|v| v.as_str());
            let codon = args.get("codon").and_then(|v| v.as_usize()).unwrap_or(1);
            let edit_bp = args.get("editBp").and_then(|v| v.as_usize());
            let new_base = args.get("newBase").and_then(|v| v.as_str());
            let nuclease = args.get("nuclease").and_then(|v| v.as_str());
            Ok(analyze_gene_crispr(transcript, None, codon, edit_bp, new_base, nuclease)?.to_json())
        }
        "analyze_molecule_smiles" => {
            let smiles = args
                .get("smiles")
                .and_then(|v| v.as_str())
                .ok_or_else(|| CoreError::new("ERR_INVALID_INPUT", "analyze_molecule_smiles requires 'smiles'"))?;
            let name = args.get("name").and_then(|v| v.as_str());
            Ok(analyze_molecule_smiles(name, smiles)?.to_json())
        }
        "analyze_ramachandran" => {
            let content = if let Some(p) = args.get("path").and_then(|v| v.as_str()) {
                read_text(p)?
            } else if let Some(c) = args.get("content").and_then(|v| v.as_str()) {
                c.to_string()
            } else {
                return Err(CoreError::new("ERR_INVALID_INPUT", "analyze_ramachandran requires 'path' or 'content'"));
            };
            let chain = args.get("chainId").and_then(|v| v.as_str());
            Ok(analyze_ramachandran(&content, chain)?.to_json())
        }
        "vault_status" => Ok(mcp_vault_status_json()),
        other => Err(CoreError::new("ERR_INVALID_INPUT", format!("Unknown MCP tool '{}'", other))),
    }
}

pub fn handle_mcp_json_line(line: &str) -> Option<String> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    let req = match parse_json(trimmed) {
        Ok(v) => v,
        Err(e) => {
            return Some(mcp_err(JsonValue::Null, -32700, &format!("Parse error: {}", e)).to_json_string());
        }
    };
    let id = req.get("id").cloned().unwrap_or(JsonValue::Null);
    let method = req.get("method").and_then(|v| v.as_str()).unwrap_or("");
    if method.starts_with("notifications/") {
        return None;
    }
    let params = req.get("params").cloned().unwrap_or(JsonValue::Object(vec![]));

    let resp = match method {
        "initialize" => mcp_ok(
            id,
            JsonValue::object(vec![
                ("protocolVersion", JsonValue::String("2024-11-05".to_string())),
                (
                    "serverInfo",
                    JsonValue::object(vec![
                        ("name", JsonValue::String("synlexa-studio-native-mcp".to_string())),
                        ("version", JsonValue::String(env!("CARGO_PKG_VERSION").to_string())),
                    ]),
                ),
                (
                    "capabilities",
                    JsonValue::object(vec![
                        ("tools", JsonValue::object(vec![("listChanged", JsonValue::Bool(false))])),
                        ("resources", JsonValue::object(vec![("listChanged", JsonValue::Bool(false))])),
                        ("prompts", JsonValue::object(vec![("listChanged", JsonValue::Bool(false))])),
                    ]),
                ),
            ]),
        ),
        "ping" => mcp_ok(id, JsonValue::Object(vec![])),
        "tools/list" => mcp_ok(id, JsonValue::object(vec![("tools", mcp_tools_list())])),
        "tools/call" => {
            let tool_name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let args = params
                .get("arguments")
                .cloned()
                .unwrap_or(JsonValue::Object(vec![]));
            match execute_mcp_tool(tool_name, &args) {
                Ok(data) => mcp_ok(
                    id,
                    JsonValue::object(vec![
                        ("isError", JsonValue::Bool(false)),
                        (
                            "content",
                            JsonValue::Array(vec![JsonValue::object(vec![
                                ("type", JsonValue::String("text".to_string())),
                                ("text", JsonValue::String(data.to_json_pretty())),
                            ])]),
                        ),
                    ]),
                ),
                Err(err) => mcp_ok(
                    id,
                    JsonValue::object(vec![
                        ("isError", JsonValue::Bool(true)),
                        (
                            "content",
                            JsonValue::Array(vec![JsonValue::object(vec![
                                ("type", JsonValue::String("text".to_string())),
                                ("text", JsonValue::String(err.to_json().to_json_string())),
                            ])]),
                        ),
                    ]),
                ),
            }
        }
        "resources/list" => mcp_ok(
            id,
            JsonValue::object(vec![(
                "resources",
                JsonValue::Array(vec![JsonValue::object(vec![
                    ("uri", JsonValue::String("synlexa://vault/status".to_string())),
                    ("name", JsonValue::String("Local state.vscdb Vault Status".to_string())),
                    ("mimeType", JsonValue::String("application/json".to_string())),
                ])]),
            )]),
        ),
        "resources/read" => {
            let uri = params.get("uri").and_then(|v| v.as_str()).unwrap_or("");
            if uri == "synlexa://vault/status" {
                mcp_ok(
                    id,
                    JsonValue::object(vec![(
                        "contents",
                        JsonValue::Array(vec![JsonValue::object(vec![
                            ("uri", JsonValue::String(uri.to_string())),
                            ("mimeType", JsonValue::String("application/json".to_string())),
                            ("text", JsonValue::String(mcp_vault_status_json().to_json_pretty())),
                        ])]),
                    )]),
                )
            } else {
                mcp_err(id, -32602, &format!("Unknown resource URI: {}", uri))
            }
        }
        "prompts/list" => mcp_ok(id, JsonValue::object(vec![("prompts", JsonValue::Array(vec![]))])),
        other => mcp_err(id, -32601, &format!("Method not found: {}", other)),
    };
    Some(resp.to_json_string())
}

fn run_mcp_stdio() -> Result<(), CoreError> {
    let stdin = io::stdin();
    let mut stdout = io::stdout();
    for line in stdin.lock().lines() {
        let line = line.map_err(|e| CoreError::new("ERR_INVALID_INPUT", e.to_string()))?;
        if let Some(out) = handle_mcp_json_line(&line) {
            writeln!(stdout, "{}", out)
                .and_then(|_| stdout.flush())
                .map_err(|e| CoreError::new("ERR_INVALID_INPUT", e.to_string()))?;
        }
    }
    Ok(())
}

fn run(args: &[String]) -> Result<(), CoreError> {
    if args.len() < 2 {
        print_usage();
        return Err(CoreError::new("ERR_INVALID_INPUT", "Missing subcommand"));
    }
    let sub = args[1].as_str();
    let rest = &args[2..];
    if sub == "mcp" {
        return run_mcp_stdio();
    }
    if matches!(sub, "login" | "logout" | "whoami" | "usage" | "upgrade") {
        return cloud::run(sub, rest);
    }
    let out_path = take_opt(rest, "--out");
    let pretty = rest.iter().any(|a| a == "--pretty");

    let json_val: JsonValue = match sub {
        "inspect" => {
            let input = take_opt(rest, "--input").ok_or_else(|| {
                CoreError::new("ERR_INVALID_INPUT", "inspect requires --input <path>")
            })?;
            let hint = SourceTypeHint::from_opt_str(take_opt(rest, "--hint").as_deref());
            let content = read_text(&input)?;
            let parsed = parse_structure(&content, hint)?;
            parsed.to_inspect_json()
        }
        "compare" => {
            let ref_path = take_opt(rest, "--ref").ok_or_else(|| {
                CoreError::new("ERR_INVALID_INPUT", "compare requires --ref <path>")
            })?;
            let mob_path = take_opt(rest, "--mob").ok_or_else(|| {
                CoreError::new("ERR_INVALID_INPUT", "compare requires --mob <path>")
            })?;
            let ref_chain = take_opt(rest, "--ref-chain");
            let mob_chain = take_opt(rest, "--mob-chain");
            let pae_path = take_opt(rest, "--pae");

            let ref_content = read_text(&ref_path)?;
            let mob_content = read_text(&mob_path)?;
            let pae_content = match pae_path {
                Some(p) => Some(read_text(&p)?),
                None => None,
            };

            let ref_parsed = parse_structure(&ref_content, SourceTypeHint::Auto)?;
            let mob_parsed = parse_structure(&mob_content, SourceTypeHint::Auto)?;

            let ref_label = std::path::Path::new(&ref_path)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or(&ref_path)
                .to_string();
            let mob_label = std::path::Path::new(&mob_path)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or(&mob_path)
                .to_string();

            let cmp = compare_structures(
                &ref_label,
                ref_parsed,
                ref_chain.as_deref(),
                StructureMeta::default(),
                &mob_label,
                mob_parsed,
                mob_chain.as_deref(),
                StructureMeta::default(),
                pae_content.as_deref(),
                "native-rust",
                &utc_now_iso8601(),
            )?;
            cmp.to_json()
        }
        "peptide" => {
            let seq = take_opt(rest, "--seq").ok_or_else(|| {
                CoreError::new("ERR_INVALID_INPUT", "peptide requires --seq <sequence>")
            })?;
            let mutations = take_multi(rest, "--mut");
            let slice_start = take_opt(rest, "--slice-start").and_then(|s| s.parse().ok());
            let slice_end = take_opt(rest, "--slice-end").and_then(|s| s.parse().ok());
            let chain_id = take_opt(rest, "--chain");
            let focus_seq_id = take_opt(rest, "--focus").and_then(|s| s.parse().ok());
            let struct_content = match take_opt(rest, "--structure") {
                Some(p) => Some(read_text(&p)?),
                None => None,
            };
            let res = analyze_peptide(
                &seq,
                &mutations,
                slice_start,
                slice_end,
                struct_content.as_deref(),
                chain_id.as_deref(),
                focus_seq_id,
            )?;
            res.to_json()
        }
        "gene" => {
            let transcript = take_opt(rest, "--transcript");
            let dna = take_opt(rest, "--dna");
            let codon: usize = take_opt(rest, "--codon")
                .and_then(|s| s.parse().ok())
                .unwrap_or(1);
            let edit_bp = take_opt(rest, "--edit-bp").and_then(|s| s.parse().ok());
            let new_base = take_opt(rest, "--new-base");
            let nuclease = take_opt(rest, "--nuclease");
            let res = analyze_gene_crispr(
                transcript.as_deref(),
                dna.as_deref(),
                codon,
                edit_bp,
                new_base.as_deref(),
                nuclease.as_deref(),
            )?;
            res.to_json()
        }
        "smiles" => {
            let smiles = take_opt(rest, "--smiles").ok_or_else(|| {
                CoreError::new("ERR_INVALID_INPUT", "smiles requires --smiles <string>")
            })?;
            let name = take_opt(rest, "--name");
            let res = analyze_molecule_smiles(name.as_deref(), &smiles)?;
            res.to_json()
        }
        "ramachandran" => {
            let input = take_opt(rest, "--input").ok_or_else(|| {
                CoreError::new("ERR_INVALID_INPUT", "ramachandran requires --input <path>")
            })?;
            let chain_id = take_opt(rest, "--chain");
            let content = read_text(&input)?;
            let res = analyze_ramachandran(&content, chain_id.as_deref())?;
            res.to_json()
        }
        "--help" | "-h" | "help" => {
            print_usage();
            return Ok(());
        }
        "--version" | "-V" | "version" => {
            println!("studio-cli {}", env!("CARGO_PKG_VERSION"));
            return Ok(());
        }
        other => {
            return Err(CoreError::new(
                "ERR_INVALID_INPUT",
                format!("Unknown subcommand '{}'", other),
            ));
        }
    };

    let serialized = if pretty {
        json_val.to_json_pretty()
    } else {
        json_val.to_json_string()
    };
    write_output(out_path.as_deref(), &serialized)
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if let Err(err) = run(&args) {
        let err_json = JsonValue::object(vec![
            ("ok", JsonValue::Bool(false)),
            ("error", err.to_json()),
        ]);
        eprintln!("{}", err_json.to_json_string());
        process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mcp_initialize_and_tools_list() {
        let init_resp = handle_mcp_json_line(r#"{"jsonrpc":"2.0","id":1,"method":"initialize"}"#).unwrap();
        let parsed = parse_json(&init_resp).unwrap();
        assert_eq!(parsed.get("result").unwrap().get("protocolVersion").unwrap().as_str(), Some("2024-11-05"));

        let list_resp = handle_mcp_json_line(r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#).unwrap();
        let tools = parse_json(&list_resp).unwrap();
        let arr = tools.get("result").unwrap().get("tools").unwrap().as_array().unwrap();
        assert!(arr.len() >= 7);
    }

    #[test]
    fn mcp_calls_smiles_and_vault_status() {
        let call_resp = handle_mcp_json_line(
            r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"analyze_molecule_smiles","arguments":{"name":"Acetazolamide","smiles":"CC(=O)Nc1nnc(S(N)(=O)=O)s1"}}}"#,
        )
        .unwrap();
        assert!(call_resp.contains("C4H6N4O3S2"));

        let vault_resp = handle_mcp_json_line(
            r#"{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"vault_status","arguments":{}}}"#,
        )
        .unwrap();
        assert!(vault_resp.contains("state.vscdb"));
        assert!(vault_resp.contains("ItemTable"));
    }
}
