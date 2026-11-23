/// Every command of lib.rs. Declared here, a command can only be called from a
/// window whose capability grants it (capabilities/*.json, "allow-<command>"):
/// without this list, any window could call any of them.
const COMMANDS: &[&str] = &[
    "get_data_dir",
    "set_language",
    "set_data_dir",
    "suggest_data_dir",
    "pick_data_dir",
    "hostname",
    "load_all",
    "write_file",
    "remove_path",
    "write_attachment",
    "read_attachment",
    "reveal_attachment",
    "list_snapshots",
    "save_snapshot",
    "delete_snapshot",
    "restore_snapshot",
    "save_export",
    "list_reading",
    "write_reading",
    "remove_reading",
    "list_inbox",
    "read_inbox",
    "remove_inbox",
    "list_reviews",
    "forge_hosts",
    "set_forge_host",
    "open_pr_popup",
    "pr_popup_layout",
];

fn main() {
    let mut attributes = tauri_build::Attributes::new()
        .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS));
    // Tauri embeds the Windows manifest (common controls 6) in the app only; the
    // test executables need it too, or Windows refuses to start them
    // (STATUS_ENTRYPOINT_NOT_FOUND). So it is given to the linker for all of them.
    let windows = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows");
    let msvc = std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc");
    if windows && msvc {
        attributes = attributes
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
        let manifest = std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap())
            .join("windows-app-manifest.xml");
        println!("cargo:rerun-if-changed=windows-app-manifest.xml");
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
    }
    tauri_build::try_build(attributes).expect("tauri build");
}
