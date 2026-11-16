//! Native localhost HTTP host + local SQLite `state.vscdb` BYOK vault
//! + HTTP MCP endpoint + browser/WebView launcher for Synlexa Studio (RUO).

use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::io::{ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use synlexa_bio_core::chemistry::analyze_molecule_smiles;
use synlexa_bio_core::genomics::analyze_gene_crispr;
use synlexa_bio_core::json::{parse_json, JsonValue};
use synlexa_bio_core::peptide::analyze_peptide;
use synlexa_bio_core::ramachandran::analyze_ramachandran;
use synlexa_bio_core::sha256::{sha256_bytes, sha256_hex};
use synlexa_bio_core::structure::{parse_structure, SourceTypeHint};
use synlexa_bio_core::{CoreError, RUO_NOTICE};

const DEEP_LINK_PREFIX: &str = "synlexa-studio://auth/callback";
const ALLOWED_PROVIDERS: &[&str] = &["anthropic", "gemini", "openai"];

fn mime_type(path: &Path) -> &'static str {
    match path.extension().and_then(|s| s.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "application/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "cif" | "pdb" | "smi" => "application/json; charset=utf-8",
        "wasm" => "application/wasm",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "ico" => "image/x-icon",
        _ => "application/octet-stream",
    }
}

fn has_unsafe_chars(s: &str) -> bool {
    s.chars().any(|c| c == '\r' || c == '\n' || c == '\0')
}

/// Validates a `synlexa-studio://auth/callback` deep-link URI and translates it
/// to the local Studio web callback URL `http://127.0.0.1:<port>/?studio_auth=callback&<query>`.
fn translate_deep_link_to_local_url(uri: &str, port: u16) -> Result<String, &'static str> {
    let trimmed = uri.trim();
    if trimmed.is_empty() {
        return Err("auth callback URI is empty");
    }
    if has_unsafe_chars(trimmed) {
        return Err("auth callback URI contains forbidden control characters");
    }
    if trimmed.len() < DEEP_LINK_PREFIX.len() {
        return Err("auth callback URI must start with synlexa-studio://auth/callback");
    }
    let (prefix, rest) = trimmed.split_at(DEEP_LINK_PREFIX.len());
    if !prefix.eq_ignore_ascii_case(DEEP_LINK_PREFIX) {
        return Err("auth callback URI must start with synlexa-studio://auth/callback");
    }
    if !rest.is_empty() && !rest.starts_with('?') && !rest.starts_with('#') {
        return Err("auth callback URI path must be synlexa-studio://auth/callback");
    }

    let query = match rest.strip_prefix('?') {
        Some(q) => q.split('#').next().unwrap_or("").trim_start_matches('&'),
        None => "",
    };

    if query.is_empty() {
        Ok(format!("http://127.0.0.1:{}/?studio_auth=callback", port))
    } else {
        Ok(format!(
            "http://127.0.0.1:{}/?studio_auth=callback&{}",
            port, query
        ))
    }
}

/// Translates an incoming HTTP request-target `/auth/callback?...` into a
/// local 302 Location `/?studio_auth=callback&<query>`.
fn translate_http_auth_callback_redirect(request_target: &str) -> Option<String> {
    if has_unsafe_chars(request_target) {
        return None;
    }
    let without_fragment = request_target.split('#').next().unwrap_or(request_target);
    let (route_path, query_opt) = match without_fragment.split_once('?') {
        Some((p, q)) => (p, Some(q.trim_start_matches('&'))),
        None => (without_fragment, None),
    };
    if route_path != "/auth/callback" {
        return None;
    }
    match query_opt {
        Some(q) if !q.is_empty() => Some(format!("/?studio_auth=callback&{}", q)),
        _ => Some("/?studio_auth=callback".to_string()),
    }
}

// ---------------------------------------------------------------------------
// Local Encrypted SQLite `state.vscdb` Vault (`ItemTable`)
// ---------------------------------------------------------------------------

fn default_vscdb_dir() -> PathBuf {
    let home = env::var("HOME")
        .or_else(|_| env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".synlexa-studio")
}

fn default_vscdb_path() -> PathBuf {
    default_vscdb_dir().join("state.vscdb")
}

fn load_or_create_machine_key(dir: &Path) -> [u8; 32] {
    let key_file = dir.join(".vault.key");
    if let Ok(raw) = fs::read(&key_file) {
        if raw.len() >= 32 {
            let mut out = [0u8; 32];
            out.copy_from_slice(&raw[..32]);
            return out;
        }
    }
    let _ = fs::create_dir_all(dir);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let seed = format!(
        "synlexa-vscdb-key:{}:{}:{}:{}",
        std::process::id(),
        nanos,
        env::var("USER").unwrap_or_default(),
        dir.to_string_lossy()
    );
    let key = sha256_bytes(seed.as_bytes());
    let _ = fs::write(&key_file, &key);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&key_file, fs::Permissions::from_mode(0o600));
    }
    key
}

fn bytes_to_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

fn hex_to_bytes(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    let mut out = Vec::with_capacity(s.len() / 2);
    let bytes = s.as_bytes();
    for i in (0..bytes.len()).step_by(2) {
        let hi = (bytes[i] as char).to_digit(16)? as u8;
        let lo = (bytes[i + 1] as char).to_digit(16)? as u8;
        out.push((hi << 4) | lo);
    }
    Some(out)
}

fn encrypt_vscdb_value(master: &[u8; 32], plaintext: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let nonce = sha256_bytes(format!("nonce:{}:{}", nanos, plaintext.len()).as_bytes());
    let nonce_hex = bytes_to_hex(&nonce[..16]);
    let pt = plaintext.as_bytes();
    let mut ct = Vec::with_capacity(pt.len());
    for (idx, &b) in pt.iter().enumerate() {
        let blk_idx = (idx / 32) as u32;
        let mut mat = Vec::with_capacity(64);
        mat.extend_from_slice(master);
        mat.extend_from_slice(&nonce[..16]);
        mat.extend_from_slice(&blk_idx.to_be_bytes());
        let pad = sha256_bytes(&mat);
        ct.push(b ^ pad[idx % 32]);
    }
    let ct_hex = bytes_to_hex(&ct);
    let mut mac_in = Vec::with_capacity(master.len() + nonce_hex.len() + ct_hex.len());
    mac_in.extend_from_slice(master);
    mac_in.extend_from_slice(nonce_hex.as_bytes());
    mac_in.extend_from_slice(ct_hex.as_bytes());
    let mac = sha256_hex(&mac_in);
    format!("vscdb-enc-v1:{}:{}:{}", nonce_hex, ct_hex, mac)
}

fn decrypt_vscdb_value(master: &[u8; 32], stored: &str) -> Option<String> {
    let parts: Vec<&str> = stored.split(':').collect();
    if parts.len() != 4 || parts[0] != "vscdb-enc-v1" {
        return None;
    }
    let nonce_hex = parts[1];
    let ct_hex = parts[2];
    let mac_hex = parts[3];

    let mut mac_in = Vec::with_capacity(master.len() + nonce_hex.len() + ct_hex.len());
    mac_in.extend_from_slice(master);
    mac_in.extend_from_slice(nonce_hex.as_bytes());
    mac_in.extend_from_slice(ct_hex.as_bytes());
    if sha256_hex(&mac_in) != mac_hex {
        return None;
    }

    let nonce = hex_to_bytes(nonce_hex)?;
    let ct = hex_to_bytes(ct_hex)?;
    let mut pt = Vec::with_capacity(ct.len());
    for (idx, &b) in ct.iter().enumerate() {
        let blk_idx = (idx / 32) as u32;
        let mut mat = Vec::with_capacity(64);
        mat.extend_from_slice(master);
        mat.extend_from_slice(&nonce);
        mat.extend_from_slice(&blk_idx.to_be_bytes());
        let pad = sha256_bytes(&mat);
        pt.push(b ^ pad[idx % 32]);
    }
    String::from_utf8(pt).ok()
}

fn sql_escape(s: &str) -> String {
    s.replace('\'', "''")
}

fn sqlite_available() -> bool {
    Command::new("sqlite3").arg("--version").output().is_ok()
}

fn ensure_vscdb_schema(db_path: &Path) {
    if let Some(parent) = db_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if sqlite_available() {
        let _ = Command::new("sqlite3")
            .arg(db_path)
            .arg("CREATE TABLE IF NOT EXISTS ItemTable (key TEXT PRIMARY KEY, value TEXT NOT NULL);")
            .output();
    }
}

fn read_vault_keys_from_dir(dir: &Path) -> BTreeMap<String, String> {
    let db_path = dir.join("state.vscdb");
    let master = load_or_create_machine_key(dir);
    let mut out = BTreeMap::new();

    if sqlite_available() && db_path.exists() {
        if let Ok(output) = Command::new("sqlite3")
            .arg("-separator")
            .arg("\t")
            .arg(&db_path)
            .arg("SELECT key, value FROM ItemTable WHERE key LIKE 'secret://synlexa.studio.vault/%';")
            .output()
        {
            if output.status.success() {
                let txt = String::from_utf8_lossy(&output.stdout);
                for line in txt.lines() {
                    if let Some((k, v)) = line.split_once('\t') {
                        if let Some(provider) = k.strip_prefix("secret://synlexa.studio.vault/") {
                            if ALLOWED_PROVIDERS.contains(&provider) {
                                if let Some(plain) = decrypt_vscdb_value(&master, v.trim()) {
                                    if !plain.is_empty() {
                                        out.insert(provider.to_string(), plain);
                                    }
                                }
                            }
                        }
                    }
                }
                return out;
            }
        }
    }

    // Encrypted sidecar file fallback if sqlite3 CLI is missing
    let sidecar = dir.join("state.vscdb.json");
    if let Ok(raw) = fs::read_to_string(&sidecar) {
        if let Ok(JsonValue::Object(entries)) = parse_json(&raw) {
            for (k, v) in entries {
                if let Some(provider) = k.strip_prefix("secret://synlexa.studio.vault/") {
                    if ALLOWED_PROVIDERS.contains(&provider) {
                        if let Some(enc) = v.as_str() {
                            if let Some(plain) = decrypt_vscdb_value(&master, enc) {
                                if !plain.is_empty() {
                                    out.insert(provider.to_string(), plain);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    out
}

fn write_vault_key_to_dir(dir: &Path, provider: &str, api_key: &str) -> Result<(), String> {
    if !ALLOWED_PROVIDERS.contains(&provider) {
        return Err(format!("Unsupported vault provider '{}'", provider));
    }
    let db_path = dir.join("state.vscdb");
    ensure_vscdb_schema(&db_path);
    let master = load_or_create_machine_key(dir);
    let row_key = format!("secret://synlexa.studio.vault/{}", provider);
    let trimmed = api_key.trim();

    if sqlite_available() {
        let sql = if trimmed.is_empty() {
            format!("DELETE FROM ItemTable WHERE key='{}';", sql_escape(&row_key))
        } else {
            let enc = encrypt_vscdb_value(&master, trimmed);
            format!(
                "INSERT INTO ItemTable(key, value) VALUES('{}', '{}') ON CONFLICT(key) DO UPDATE SET value=excluded.value;",
                sql_escape(&row_key),
                sql_escape(&enc)
            )
        };
        let status = Command::new("sqlite3")
            .arg(&db_path)
            .arg(&sql)
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err("sqlite3 write failed".to_string());
        }
        return Ok(());
    }

    let sidecar = dir.join("state.vscdb.json");
    let mut map: BTreeMap<String, String> = BTreeMap::new();
    if let Ok(raw) = fs::read_to_string(&sidecar) {
        if let Ok(JsonValue::Object(entries)) = parse_json(&raw) {
            for (k, v) in entries {
                if let Some(s) = v.as_str() {
                    map.insert(k, s.to_string());
                }
            }
        }
    }
    if trimmed.is_empty() {
        map.remove(&row_key);
    } else {
        map.insert(row_key, encrypt_vscdb_value(&master, trimmed));
    }
    let json_entries: Vec<(String, JsonValue)> = map
        .into_iter()
        .map(|(k, v)| (k, JsonValue::String(v)))
        .collect();
    fs::write(&sidecar, JsonValue::Object(json_entries).to_json_pretty())
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Native HTTP MCP Bridge (`POST /mcp`)
// ---------------------------------------------------------------------------

fn handle_http_mcp(body: &str) -> String {
    let req = match parse_json(body) {
        Ok(v) => v,
        Err(e) => {
            return JsonValue::object(vec![
                ("jsonrpc", JsonValue::String("2.0".to_string())),
                ("id", JsonValue::Null),
                (
                    "error",
                    JsonValue::object(vec![
                        ("code", JsonValue::Number(-32700.0)),
                        ("message", JsonValue::String(format!("Parse error: {}", e))),
                    ]),
                ),
            ])
            .to_json_string();
        }
    };
    let id = req.get("id").cloned().unwrap_or(JsonValue::Null);
    let method = req.get("method").and_then(|v| v.as_str()).unwrap_or("");
    let params = req.get("params").cloned().unwrap_or(JsonValue::Object(vec![]));

    let ok = |result: JsonValue| -> String {
        JsonValue::object(vec![
            ("jsonrpc", JsonValue::String("2.0".to_string())),
            ("id", id.clone()),
            ("result", result),
        ])
        .to_json_string()
    };

    match method {
        "initialize" => ok(JsonValue::object(vec![
            ("protocolVersion", JsonValue::String("2024-11-05".to_string())),
            (
                "serverInfo",
                JsonValue::object(vec![
                    ("name", JsonValue::String("synlexa-studio-http-mcp".to_string())),
                    ("version", JsonValue::String(env!("CARGO_PKG_VERSION").to_string())),
                ]),
            ),
            (
                "capabilities",
                JsonValue::object(vec![
                    ("tools", JsonValue::object(vec![("listChanged", JsonValue::Bool(false))])),
                    ("resources", JsonValue::object(vec![("listChanged", JsonValue::Bool(false))])),
                ]),
            ),
        ])),
        "ping" => ok(JsonValue::Object(vec![])),
        "tools/list" => ok(JsonValue::object(vec![(
            "tools",
            JsonValue::Array(vec![
                JsonValue::object(vec![
                    ("name", JsonValue::String("analyze_molecule_smiles".to_string())),
                    ("description", JsonValue::String("Compute deterministic formula, MW, TPSA, cLogP, and 2D layout from SMILES.".to_string())),
                ]),
                JsonValue::object(vec![
                    ("name", JsonValue::String("analyze_gene_crispr".to_string())),
                    ("description", JsonValue::String("Evaluate MANE transcript codon edit and scan SpCas9/SaCas9/Cas12a PAMs.".to_string())),
                ]),
                JsonValue::object(vec![
                    ("name", JsonValue::String("analyze_peptide".to_string())),
                    ("description", JsonValue::String("Compute wild-type vs mutated peptide properties.".to_string())),
                ]),
                JsonValue::object(vec![
                    ("name", JsonValue::String("inspect_structure".to_string())),
                    ("description", JsonValue::String("Inspect inline mmCIF/PDB structure metadata and chains.".to_string())),
                ]),
                JsonValue::object(vec![
                    ("name", JsonValue::String("analyze_ramachandran".to_string())),
                    ("description", JsonValue::String("Compute Ramachandran phi/psi geometry and contacts.".to_string())),
                ]),
                JsonValue::object(vec![
                    ("name", JsonValue::String("vault_status".to_string())),
                    ("description", JsonValue::String("Check local state.vscdb encrypted vault status.".to_string())),
                ]),
            ]),
        )])),
        "tools/call" => {
            let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or(JsonValue::Object(vec![]));
            let outcome: Result<JsonValue, CoreError> = match name {
                "analyze_molecule_smiles" => {
                    let smi = args.get("smiles").and_then(|v| v.as_str()).unwrap_or("");
                    let lbl = args.get("name").and_then(|v| v.as_str());
                    analyze_molecule_smiles(lbl, smi).map(|r| r.to_json())
                }
                "analyze_gene_crispr" => {
                    let tr = args.get("transcriptId").and_then(|v| v.as_str());
                    let codon = args.get("codon").and_then(|v| v.as_usize()).unwrap_or(1);
                    let edit_bp = args.get("editBp").and_then(|v| v.as_usize());
                    let nb = args.get("newBase").and_then(|v| v.as_str());
                    let nuc = args.get("nuclease").and_then(|v| v.as_str());
                    analyze_gene_crispr(tr, None, codon, edit_bp, nb, nuc).map(|r| r.to_json())
                }
                "analyze_peptide" => {
                    let seq = args.get("sequence").and_then(|v| v.as_str()).unwrap_or("");
                    let muts: Vec<String> = args
                        .get("mutations")
                        .and_then(|v| v.as_str())
                        .map(|s| s.split(',').map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect())
                        .unwrap_or_default();
                    let focus = args.get("focusSeqId").and_then(|v| v.as_i64()).map(|n| n as i32);
                    analyze_peptide(seq, &muts, None, None, None, None, focus).map(|r| r.to_json())
                }
                "inspect_structure" => {
                    let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("");
                    parse_structure(content, SourceTypeHint::Auto).map(|r| r.to_inspect_json())
                }
                "analyze_ramachandran" => {
                    let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("");
                    let chain = args.get("chainId").and_then(|v| v.as_str());
                    analyze_ramachandran(content, chain).map(|r| r.to_json())
                }
                "vault_status" => Ok(JsonValue::object(vec![
                    ("dbPath", JsonValue::String(default_vscdb_path().to_string_lossy().to_string())),
                    ("tableName", JsonValue::String("ItemTable".to_string())),
                    ("encrypted", JsonValue::Bool(true)),
                    ("ruoNotice", JsonValue::String(RUO_NOTICE.to_string())),
                ])),
                other => Err(CoreError::new("ERR_INVALID_INPUT", format!("Unknown tool '{}'", other))),
            };
            match outcome {
                Ok(data) => ok(JsonValue::object(vec![
                    ("isError", JsonValue::Bool(false)),
                    (
                        "content",
                        JsonValue::Array(vec![JsonValue::object(vec![
                            ("type", JsonValue::String("text".to_string())),
                            ("text", JsonValue::String(data.to_json_pretty())),
                        ])]),
                    ),
                ])),
                Err(err) => ok(JsonValue::object(vec![
                    ("isError", JsonValue::Bool(true)),
                    (
                        "content",
                        JsonValue::Array(vec![JsonValue::object(vec![
                            ("type", JsonValue::String("text".to_string())),
                            ("text", JsonValue::String(err.to_json().to_json_string())),
                        ])]),
                    ),
                ])),
            }
        }
        other => JsonValue::object(vec![
            ("jsonrpc", JsonValue::String("2.0".to_string())),
            ("id", id),
            (
                "error",
                JsonValue::object(vec![
                    ("code", JsonValue::Number(-32601.0)),
                    ("message", JsonValue::String(format!("Method not found: {}", other))),
                ]),
            ),
        ])
        .to_json_string(),
    }
}

fn send_json(stream: &mut TcpStream, status: &str, json_body: &str) {
    let resp = format!(
        "HTTP/1.1 {}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{}",
        status,
        json_body.len(),
        json_body
    );
    let _ = stream.write_all(resp.as_bytes());
}

fn safe_resolve(root: &Path, url_path: &str) -> Option<PathBuf> {
    let clean = url_path.split('?').next().unwrap_or("/");
    let rel = clean.trim_start_matches('/');
    let rel = if rel.is_empty() { "index.html" } else { rel };

    let mut joined = root.to_path_buf();
    for comp in Path::new(rel).components() {
        match comp {
            Component::Normal(part) => joined.push(part),
            Component::CurDir => {}
            _ => return None, // reject .., RootDir, Prefix
        }
    }
    let canon_root = fs::canonicalize(root).ok()?;
    let canon_target = fs::canonicalize(&joined).ok()?;
    if canon_target.starts_with(&canon_root) && canon_target.is_file() {
        Some(canon_target)
    } else {
        None
    }
}

fn read_http_request(stream: &mut TcpStream) -> Option<(String, String, String)> {
    let mut buf = [0u8; 8192];
    let n = stream.read(&mut buf).ok()?;
    if n == 0 {
        return None;
    }
    let raw = &buf[..n];
    let split_pos = raw.windows(4).position(|w| w == b"\r\n\r\n");
    let (header_bytes, initial_body) = match split_pos {
        Some(idx) => (&raw[..idx], &raw[idx + 4..]),
        None => (raw, &[][..]),
    };
    let header_str = String::from_utf8_lossy(header_bytes);
    let mut lines = header_str.lines();
    let first_line = lines.next().unwrap_or("");
    let mut parts = first_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let path = parts.next().unwrap_or("/").to_string();

    let mut content_len: usize = 0;
    for line in lines {
        if let Some((k, v)) = line.split_once(':') {
            if k.trim().eq_ignore_ascii_case("content-length") {
                content_len = v.trim().parse().unwrap_or(0).min(1_048_576);
            }
        }
    }

    let mut body = initial_body.to_vec();
    while body.len() < content_len {
        let mut chunk = [0u8; 4096];
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(m) => body.extend_from_slice(&chunk[..m]),
        }
    }
    if body.len() > content_len && content_len > 0 {
        body.truncate(content_len);
    }
    Some((method, path, String::from_utf8_lossy(&body).to_string()))
}

fn handle_client(mut stream: TcpStream, root: &Path) {
    let (method, path, body) = match read_http_request(&mut stream) {
        Some(r) => r,
        None => return,
    };

    if path == "/api/local-vault/status" && method == "GET" {
        let dir = default_vscdb_dir();
        let keys = read_vault_keys_from_dir(&dir);
        let stored: Vec<JsonValue> = keys.keys().map(|k| JsonValue::String(k.clone())).collect();
        let resp = JsonValue::object(vec![
            ("ok", JsonValue::Bool(true)),
            ("dbPath", JsonValue::String(default_vscdb_path().to_string_lossy().to_string())),
            ("tableName", JsonValue::String("ItemTable".to_string())),
            ("sqliteCli", JsonValue::Bool(sqlite_available())),
            ("storedProviders", JsonValue::Array(stored)),
        ])
        .to_json_string();
        send_json(&mut stream, "200 OK", &resp);
        return;
    }

    if path == "/api/local-vault/keys" && method == "GET" {
        let dir = default_vscdb_dir();
        let keys = read_vault_keys_from_dir(&dir);
        let entries: Vec<(String, JsonValue)> = keys
            .into_iter()
            .map(|(k, v)| (k, JsonValue::String(v)))
            .collect();
        let resp = JsonValue::object(vec![
            ("ok", JsonValue::Bool(true)),
            ("dbPath", JsonValue::String(default_vscdb_path().to_string_lossy().to_string())),
            ("keys", JsonValue::Object(entries)),
        ])
        .to_json_string();
        send_json(&mut stream, "200 OK", &resp);
        return;
    }

    if path == "/api/local-vault/keys" && method == "POST" {
        let dir = default_vscdb_dir();
        match parse_json(&body) {
            Ok(parsed) => {
                let provider = parsed.get("provider").and_then(|v| v.as_str()).unwrap_or("");
                let api_key = parsed.get("apiKey").and_then(|v| v.as_str()).unwrap_or("");
                match write_vault_key_to_dir(&dir, provider, api_key) {
                    Ok(()) => {
                        let resp = JsonValue::object(vec![
                            ("ok", JsonValue::Bool(true)),
                            ("dbPath", JsonValue::String(default_vscdb_path().to_string_lossy().to_string())),
                        ])
                        .to_json_string();
                        send_json(&mut stream, "200 OK", &resp);
                    }
                    Err(msg) => {
                        let resp = JsonValue::object(vec![
                            ("ok", JsonValue::Bool(false)),
                            ("error", JsonValue::String(msg)),
                        ])
                        .to_json_string();
                        send_json(&mut stream, "400 Bad Request", &resp);
                    }
                }
            }
            Err(e) => {
                let resp = JsonValue::object(vec![
                    ("ok", JsonValue::Bool(false)),
                    ("error", JsonValue::String(e.to_string())),
                ])
                .to_json_string();
                send_json(&mut stream, "400 Bad Request", &resp);
            }
        }
        return;
    }

    if path == "/mcp" && method == "POST" {
        let resp = handle_http_mcp(&body);
        send_json(&mut stream, "200 OK", &resp);
        return;
    }

    if method != "GET" && method != "HEAD" {
        let resp = "HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        let _ = stream.write_all(resp.as_bytes());
        return;
    }

    if let Some(location) = translate_http_auth_callback_redirect(&path) {
        let resp = format!(
            "HTTP/1.1 302 Found\r\nLocation: {}\r\nCache-Control: no-store\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            location
        );
        let _ = stream.write_all(resp.as_bytes());
        return;
    }

    let resolved = safe_resolve(root, &path).or_else(|| safe_resolve(root, "/index.html"));
    match resolved {
        Some(file_path) => match fs::read(&file_path) {
            Ok(body) => {
                let header = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nCross-Origin-Opener-Policy: same-origin-allow-popups\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n",
                    mime_type(&file_path),
                    body.len()
                );
                let _ = stream.write_all(header.as_bytes());
                if method == "GET" {
                    let _ = stream.write_all(&body);
                }
            }
            Err(_) => {
                let resp = "HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                let _ = stream.write_all(resp.as_bytes());
            }
        },
        None => {
            let msg = b"404 Not Found (build apps/web first with `pnpm --filter @synlexa/studio-web build`)";
            let header = format!(
                "HTTP/1.1 404 Not Found\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                msg.len()
            );
            let _ = stream.write_all(header.as_bytes());
            let _ = stream.write_all(msg);
        }
    }
}

#[cfg(target_os = "macos")]
extern "C" {
    fn synlexa_run_macos_native_window(
        url_cstr: *const std::os::raw::c_char,
        icon_path_cstr: *const std::os::raw::c_char,
    );
}

fn open_browser(url: &str) {
    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("open").arg(url).spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = Command::new("xdg-open").arg(url).spawn();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("cmd").args(["/C", "start", url]).spawn();
    }
}

fn open_app_window(url: &str) {
    #[cfg(target_os = "linux")]
    {
        let app_flag = format!("--app={}", url);
        for bin in ["google-chrome", "chromium", "chromium-browser", "microsoft-edge"] {
            if Command::new(bin).arg(&app_flag).spawn().is_ok() {
                return;
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        let app_flag = format!("--app={}", url);
        for bin in ["msedge", "chrome"] {
            if Command::new(bin).arg(&app_flag).spawn().is_ok() {
                return;
            }
        }
    }
    open_browser(url);
}

fn resolve_dist_dir(dist_arg: Option<PathBuf>) -> PathBuf {
    if let Some(d) = dist_arg {
        return d;
    }
    if let Ok(exe) = env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            let bundle_res = exe_dir.join("../Resources/web-dist");
            if bundle_res.join("index.html").exists() {
                return bundle_res;
            }
            let sibling_dist = exe_dir.join("../web-dist");
            if sibling_dist.join("index.html").exists() {
                return sibling_dist;
            }
        }
    }
    let candidate = PathBuf::from("apps/web/dist");
    if candidate.exists() {
        candidate
    } else {
        PathBuf::from("../../web/dist")
    }
}

fn resolve_macos_icon_path() -> String {
    if let Ok(env_icon) = env::var("SYNLEXA_ICON_PATH") {
        let p = PathBuf::from(&env_icon);
        if p.exists() {
            return env_icon;
        }
    }
    if let Ok(exe) = env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            for rel in ["../Resources/icon.icns", "../icon.icns", "../assets/icon.icns"] {
                let candidate = exe_dir.join(rel);
                if candidate.exists() {
                    return candidate.to_string_lossy().into_owned();
                }
            }
        }
    }
    let dev_icon = PathBuf::from("apps/desktop/src-tauri/icons/icon.icns");
    if dev_icon.exists() {
        return dev_icon.to_string_lossy().into_owned();
    }
    String::new()
}

fn parse_flag_value<'a>(args: &'a [String], flag: &str) -> Option<&'a str> {
    let prefix = format!("{}=", flag);
    for (idx, arg) in args.iter().enumerate() {
        if arg == flag {
            return args.get(idx + 1).map(String::as_str);
        }
        if let Some(rest) = arg.strip_prefix(&prefix) {
            return Some(rest);
        }
    }
    None
}

fn main() {
    let args: Vec<String> = env::args().filter(|a| !a.starts_with("-psn_")).collect();
    let dist_arg = parse_flag_value(&args, "--dist").map(PathBuf::from);
    let explicit_port: Option<u16> = parse_flag_value(&args, "--port").and_then(|p| p.parse().ok());
    let auth_callback = parse_flag_value(&args, "--auth-callback").map(str::to_string);
    let no_open = args.iter().any(|a| a == "--no-open");
    let use_browser = args.iter().any(|a| a == "--browser");

    if let Some(ref cb_uri) = auth_callback {
        if let Err(err) = translate_deep_link_to_local_url(cb_uri, 1) {
            eprintln!("Invalid --auth-callback URI: {}", err);
            std::process::exit(2);
        }
    }

    let dist_dir = resolve_dist_dir(dist_arg);

    let listener = match explicit_port {
        Some(p) => match TcpListener::bind(("127.0.0.1", p)) {
            Ok(l) => l,
            Err(err) if err.kind() == ErrorKind::AddrInUse && p != 0 => {
                if let Some(ref cb_uri) = auth_callback {
                    let forward_url =
                        translate_deep_link_to_local_url(cb_uri, p).expect("validated above");
                    println!("Forwarding Studio auth callback to existing host on port {}", p);
                    if !no_open {
                        open_browser(&forward_url);
                    }
                    return;
                }
                panic!("bind localhost port: {}", err);
            }
            Err(err) => panic!("bind localhost port: {}", err),
        },
        None => TcpListener::bind(("127.0.0.1", 4179))
            .or_else(|_| TcpListener::bind(("127.0.0.1", 0)))
            .expect("bind localhost port"),
    };

    let port = listener.local_addr().unwrap().port();
    let launch_url = match auth_callback {
        Some(ref cb_uri) => {
            println!("Forwarding Studio auth callback to local host on port {}", port);
            translate_deep_link_to_local_url(cb_uri, port).expect("validated above")
        }
        None => format!("http://127.0.0.1:{}/", port),
    };
    println!(
        "Synlexa Studio Native Host (RUO) serving {:?} at http://127.0.0.1:{}/ (MCP: http://127.0.0.1:{}/mcp)",
        dist_dir, port, port
    );

    #[cfg(target_os = "macos")]
    if !no_open && !use_browser {
        let server_dist = dist_dir.clone();
        thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let root = server_dist.clone();
                thread::spawn(move || handle_client(stream, &root));
            }
        });
        let url_c = std::ffi::CString::new(launch_url).expect("valid url");
        let icon_c = std::ffi::CString::new(resolve_macos_icon_path()).expect("valid icon path");
        unsafe {
            synlexa_run_macos_native_window(url_c.as_ptr(), icon_c.as_ptr());
        }
        return;
    }

    if !no_open {
        if use_browser {
            open_browser(&launch_url);
        } else {
            open_app_window(&launch_url);
        }
    }

    for stream in listener.incoming().flatten() {
        let root = dist_dir.clone();
        thread::spawn(move || handle_client(stream, &root));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn translates_valid_deep_link_with_query() {
        let out = translate_deep_link_to_local_url(
            "synlexa-studio://auth/callback?code=abc123&state=xyz789",
            4179,
        )
        .expect("should translate valid deep link");
        assert_eq!(
            out,
            "http://127.0.0.1:4179/?studio_auth=callback&code=abc123&state=xyz789"
        );
    }

    #[test]
    fn translates_valid_deep_link_without_query_and_strips_fragment() {
        let no_query = translate_deep_link_to_local_url("synlexa-studio://auth/callback", 5173)
            .expect("should translate deep link without query");
        assert_eq!(no_query, "http://127.0.0.1:5173/?studio_auth=callback");

        let with_fragment = translate_deep_link_to_local_url(
            "SYNLEXA-STUDIO://AUTH/CALLBACK?error=access_denied#section",
            8080,
        )
        .expect("should strip fragment");
        assert_eq!(
            with_fragment,
            "http://127.0.0.1:8080/?studio_auth=callback&error=access_denied"
        );
    }

    #[test]
    fn rejects_invalid_deep_links() {
        assert!(translate_deep_link_to_local_url("", 4179).is_err());
        assert!(
            translate_deep_link_to_local_url("https://synlexa.com/auth/callback?code=1", 4179)
                .is_err()
        );
        assert!(
            translate_deep_link_to_local_url("synlexa-studio://auth/other?code=1", 4179).is_err()
        );
        assert!(translate_deep_link_to_local_url(
            "synlexa-studio://auth/callback/extra?code=1",
            4179
        )
        .is_err());
        assert!(translate_deep_link_to_local_url(
            "synlexa-studio://auth/callback?code=a\r\nX: y",
            4179
        )
        .is_err());
    }

    #[test]
    fn translates_http_auth_callback_route_to_302_location() {
        assert_eq!(
            translate_http_auth_callback_redirect("/auth/callback?code=c1&state=s2"),
            Some("/?studio_auth=callback&code=c1&state=s2".to_string())
        );
        assert_eq!(
            translate_http_auth_callback_redirect("/auth/callback"),
            Some("/?studio_auth=callback".to_string())
        );
        assert_eq!(
            translate_http_auth_callback_redirect("/index.html?code=c1"),
            None
        );
        assert_eq!(
            translate_http_auth_callback_redirect("/auth/callback?code=a\r\nLocation: evil"),
            None
        );
    }

    #[test]
    fn http_server_returns_302_redirect_for_auth_callback() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind ephemeral port");
        let addr = listener.local_addr().unwrap();
        let handle = thread::spawn(move || {
            if let Ok((stream, _)) = listener.accept() {
                handle_client(stream, Path::new("."));
            }
        });

        let mut client = TcpStream::connect(addr).expect("connect to test host");
        client
            .write_all(b"GET /auth/callback?code=test_code&state=test_state HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
            .unwrap();
        let mut raw = String::new();
        client.read_to_string(&mut raw).unwrap();
        handle.join().unwrap();

        assert!(raw.starts_with("HTTP/1.1 302 Found\r\n"));
        assert!(raw.contains("Location: /?studio_auth=callback&code=test_code&state=test_state\r\n"));
    }

    #[test]
    fn encrypts_and_persists_keys_into_state_vscdb_without_plaintext() {
        let tmp = env::temp_dir().join(format!("synlexa-vscdb-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        write_vault_key_to_dir(&tmp, "anthropic", "sk-ant-secret-9988").unwrap();
        write_vault_key_to_dir(&tmp, "openai", "sk-openai-secret-1122").unwrap();

        let loaded = read_vault_keys_from_dir(&tmp);
        assert_eq!(loaded.get("anthropic").map(String::as_str), Some("sk-ant-secret-9988"));
        assert_eq!(loaded.get("openai").map(String::as_str), Some("sk-openai-secret-1122"));

        // Verify plaintext is NOT stored in state.vscdb bytes
        let db_file = tmp.join("state.vscdb");
        if db_file.exists() {
            let bytes = fs::read(&db_file).unwrap();
            let raw = String::from_utf8_lossy(&bytes);
            assert!(!raw.contains("sk-ant-secret-9988"));
            assert!(!raw.contains("sk-openai-secret-1122"));
        }

        write_vault_key_to_dir(&tmp, "anthropic", "").unwrap();
        let after = read_vault_keys_from_dir(&tmp);
        assert!(!after.contains_key("anthropic"));
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn handles_http_mcp_smiles_request() {
        let out = handle_http_mcp(
            r#"{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"analyze_molecule_smiles","arguments":{"name":"Acetazolamide","smiles":"CC(=O)Nc1nnc(S(N)(=O)=O)s1"}}}"#,
        );
        assert!(out.contains("C4H6N4O3S2"));
    }
}
