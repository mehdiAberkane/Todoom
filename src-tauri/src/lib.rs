//! Todoom backend: stores everything as small JSON files inside a folder
//! (typically synced by Google Drive) and notifies the UI when another
//! machine changes something.

use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime},
};

use notify_debouncer_mini::{
    DebounceEventResult, Debouncer, new_debouncer,
    notify::{RecommendedWatcher, RecursiveMode},
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

mod attachments;
mod data;
mod export;
mod folder;
mod inbox;
mod reading;
mod reviews;
mod snapshots;
mod windows;

use attachments::*;
use data::*;
use export::*;
use folder::*;
use inbox::*;
use reading::*;
use reviews::*;
use snapshots::*;
use windows::*;

/// Messages shown to the user follow the interface language, French by default.
static ENGLISH: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn tr(fr: String, en: String) -> String {
    if ENGLISH.load(std::sync::atomic::Ordering::Relaxed) {
        en
    } else {
        fr
    }
}

#[tauri::command]
fn set_language(lang: String) {
    ENGLISH.store(lang == "en", std::sync::atomic::Ordering::Relaxed);
}
/// Filesystem events this soon after one of our own writes are ignored.
const SELF_WRITE_GRACE: Duration = Duration::from_secs(3);

#[derive(Default, Clone, Serialize, Deserialize)]
struct Config {
    data_dir: Option<String>,
    /// Forge hosts (GitLab instances) the user allowed (true) or refused (false) on
    /// this computer, for the PR/MR panel. github.com and gitlab.com need no answer.
    #[serde(default)]
    forge_hosts: HashMap<String, bool>,
}

fn save_config(app: &AppHandle, cfg: &Config) -> Result<(), String> {
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(config_path(app)?, json).map_err(|e| e.to_string())
}

/// Paths we touched recently: (when, whether it covers everything below it).
type RecentWrites = Arc<Mutex<HashMap<PathBuf, (Instant, bool)>>>;

/// Last content read for a file, reused while its size and modification time are unchanged.
struct CachedFile {
    modified: SystemTime,
    len: u64,
    content: String,
}

#[derive(Default)]
struct AppState {
    config: Mutex<Config>,
    recent_writes: RecentWrites,
    watcher: Mutex<Option<Debouncer<RecommendedWatcher>>>,
    files: FileCache,
    /// Files being read by a background reader, possibly started by an earlier load.
    reading: Arc<Mutex<HashSet<PathBuf>>>,
    /// The last folder picked in the folder dialog (pick_data_dir): with the Drive
    /// folder found and the current one, the only folders set_data_dir accepts.
    picked_dir: Mutex<Option<String>>,
}

/// Runs disk work on a blocking thread. Synchronous Tauri commands run on the main
/// thread, so a slow drive (Google Drive's virtual G:) would freeze keyboard input.
async fn blocking<T, F>(app: AppHandle, work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&AppHandle) -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || work(&app))
        .await
        .map_err(|e| e.to_string())?
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("config.json"))
}

fn load_config(app: &AppHandle) -> Config {
    config_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
fn hostname() -> String {
    gethostname::gethostname().to_string_lossy().into_owned()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Journal in the app's log folder (%LOCALAPPDATA%\fr.devsecopsforce.todoom\logs on
        // Windows, ~/Library/Logs/fr.devsecopsforce.todoom on macOS), one old file kept.
        .plugin(
            tauri_plugin_log::Builder::new()
                .clear_targets()
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("todoom".into()),
                    },
                ))
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Stderr,
                ))
                .level(log::LevelFilter::Info)
                .max_file_size(1_000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(AppState::default())
        .setup(|app| {
            let handle = app.handle().clone();
            let state = app.state::<AppState>();
            *state.config.lock().unwrap() = load_config(&handle);
            log::info!("Todoom {} démarré", app.package_info().version);
            start_watcher(&handle, &state);
            // Quick capture: a shortcut taken by another program, or no notification
            // area, only loses that way in; the app runs as usual.
            {
                use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
                let shortcuts = tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(|app, _shortcut, event| {
                        if event.state == ShortcutState::Pressed {
                            open_capture(app);
                        }
                    })
                    .build();
                if let Err(e) = app.handle().plugin(shortcuts) {
                    log::warn!("raccourcis globaux indisponibles : {e}");
                } else if let Err(e) = app.global_shortcut().register(CAPTURE_SHORTCUT) {
                    log::warn!("raccourci {CAPTURE_SHORTCUT} indisponible : {e}");
                }
            }
            if let Err(e) = build_tray(app) {
                log::warn!("icône de notification impossible : {e}");
            }
            // Shows which build is running, e.g. "Todoom v0.2.1".
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title(&format!("Todoom v{}", app.package_info().version));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_data_dir,
            set_language,
            set_data_dir,
            suggest_data_dir,
            pick_data_dir,
            hostname,
            load_all,
            write_file,
            remove_path,
            write_attachment,
            read_attachment,
            reveal_attachment,
            list_snapshots,
            save_snapshot,
            delete_snapshot,
            restore_snapshot,
            save_export,
            list_reading,
            write_reading,
            remove_reading,
            list_inbox,
            read_inbox,
            remove_inbox,
            list_reviews,
            forge_hosts,
            set_forge_host,
            open_pr_popup,
            pr_popup_layout
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_older_settings_file_still_reads() {
        let cfg: Config = serde_json::from_str(r#"{"data_dir":"G:\\Mon Drive\\Todoom"}"#).unwrap();
        assert!(cfg.forge_hosts.is_empty());
        assert!(cfg.data_dir.is_some());
    }
}
