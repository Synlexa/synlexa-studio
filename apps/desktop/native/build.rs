use std::env;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os != "macos" {
        return;
    }

    println!("cargo:rerun-if-changed=src/macos_window.m");

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR not set"));
    let obj_path = out_dir.join("macos_window.o");
    let lib_path = out_dir.join("libmacos_window.a");
    let target = env::var("TARGET").unwrap_or_else(|_| "aarch64-apple-darwin".to_string());

    let mut clang = Command::new("clang");
    clang
        .args(["-c", "-x", "objective-c", "-fobjc-arc", "-O2"])
        .args(["-mmacosx-version-min=11.0"])
        .args(["-target", &target])
        .arg("src/macos_window.m")
        .arg("-o")
        .arg(&obj_path);

    let clang_out = clang.output().expect("failed to invoke clang");
    if !clang_out.status.success() {
        panic!(
            "clang failed compiling src/macos_window.m:\nstdout: {}\nstderr: {}",
            String::from_utf8_lossy(&clang_out.stdout),
            String::from_utf8_lossy(&clang_out.stderr)
        );
    }

    let ar_out = Command::new("ar")
        .arg("crs")
        .arg(&lib_path)
        .arg(&obj_path)
        .output()
        .expect("failed to invoke ar");
    if !ar_out.status.success() {
        panic!(
            "ar failed creating libmacos_window.a:\n{}",
            String::from_utf8_lossy(&ar_out.stderr)
        );
    }

    println!("cargo:rustc-link-search=native={}", out_dir.display());
    println!("cargo:rustc-link-lib=static=macos_window");
    println!("cargo:rustc-link-lib=framework=Cocoa");
    println!("cargo:rustc-link-lib=framework=WebKit");
}
