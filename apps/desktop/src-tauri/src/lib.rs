use synlexa_bio_core::structure::{parse_structure, SourceTypeHint};
use synlexa_bio_core::superpose::{compare_structures, StructureMeta};
use synlexa_bio_core::RUO_NOTICE;
use tauri::Emitter;
use tauri_plugin_deep_link::DeepLinkExt;

fn is_studio_auth_callback_url(url: &tauri::Url) -> bool {
    if !url.scheme().eq_ignore_ascii_case("synlexa-studio") {
        return false;
    }
    let path = url.path().trim_end_matches('/');
    match url.host_str() {
        Some(host) => host.eq_ignore_ascii_case("auth") && path == "/callback",
        None => path == "auth/callback" || path == "/auth/callback",
    }
}

#[tauri::command]
pub fn get_ruo_notice() -> &'static str {
    RUO_NOTICE
}

#[tauri::command]
pub fn detect_local_compute_env() -> String {
    let probe = |cmd: &str, arg: &str| -> bool {
        std::process::Command::new(cmd)
            .arg(arg)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    };
    let has_python = probe("python3", "--version");
    let has_docker = probe("docker", "--version");
    let has_nvidia = probe("nvidia-smi", "--version");
    let has_conda = probe("conda", "--version");
    format!(
        "{{\"python3\":{},\"docker\":{},\"nvidiaSmi\":{},\"conda\":{},\"recommendedCmd\":\"cd services/compute-worker && python3 -m synlexa_compute.server --port 4180\"}}",
        has_python, has_docker, has_nvidia, has_conda
    )
}

#[tauri::command]
pub fn inspect_structure_native(content: String) -> Result<String, String> {
    let parsed = parse_structure(&content, SourceTypeHint::Auto).map_err(|e| e.to_string())?;
    Ok(parsed.to_inspect_json().to_json_string())
}

#[tauri::command]
pub fn compare_structures_native(
    ref_label: String,
    ref_content: String,
    ref_chain: Option<String>,
    mob_label: String,
    mob_content: String,
    mob_chain: Option<String>,
    pae_json: Option<String>,
) -> Result<String, String> {
    let ref_parsed =
        parse_structure(&ref_content, SourceTypeHint::Auto).map_err(|e| e.to_string())?;
    let mob_parsed =
        parse_structure(&mob_content, SourceTypeHint::Auto).map_err(|e| e.to_string())?;
    let cmp = compare_structures(
        &ref_label,
        ref_parsed,
        ref_chain.as_deref(),
        StructureMeta::default(),
        &mob_label,
        mob_parsed,
        mob_chain.as_deref(),
        StructureMeta::default(),
        pae_json.as_deref(),
        "native-rust",
        "2026-11-15T00:00:00Z",
    )
    .map_err(|e| e.to_string())?;
    Ok(cmp.to_json().to_json_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    if is_studio_auth_callback_url(&url) {
                        // Forward URI to frontend listener without logging sensitive auth codes.
                        let _ = handle.emit("studio-auth-callback", url.to_string());
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_ruo_notice,
            detect_local_compute_env,
            inspect_structure_native,
            compare_structures_native
        ])
        .run(tauri::generate_context!())
        .expect("error while running Synlexa Studio Tauri application");
}
