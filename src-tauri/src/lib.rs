//! Todoom backend: stores everything as small JSON files inside a folder
//! (typically synced by Google Drive) and notifies the UI when another
//! machine changes something.

use std::{
    collections::HashMap,
    fs,
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use notify_debouncer_mini::{
    new_debouncer,
    notify::{RecommendedWatcher, RecursiveMode},
    DebounceEventResult, Debouncer,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

const CHANGED_EVENT: &str = "todoom://changed";
/// Filesystem events this soon after one of our own writes are ignored.
const SELF_WRITE_GRACE: Duration = Duration::from_secs(3);

#[derive(Default, Clone, Serialize, Deserialize)]
struct Config {
    data_dir: Option<String>,
}

#[derive(Serialize)]
struct FileEntry {
    path: String,
    content: String,
}

/// Paths we touched recently: (when, whether it covers everything below it).
type RecentWrites = Arc<Mutex<HashMap<PathBuf, (Instant, bool)>>>;

#[derive(Default)]
struct AppState {
    config: Mutex<Config>,
    recent_writes: RecentWrites,
    watcher: Mutex<Option<Debouncer<RecommendedWatcher>>>,
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

fn data_root(state: &AppState) -> Result<PathBuf, String> {
    state
        .config
        .lock()
        .unwrap()
        .data_dir
        .clone()
        .map(PathBuf::from)
        .ok_or_else(|| "Aucun dossier de données configuré".into())
}

/// Joins a relative path to the data root, refusing anything that could escape it.
fn resolve(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    if rel.is_empty() || rel_path.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err(format!("Chemin invalide : {rel}"));
    }
    Ok(root.join(rel_path))
}

fn is_temp(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.ends_with(".tmp"))
}

fn remember(state: &AppState, root: &Path, path: &Path, prefix: bool) {
    let now = Instant::now();
    let mut recent = state.recent_writes.lock().unwrap();
    recent.insert(path.to_path_buf(), (now, prefix));
    for ancestor in path.ancestors().skip(1) {
        if !ancestor.starts_with(root) {
            break;
        }
        let entry = recent.entry(ancestor.to_path_buf()).or_insert((now, false));
        entry.0 = now;
    }
}

fn start_watcher(app: &AppHandle, state: &AppState) {
    let mut slot = state.watcher.lock().unwrap();
    *slot = None;
    let Ok(root) = data_root(state) else { return };
    let recent = state.recent_writes.clone();
    let handle = app.clone();
    // Heartbeats from other machines are picked up by the UI's periodic refresh.
    let presence = root.join(".presence");

    let debouncer = new_debouncer(Duration::from_millis(500), move |res: DebounceEventResult| {
        let Ok(events) = res else { return };
        let mut recent = recent.lock().unwrap();
        recent.retain(|_, (t, _)| t.elapsed() < SELF_WRITE_GRACE);
        let ours = |p: &Path| {
            recent
                .iter()
                .any(|(k, (_, prefix))| p == k || (*prefix && p.starts_with(k)))
        };
        let external = events
            .iter()
            .any(|e| !is_temp(&e.path) && !e.path.starts_with(&presence) && !ours(&e.path));
        if external {
            let _ = handle.emit(CHANGED_EVENT, ());
        }
    });

    match debouncer {
        Ok(mut d) => match d.watcher().watch(&root, RecursiveMode::Recursive) {
            Ok(()) => *slot = Some(d),
            Err(e) => eprintln!("Surveillance impossible de {}: {e}", root.display()),
        },
        Err(e) => eprintln!("Initialisation du watcher impossible: {e}"),
    }
}

#[tauri::command]
fn get_data_dir(state: State<AppState>) -> Option<String> {
    state.config.lock().unwrap().data_dir.clone()
}

#[tauri::command]
fn set_data_dir(app: AppHandle, state: State<AppState>, path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| format!("Impossible de créer {path} : {e}"))?;
    {
        let mut cfg = state.config.lock().unwrap();
        cfg.data_dir = Some(path);
        let json = serde_json::to_string_pretty(&*cfg).map_err(|e| e.to_string())?;
        fs::write(config_path(&app)?, json).map_err(|e| e.to_string())?;
    }
    start_watcher(&app, &state);
    Ok(())
}

/// Looks for a local Google Drive folder and proposes `<Drive>/Todoom`.
#[tauri::command]
fn suggest_data_dir() -> Option<String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    let names = ["Mon Drive", "My Drive"];

    #[cfg(windows)]
    for letter in std::iter::once('G').chain(('D'..='Z').filter(|&l| l != 'G')) {
        for name in names {
            candidates.push(PathBuf::from(format!("{letter}:\\{name}")));
        }
    }

    #[cfg(target_os = "macos")]
    if let Some(home) = std::env::var_os("HOME") {
        if let Ok(entries) = fs::read_dir(PathBuf::from(home).join("Library/CloudStorage")) {
            for entry in entries.flatten() {
                if entry.file_name().to_string_lossy().starts_with("GoogleDrive") {
                    for name in names {
                        candidates.push(entry.path().join(name));
                    }
                }
            }
        }
    }

    candidates
        .into_iter()
        .find(|p| p.is_dir())
        .map(|p| p.join("Todoom").to_string_lossy().into_owned())
}

#[tauri::command]
fn hostname() -> String {
    gethostname::gethostname().to_string_lossy().into_owned()
}

fn walk(root: &Path, dir: &Path, out: &mut Vec<FileEntry>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk(root, &path, out);
        } else if path.extension().is_some_and(|e| e == "json") {
            if let (Ok(content), Ok(rel)) = (fs::read_to_string(&path), path.strip_prefix(root)) {
                let path = rel.to_string_lossy().replace('\\', "/");
                out.push(FileEntry { path, content });
            }
        }
    }
}

#[tauri::command]
fn load_all(state: State<AppState>) -> Result<Vec<FileEntry>, String> {
    let root = data_root(&state)?;
    let mut out = Vec::new();
    walk(&root, &root, &mut out);
    Ok(out)
}

/// Writes through a temp file + rename so a half-written file never gets synced.
#[tauri::command]
fn write_file(state: State<AppState>, path: String, content: String) -> Result<(), String> {
    let root = data_root(&state)?;
    let target = resolve(&root, &path)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    remember(&state, &root, &target, false);
    let tmp = target.with_extension("json.tmp");
    fs::write(&tmp, &content).map_err(|e| e.to_string())?;
    if fs::rename(&tmp, &target).is_err() {
        // Some virtual drives refuse renames over existing files.
        let _ = fs::remove_file(&tmp);
        fs::write(&target, &content).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn remove_path(state: State<AppState>, path: String) -> Result<(), String> {
    let root = data_root(&state)?;
    let target = resolve(&root, &path)?;
    remember(&state, &root, &target, true);
    if target.is_dir() {
        fs::remove_dir_all(&target).map_err(|e| e.to_string())
    } else if target.exists() {
        fs::remove_file(&target).map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .setup(|app| {
            let handle = app.handle().clone();
            let state = app.state::<AppState>();
            *state.config.lock().unwrap() = load_config(&handle);
            start_watcher(&handle, &state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_data_dir,
            set_data_dir,
            suggest_data_dir,
            hostname,
            load_all,
            write_file,
            remove_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
