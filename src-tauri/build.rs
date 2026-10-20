use std::{env, path::PathBuf, process::Command};

fn rc_exe() -> Option<PathBuf> {
    let roots = [
        PathBuf::from(r"C:\Program Files (x86)\Windows Kits\10\bin"),
        PathBuf::from(r"C:\Program Files\Windows Kits\10\bin"),
    ];
    let mut found = Vec::new();
    for root in roots.iter().filter(|path| path.is_dir()) {
        let versions = std::fs::read_dir(root).ok()?;
        for version in versions.flatten() {
            let candidate = version.path().join("x64").join("rc.exe");
            if candidate.is_file() {
                found.push(candidate);
            }
        }
    }
    found.sort();
    found.pop()
}

fn main() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let assets = manifest.join("assets");
    let out = PathBuf::from(env::var("OUT_DIR").unwrap()).join("icon.res");
    let rc = rc_exe().expect("Windows rc.exe bulunamadı");
    let status = Command::new(rc)
        .current_dir(&assets)
        .arg("/nologo")
        .arg(format!("/fo{}", out.display()))
        .arg("icon.rc")
        .status()
        .expect("Simge derlenemedi");
    if !status.success() {
        panic!("Simge derlenemedi");
    }
    println!("cargo:rustc-link-arg-bins={}", out.display());
    println!("cargo:rerun-if-changed={}", assets.join("icon.ico").display());
    println!("cargo:rerun-if-changed={}", assets.join("icon.rc").display());
}
