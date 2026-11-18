//! Synlexa Cloud account commands for the Studio CLI (Research-Use-Only).
//!
//! `login`, `login --device`, `whoami`, `usage`, `upgrade` and `logout` talk to
//! synlexa.com; every local analysis command keeps working signed out and
//! offline. Sign-in uses OAuth 2.0 with PKCE and a loopback redirect
//! (RFC 7636, RFC 8252) or, on machines without a browser, the device
//! authorization grant (RFC 8628). Tokens are kept in the OS keychain on macOS
//! and Windows and in a 0600 file elsewhere, and are never printed or logged.

use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::Command;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use synlexa_bio_core::json::{parse_json, JsonValue};
use synlexa_bio_core::CoreError;

pub const CLIENT_ID: &str = "synlexa-studio-cli";
pub const DEFAULT_CLOUD_URL: &str = "https://www.synlexa.com";
const LOGIN_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const REFRESH_SKEW_SECS: u64 = 60;
const KEYCHAIN_SERVICE: &str = "synlexa-studio-cli";
const KEYCHAIN_ACCOUNT: &str = "default";

fn auth_error(message: impl Into<String>) -> CoreError {
    CoreError::new("ERR_AUTH", message.into())
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// synlexa.com, or `SYNLEXA_CLOUD_URL` for a local or self-hosted website.
pub fn cloud_url() -> String {
    env::var("SYNLEXA_CLOUD_URL")
        .ok()
        .map(|v| v.trim().trim_end_matches('/').to_string())
        .filter(|v| v.starts_with("https://") || v.starts_with("http://127.0.0.1") || v.starts_with("http://localhost"))
        .unwrap_or_else(|| DEFAULT_CLOUD_URL.to_string())
}

// ---------------------------------------------------------------------------
// PKCE and URL helpers
// ---------------------------------------------------------------------------

pub fn base64url(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity(bytes.len() * 4 / 3 + 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        let chars = chunk.len() + 1;
        for i in 0..chars {
            out.push(ALPHABET[((n >> (18 - 6 * i)) & 63) as usize] as char);
        }
    }
    out
}

fn random_bytes(len: usize) -> Result<Vec<u8>, CoreError> {
    use ring::rand::SecureRandom;
    let mut buf = vec![0u8; len];
    ring::rand::SystemRandom::new()
        .fill(&mut buf)
        .map_err(|_| auth_error("The system random number generator is unavailable"))?;
    Ok(buf)
}

pub fn pkce_challenge(verifier: &str) -> String {
    base64url(ring::digest::digest(&ring::digest::SHA256, verifier.as_bytes()).as_ref())
}

pub fn percent_encode(value: &str) -> String {
    let mut out = String::new();
    for b in value.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < bytes.len() => {
                let hex = |c: u8| (c as char).to_digit(16);
                match (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                    (Some(hi), Some(lo)) => {
                        out.push((hi * 16 + lo) as u8);
                        i += 2;
                    }
                    _ => out.push(b'%'),
                }
            }
            other => out.push(other),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn query_param(query: &str, key: &str) -> Option<String> {
    query.split('&').find_map(|pair| {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        (percent_decode(k) == key).then(|| percent_decode(v))
    })
}

/// The result of the browser redirect to the loopback listener.
#[derive(Debug, PartialEq)]
pub enum Callback {
    Code(String),
    Error(String),
}

/// Parses `GET /callback?code=..&state=.. HTTP/1.1`. None for other paths
/// (favicon requests), an error for a wrong state.
pub fn parse_callback_request(request_line: &str, expected_state: &str) -> Option<Result<Callback, CoreError>> {
    let target = request_line.split_whitespace().nth(1)?;
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    if path != "/callback" {
        return None;
    }
    if query_param(query, "state").as_deref() != Some(expected_state) {
        return Some(Err(auth_error("Sign-in response did not match this request (state mismatch). Try again.")));
    }
    if let Some(err) = query_param(query, "error") {
        return Some(Ok(Callback::Error(err)));
    }
    match query_param(query, "code") {
        Some(code) if !code.is_empty() => Some(Ok(Callback::Code(code))),
        _ => Some(Err(auth_error("Sign-in response had no authorization code"))),
    }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

struct HttpResponse {
    status: u16,
    body: JsonValue,
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(30))
        .user_agent(&format!("studio-cli/{}", env!("CARGO_PKG_VERSION")))
        .build()
}

fn finish(result: Result<ureq::Response, ureq::Error>) -> Result<HttpResponse, CoreError> {
    let response = match result {
        Ok(r) => r,
        Err(ureq::Error::Status(_, r)) => r,
        Err(e) => return Err(CoreError::new("ERR_NETWORK", format!("Could not reach Synlexa Cloud: {}", e))),
    };
    let status = response.status();
    let text = response.into_string().unwrap_or_default();
    let body = parse_json(&text).unwrap_or(JsonValue::Null);
    Ok(HttpResponse { status, body })
}

fn post_json(url: &str, body: &JsonValue) -> Result<HttpResponse, CoreError> {
    finish(
        agent()
            .post(url)
            .set("Content-Type", "application/json")
            .set("Accept", "application/json")
            .send_string(&body.to_json_string()),
    )
}

fn get_json(url: &str, bearer: &str) -> Result<HttpResponse, CoreError> {
    finish(
        agent()
            .get(url)
            .set("Accept", "application/json")
            .set("Authorization", &format!("Bearer {}", bearer))
            .call(),
    )
}

fn str_field(value: &JsonValue, key: &str) -> Option<String> {
    value.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
}

fn oauth_error(body: &JsonValue) -> String {
    str_field(body, "error").unwrap_or_else(|| "server_error".to_string())
}

fn oauth_description(body: &JsonValue) -> String {
    str_field(body, "error_description")
        .or_else(|| str_field(body, "error"))
        .unwrap_or_else(|| "Synlexa Cloud did not accept the request".to_string())
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub struct Credentials {
    pub cloud_url: String,
    pub access_token: String,
    pub refresh_token: String,
    /// Unix seconds when the access token expires.
    pub expires_at: u64,
    pub email: Option<String>,
}

impl Credentials {
    pub fn to_json(&self) -> JsonValue {
        JsonValue::object(vec![
            ("cloudUrl", JsonValue::String(self.cloud_url.clone())),
            ("accessToken", JsonValue::String(self.access_token.clone())),
            ("refreshToken", JsonValue::String(self.refresh_token.clone())),
            ("expiresAt", JsonValue::Number(self.expires_at as f64)),
            ("email", self.email.clone().map(JsonValue::String).unwrap_or(JsonValue::Null)),
        ])
    }

    pub fn from_json(value: &JsonValue) -> Option<Self> {
        Some(Credentials {
            cloud_url: str_field(value, "cloudUrl")?,
            access_token: str_field(value, "accessToken")?,
            refresh_token: str_field(value, "refreshToken")?,
            expires_at: value.get("expiresAt")?.as_f64()? as u64,
            email: str_field(value, "email"),
        })
    }

    fn from_token_response(body: &JsonValue, cloud_url: &str, previous_email: Option<String>) -> Option<Self> {
        let expires_in = body.get("expires_in").and_then(|v| v.as_f64()).unwrap_or(3600.0) as u64;
        Some(Credentials {
            cloud_url: cloud_url.to_string(),
            access_token: str_field(body, "access_token")?,
            refresh_token: str_field(body, "refresh_token")?,
            expires_at: now_secs() + expires_in,
            email: str_field(body, "email").or(previous_email),
        })
    }

    pub fn needs_refresh(&self, now: u64) -> bool {
        self.expires_at <= now + REFRESH_SKEW_SECS
    }
}

/// Where credentials are kept: the OS keychain where available, else a 0600 file.
/// `SYNLEXA_CLI_CREDENTIAL_STORE=file` forces the file (CI, containers).
pub struct CredentialStore {
    file: PathBuf,
}

fn config_dir() -> PathBuf {
    let home = env::var("HOME").or_else(|_| env::var("USERPROFILE")).unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".synlexa-studio")
}

impl CredentialStore {
    pub fn default_store() -> Self {
        let file = env::var("SYNLEXA_CLI_CREDENTIALS_FILE")
            .map(PathBuf::from)
            .unwrap_or_else(|_| config_dir().join("credentials.json"));
        CredentialStore { file }
    }

    #[cfg(test)]
    pub fn at(file: PathBuf) -> Self {
        CredentialStore { file }
    }

    fn use_keychain(&self) -> bool {
        cfg!(any(target_os = "macos", target_os = "windows"))
            && env::var("SYNLEXA_CLI_CREDENTIAL_STORE").map(|v| v != "file").unwrap_or(true)
            && env::var("SYNLEXA_CLI_CREDENTIALS_FILE").is_err()
    }

    pub fn load(&self) -> Option<Credentials> {
        let raw = if self.use_keychain() {
            keychain::get().or_else(|| fs::read_to_string(&self.file).ok())
        } else {
            fs::read_to_string(&self.file).ok()
        }?;
        Credentials::from_json(&parse_json(&raw).ok()?)
    }

    /// Saves the credentials and says where they went.
    pub fn save(&self, creds: &Credentials) -> Result<String, CoreError> {
        let text = creds.to_json().to_json_string();
        if self.use_keychain() && keychain::set(&text) {
            let _ = fs::remove_file(&self.file);
            return Ok("the system keychain".to_string());
        }
        write_private_file(&self.file, &text)?;
        Ok(format!("{} (readable only by you)", self.file.display()))
    }

    pub fn clear(&self) {
        if self.use_keychain() {
            keychain::delete();
        }
        let _ = fs::remove_file(&self.file);
    }
}

fn write_private_file(path: &PathBuf, text: &str) -> Result<(), CoreError> {
    let io_err = |e: std::io::Error| CoreError::new("ERR_INVALID_INPUT", format!("Could not save credentials: {}", e));
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(io_err)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(dir, fs::Permissions::from_mode(0o700));
        }
    }
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).map_err(io_err)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(0o600)).map_err(io_err)?;
    }
    file.write_all(text.as_bytes()).map_err(io_err)
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
mod keychain {
    use super::{KEYCHAIN_ACCOUNT, KEYCHAIN_SERVICE};

    fn entry() -> Option<keyring::Entry> {
        keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).ok()
    }
    pub fn get() -> Option<String> {
        entry()?.get_password().ok()
    }
    pub fn set(value: &str) -> bool {
        entry().map(|e| e.set_password(value).is_ok()).unwrap_or(false)
    }
    pub fn delete() {
        if let Some(e) = entry() {
            let _ = e.delete_credential();
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod keychain {
    pub fn get() -> Option<String> {
        None
    }
    pub fn set(_value: &str) -> bool {
        false
    }
    pub fn delete() {}
}

// ---------------------------------------------------------------------------
// Sign-in
// ---------------------------------------------------------------------------

fn open_browser(url: &str) -> bool {
    let status = if cfg!(target_os = "macos") {
        Command::new("open").arg(url).status()
    } else if cfg!(target_os = "windows") {
        Command::new("rundll32").args(["url.dll,FileProtocolHandler", url]).status()
    } else {
        Command::new("xdg-open").arg(url).status()
    };
    status.map(|s| s.success()).unwrap_or(false)
}

fn device_name() -> Option<String> {
    let name = env::var("HOSTNAME")
        .or_else(|_| env::var("COMPUTERNAME"))
        .ok()
        .or_else(|| Command::new("hostname").output().ok().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()))?;
    let trimmed: String = name.chars().filter(|c| !c.is_control()).take(120).collect();
    (!trimmed.is_empty()).then_some(trimmed)
}

const CALLBACK_PAGE_OK: &str = "<!doctype html><meta charset=utf-8><title>Synlexa Studio CLI</title>\
<body style=\"font-family:system-ui;margin:4rem auto;max-width:32rem;text-align:center\">\
<h1>Signed in</h1><p>You can close this tab and return to your terminal.</p></body>";
const CALLBACK_PAGE_FAIL: &str = "<!doctype html><meta charset=utf-8><title>Synlexa Studio CLI</title>\
<body style=\"font-family:system-ui;margin:4rem auto;max-width:32rem;text-align:center\">\
<h1>Sign-in did not complete</h1><p>Return to your terminal for details.</p></body>";

fn respond(stream: &mut TcpStream, status: &str, body: &str) {
    let _ = write!(
        stream,
        "HTTP/1.1 {}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n{}",
        status,
        body.len(),
        body
    );
}

/// Waits for the browser to come back to the loopback listener with a code.
fn wait_for_callback(listener: &TcpListener, state: &str) -> Result<String, CoreError> {
    listener.set_nonblocking(true).map_err(|e| auth_error(e.to_string()))?;
    let deadline = Instant::now() + LOGIN_TIMEOUT;
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let _ = stream.set_nonblocking(false);
                let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                let mut line = String::new();
                let _ = BufReader::new(stream.try_clone().map_err(|e| auth_error(e.to_string()))?)
                    .take(8192)
                    .read_line(&mut line);
                match parse_callback_request(&line, state) {
                    None => respond(&mut stream, "404 Not Found", ""),
                    Some(Ok(Callback::Code(code))) => {
                        respond(&mut stream, "200 OK", CALLBACK_PAGE_OK);
                        return Ok(code);
                    }
                    Some(Ok(Callback::Error(err))) => {
                        respond(&mut stream, "200 OK", CALLBACK_PAGE_FAIL);
                        return Err(auth_error(format!("Sign-in was not completed on synlexa.com ({})", err)));
                    }
                    Some(Err(err)) => {
                        respond(&mut stream, "400 Bad Request", CALLBACK_PAGE_FAIL);
                        return Err(err);
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => thread::sleep(Duration::from_millis(150)),
            Err(e) => return Err(auth_error(e.to_string())),
        }
    }
    Err(auth_error("Timed out waiting for sign-in in the browser (5 minutes). Run `studio-cli login` again."))
}

fn browser_login(cloud: &str, open: bool) -> Result<Credentials, CoreError> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| auth_error(format!("Could not listen on localhost: {}", e)))?;
    let port = listener.local_addr().map_err(|e| auth_error(e.to_string()))?.port();
    let redirect_uri = format!("http://127.0.0.1:{}/callback", port);
    let verifier = base64url(&random_bytes(48)?);
    let state = base64url(&random_bytes(24)?);
    let url = format!(
        "{}/auth/studio-connect?mode=signin&client_id={}&redirect_uri={}&code_challenge={}&code_challenge_method=S256&state={}",
        cloud,
        CLIENT_ID,
        percent_encode(&redirect_uri),
        pkce_challenge(&verifier),
        state
    );

    let opened = open && open_browser(&url);
    if opened {
        println!("Opening your browser to sign in to Synlexa…");
        println!("If it did not open, visit:\n\n  {}\n", url);
    } else {
        println!("Open this link in a browser on this computer to sign in:\n\n  {}\n", url);
    }
    println!("Waiting for sign-in (Ctrl-C to cancel)…");

    let code = wait_for_callback(&listener, &state)?;
    let mut body = vec![
        ("grant_type", JsonValue::String("authorization_code".into())),
        ("code", JsonValue::String(code)),
        ("code_verifier", JsonValue::String(verifier)),
        ("redirect_uri", JsonValue::String(redirect_uri)),
        ("client_id", JsonValue::String(CLIENT_ID.into())),
    ];
    if let Some(name) = device_name() {
        body.push(("device_name", JsonValue::String(name)));
    }
    let res = post_json(&format!("{}/api/studio/token", cloud), &JsonValue::object(body))?;
    if res.status != 200 {
        return Err(auth_error(format!("Sign-in failed: {}", oauth_description(&res.body))));
    }
    Credentials::from_token_response(&res.body, cloud, None).ok_or_else(|| auth_error("Sign-in response was incomplete"))
}

fn device_login(cloud: &str) -> Result<Credentials, CoreError> {
    let mut body = vec![("client_id", JsonValue::String(CLIENT_ID.into()))];
    if let Some(name) = device_name() {
        body.push(("device_name", JsonValue::String(name)));
    }
    let start = post_json(&format!("{}/api/studio/device", cloud), &JsonValue::object(body))?;
    let (Some(device_code), Some(user_code), Some(verify)) = (
        str_field(&start.body, "device_code"),
        str_field(&start.body, "user_code"),
        str_field(&start.body, "verification_uri"),
    ) else {
        return Err(auth_error(format!("Could not start device sign-in: {}", oauth_description(&start.body))));
    };
    let mut interval = start.body.get("interval").and_then(|v| v.as_f64()).unwrap_or(5.0).max(1.0) as u64;
    let expires_in = start.body.get("expires_in").and_then(|v| v.as_f64()).unwrap_or(600.0) as u64;

    println!("On any device, open:\n\n  {}\n\nand enter the code:\n\n  {}\n", verify, user_code);
    if let Some(complete) = str_field(&start.body, "verification_uri_complete") {
        println!("(or open {} directly)\n", complete);
    }
    println!("Waiting for approval (Ctrl-C to cancel)…");

    let deadline = Instant::now() + Duration::from_secs(expires_in);
    let poll_body = JsonValue::object(vec![
        ("grant_type", JsonValue::String("urn:ietf:params:oauth:grant-type:device_code".into())),
        ("device_code", JsonValue::String(device_code)),
        ("client_id", JsonValue::String(CLIENT_ID.into())),
    ]);
    while Instant::now() < deadline {
        thread::sleep(Duration::from_secs(interval));
        let res = post_json(&format!("{}/api/studio/token", cloud), &poll_body)?;
        if res.status == 200 {
            return Credentials::from_token_response(&res.body, cloud, None)
                .ok_or_else(|| auth_error("Sign-in response was incomplete"));
        }
        match oauth_error(&res.body).as_str() {
            "authorization_pending" => {}
            "slow_down" => interval += 5,
            "access_denied" => return Err(auth_error("Sign-in was declined on synlexa.com")),
            "expired_token" => return Err(auth_error("The code expired. Run `studio-cli login --device` again.")),
            _ => return Err(auth_error(format!("Sign-in failed: {}", oauth_description(&res.body)))),
        }
    }
    Err(auth_error("The code expired. Run `studio-cli login --device` again."))
}

// ---------------------------------------------------------------------------
// Token freshness and authenticated calls
// ---------------------------------------------------------------------------

fn refresh(store: &CredentialStore, creds: &Credentials) -> Result<Credentials, CoreError> {
    let res = post_json(
        &format!("{}/api/studio/token", creds.cloud_url),
        &JsonValue::object(vec![
            ("grant_type", JsonValue::String("refresh_token".into())),
            ("refresh_token", JsonValue::String(creds.refresh_token.clone())),
            ("client_id", JsonValue::String(CLIENT_ID.into())),
        ]),
    )?;
    if res.status == 200 {
        let next = Credentials::from_token_response(&res.body, &creds.cloud_url, creds.email.clone())
            .ok_or_else(|| auth_error("Refresh response was incomplete"))?;
        store.save(&next)?;
        return Ok(next);
    }
    if res.status == 400 || res.status == 401 {
        store.clear();
        return Err(auth_error("Your sign-in has ended. Run `studio-cli login` to sign in again."));
    }
    Err(CoreError::new("ERR_NETWORK", format!("Could not refresh sign-in: {}", oauth_description(&res.body))))
}

fn signed_in(store: &CredentialStore) -> Result<Credentials, CoreError> {
    let creds = store
        .load()
        .ok_or_else(|| auth_error("Not signed in. Run `studio-cli login` (or `studio-cli login --device`)."))?;
    if creds.needs_refresh(now_secs()) {
        return refresh(store, &creds);
    }
    Ok(creds)
}

/// GET with the access token, refreshing once on 401.
fn authed_get(store: &CredentialStore, path: &str) -> Result<JsonValue, CoreError> {
    let mut creds = signed_in(store)?;
    for attempt in 0..2 {
        let res = get_json(&format!("{}{}", creds.cloud_url, path), &creds.access_token)?;
        if res.status == 401 && attempt == 0 {
            creds = refresh(store, &creds)?;
            continue;
        }
        if res.status != 200 {
            let msg = res
                .body
                .get("error")
                .and_then(|e| e.as_str().map(|s| s.to_string()).or_else(|| e.get("message").and_then(|m| m.as_str()).map(|s| s.to_string())))
                .unwrap_or_else(|| format!("HTTP {}", res.status));
            return Err(CoreError::new("ERR_NETWORK", format!("Synlexa Cloud: {}", msg)));
        }
        return Ok(res.body);
    }
    Err(auth_error("Your sign-in has ended. Run `studio-cli login` to sign in again."))
}

fn entitlements(store: &CredentialStore) -> Result<JsonValue, CoreError> {
    let body = authed_get(store, "/api/studio/entitlements")?;
    body.get("entitlements").cloned().ok_or_else(|| CoreError::new("ERR_NETWORK", "Unexpected entitlements response"))
}

fn plan_name(plan: &str) -> &str {
    match plan {
        "free" => "Free",
        "starter" => "Starter",
        "pro" => "Pro",
        "team" => "Team",
        "enterprise" => "Enterprise",
        other => other,
    }
}

fn window_label(kind: &str) -> &str {
    match kind {
        "five_hour" => "5-hour session",
        "daily" => "Last 24 hours",
        "weekly" => "This week",
        other => other,
    }
}

/// One line per capped usage window, e.g. "5-hour session   25% used   resets 2027-01-01T05:00:00Z".
pub fn usage_lines(ent: &JsonValue) -> Vec<String> {
    let mut lines = Vec::new();
    for w in ent.get("usage").and_then(|u| u.as_array()).unwrap_or(&[]) {
        let Some(limit) = w.get("limit").and_then(|l| l.as_f64()) else { continue };
        let used = w.get("used").and_then(|u| u.as_f64()).unwrap_or(0.0);
        let pct = if limit > 0.0 { ((used / limit) * 100.0).round().min(100.0) as u32 } else { 0 };
        let label = window_label(w.get("kind").and_then(|k| k.as_str()).unwrap_or(""));
        let reset = match w.get("resetsAt").and_then(|r| r.as_str()) {
            Some(at) if used > 0.0 => format!("   resets {}", at),
            _ => String::new(),
        };
        lines.push(format!("{:<16} {:>3}% used{}", label, pct, reset));
    }
    if ent.get("metered").and_then(|m| m.as_bool()) == Some(true) {
        lines.push("Usage is metered and billed under your Enterprise contract.".to_string());
    }
    lines
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

fn has(args: &[String], flag: &str) -> bool {
    args.iter().any(|a| a == flag)
}

pub fn run(sub: &str, args: &[String]) -> Result<(), CoreError> {
    let store = CredentialStore::default_store();
    let json = has(args, "--json");
    match sub {
        "login" => {
            let cloud = cloud_url();
            let creds = if has(args, "--device") { device_login(&cloud)? } else { browser_login(&cloud, !has(args, "--no-browser"))? };
            let place = store.save(&creds)?;
            let who = creds.email.clone().unwrap_or_else(|| "your account".to_string());
            println!("\nSigned in to Synlexa as {}. Credentials are stored in {}.", who, place);
            if let Ok(ent) = entitlements(&store) {
                println!("Plan: {}", plan_name(ent.get("plan").and_then(|p| p.as_str()).unwrap_or("free")));
            }
            Ok(())
        }
        "logout" => {
            if let Some(creds) = store.load() {
                // Best effort: the sign-in also ends on its own when the refresh token expires.
                let _ = post_json(
                    &format!("{}/api/studio/revoke", creds.cloud_url),
                    &JsonValue::object(vec![("token", JsonValue::String(creds.refresh_token.clone()))]),
                );
                store.clear();
                println!("Signed out of Synlexa on this device.");
            } else {
                println!("Not signed in.");
            }
            Ok(())
        }
        "whoami" => {
            let creds = signed_in(&store)?;
            let ent = entitlements(&store)?;
            if json {
                println!(
                    "{}",
                    JsonValue::object(vec![
                        ("email", creds.email.clone().map(JsonValue::String).unwrap_or(JsonValue::Null)),
                        ("cloudUrl", JsonValue::String(creds.cloud_url.clone())),
                        ("entitlements", ent),
                    ])
                    .to_json_pretty()
                );
                return Ok(());
            }
            let plan = ent.get("plan").and_then(|p| p.as_str()).unwrap_or("free");
            println!("Account: {}", creds.email.as_deref().unwrap_or("(email not shared)"));
            println!("Plan:    {}", plan_name(plan));
            if let Some(models) = ent.get("allowedModels").and_then(|m| m.as_array()) {
                let names: Vec<&str> = models.iter().filter_map(|m| m.as_str()).collect();
                println!("Models:  {}", if names.is_empty() { "none".to_string() } else { names.join(", ") });
            }
            println!("Cloud:   {}", creds.cloud_url);
            Ok(())
        }
        "usage" => {
            let ent = entitlements(&store)?;
            if json {
                println!("{}", ent.get("usage").cloned().unwrap_or(JsonValue::Null).to_json_pretty());
                return Ok(());
            }
            println!("Synlexa Cloud usage ({} plan)", plan_name(ent.get("plan").and_then(|p| p.as_str()).unwrap_or("free")));
            for line in usage_lines(&ent) {
                println!("  {}", line);
            }
            println!("Your own AI API keys and local tools are not limited by your plan.");
            Ok(())
        }
        "upgrade" => {
            let before = entitlements(&store)?;
            let before_plan = before.get("plan").and_then(|p| p.as_str()).unwrap_or("free").to_string();
            let cloud = signed_in(&store)?.cloud_url;
            let url = match args.iter().position(|a| a == "--plan").and_then(|i| args.get(i + 1)).map(|s| s.as_str()) {
                Some(p @ ("starter" | "pro" | "team")) => format!("{}/pay?plan={}&interval=year", cloud, p),
                Some(other) => return Err(CoreError::new("ERR_INVALID_INPUT", format!("Unknown plan '{}'. Use starter, pro or team.", other))),
                None => format!("{}/pricing", cloud),
            };
            if !open_browser(&url) {
                println!("Open this link to choose a plan:\n\n  {}\n", url);
            } else {
                println!("Opened {} in your browser.", url);
            }
            println!("Current plan: {}. Waiting for the change (Ctrl-C to stop)…", plan_name(&before_plan));
            let deadline = Instant::now() + Duration::from_secs(15 * 60);
            while Instant::now() < deadline {
                thread::sleep(Duration::from_secs(5));
                if let Ok(ent) = entitlements(&store) {
                    let plan = ent.get("plan").and_then(|p| p.as_str()).unwrap_or("free");
                    if plan != before_plan {
                        println!("Your plan is now {}.", plan_name(plan));
                        return Ok(());
                    }
                }
            }
            println!("No plan change yet. Run `studio-cli whoami` later to check.");
            Ok(())
        }
        other => Err(CoreError::new("ERR_INVALID_INPUT", format!("Unknown subcommand '{}'", other))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_matches_rfc7636_example() {
        // RFC 7636 Appendix B.
        assert_eq!(
            pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
        assert_eq!(base64url(b"f"), "Zg");
        assert_eq!(base64url(b"fo"), "Zm8");
        assert_eq!(base64url(b"foo"), "Zm9v");
        assert_eq!(base64url(&[0xfb, 0xff]), "-_8");
    }

    #[test]
    fn random_values_are_long_and_url_safe() {
        let v = base64url(&random_bytes(48).unwrap());
        assert_eq!(v.len(), 64);
        assert!(v.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        assert_ne!(v, base64url(&random_bytes(48).unwrap()));
    }

    #[test]
    fn parses_loopback_callbacks() {
        let ok = parse_callback_request("GET /callback?code=slx_ac_abc&state=s1 HTTP/1.1", "s1");
        assert_eq!(ok.unwrap().unwrap(), Callback::Code("slx_ac_abc".into()));

        let denied = parse_callback_request("GET /callback?error=access_denied&state=s1 HTTP/1.1", "s1");
        assert_eq!(denied.unwrap().unwrap(), Callback::Error("access_denied".into()));

        assert!(parse_callback_request("GET /callback?code=x&state=other HTTP/1.1", "s1").unwrap().is_err());
        assert!(parse_callback_request("GET /favicon.ico HTTP/1.1", "s1").is_none());
        assert!(parse_callback_request("", "s1").is_none());
    }

    #[test]
    fn encodes_and_decodes_query_values() {
        assert_eq!(percent_encode("http://127.0.0.1:5/callback"), "http%3A%2F%2F127.0.0.1%3A5%2Fcallback");
        assert_eq!(query_param("a=1&redirect=http%3A%2F%2Fx%2Fy&b", "redirect").as_deref(), Some("http://x/y"));
        assert_eq!(query_param("a=1", "missing"), None);
    }

    #[test]
    fn credentials_round_trip_and_expiry() {
        let creds = Credentials {
            cloud_url: "https://www.synlexa.com".into(),
            access_token: "slx_at_1".into(),
            refresh_token: "slx_rt_1".into(),
            expires_at: 1_000,
            email: Some("r@example.org".into()),
        };
        assert_eq!(Credentials::from_json(&creds.to_json()), Some(creds.clone()));
        assert!(!creds.needs_refresh(900));
        assert!(creds.needs_refresh(941));
    }

    #[test]
    fn stores_credentials_in_a_private_file() {
        let dir = env::temp_dir().join(format!("studio-cli-test-{}", base64url(&random_bytes(6).unwrap())));
        let path = dir.join("credentials.json");
        let store = CredentialStore::at(path.clone());
        let creds = Credentials {
            cloud_url: "http://127.0.0.1:3006".into(),
            access_token: "slx_at_2".into(),
            refresh_token: "slx_rt_2".into(),
            expires_at: 5,
            email: None,
        };
        write_private_file(&path, &creds.to_json().to_json_string()).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        }
        let loaded = Credentials::from_json(&parse_json(&fs::read_to_string(&path).unwrap()).unwrap());
        assert_eq!(loaded, Some(creds));
        store.clear();
        assert!(!path.exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn summarises_usage_windows() {
        let ent = parse_json(
            r#"{"plan":"pro","metered":false,"usage":[
              {"kind":"five_hour","limit":1500,"used":375,"remaining":1125,"resetsAt":"2027-01-01T05:00:00.000Z"},
              {"kind":"daily","limit":null,"used":375,"remaining":null,"resetsAt":null},
              {"kind":"weekly","limit":6000,"used":0,"remaining":6000,"resetsAt":null}]}"#,
        )
        .unwrap();
        let lines = usage_lines(&ent);
        assert_eq!(lines.len(), 2);
        assert!(lines[0].starts_with("5-hour session") && lines[0].contains(" 25% used") && lines[0].contains("2027-01-01T05:00:00.000Z"));
        assert!(lines[1].starts_with("This week") && lines[1].contains("  0% used") && !lines[1].contains("resets"));
    }

    #[test]
    fn only_trusts_https_or_local_cloud_urls() {
        env::set_var("SYNLEXA_CLOUD_URL", "http://evil.example");
        assert_eq!(cloud_url(), DEFAULT_CLOUD_URL);
        env::set_var("SYNLEXA_CLOUD_URL", "http://127.0.0.1:3006/");
        assert_eq!(cloud_url(), "http://127.0.0.1:3006");
        env::remove_var("SYNLEXA_CLOUD_URL");
    }
}
