//! Todoom backend: stores everything as small JSON files inside a folder
//! (typically synced by Google Drive) and notifies the UI when another
//! machine changes something.

use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime},
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
    files: Mutex<HashMap<PathBuf, CachedFile>>,
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
async fn set_data_dir(app: AppHandle, path: String) -> Result<(), String> {
    blocking(app, move |app| {
        let state = app.state::<AppState>();
        fs::create_dir_all(&path).map_err(|e| format!("Impossible de créer {path} : {e}"))?;
        {
            let mut cfg = state.config.lock().unwrap();
            cfg.data_dir = Some(path);
            let json = serde_json::to_string_pretty(&*cfg).map_err(|e| e.to_string())?;
            fs::write(config_path(app)?, json).map_err(|e| e.to_string())?;
        }
        state.files.lock().unwrap().clear();
        start_watcher(app, &state);
        Ok(())
    })
    .await
}

#[tauri::command]
async fn suggest_data_dir(app: AppHandle) -> Result<Option<String>, String> {
    blocking(app, |_| Ok(find_drive_folder())).await
}

/// Looks for a local Google Drive folder and proposes `<Drive>/Todoom`.
fn find_drive_folder() -> Option<String> {
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

/// Lists the JSON files, rereading only those whose size or modification time changed:
/// on Google Drive a listing costs ~30 ms while reading every file costs seconds.
fn walk(
    root: &Path,
    dir: &Path,
    cache: &mut HashMap<PathBuf, CachedFile>,
    seen: &mut Vec<PathBuf>,
    out: &mut Vec<FileEntry>,
) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = entry.metadata() else { continue };
        if meta.is_dir() {
            walk(root, &path, cache, seen, out);
            continue;
        }
        if !path.extension().is_some_and(|e| e == "json") {
            continue;
        }
        let Ok(rel) = path.strip_prefix(root) else { continue };
        let rel = rel.to_string_lossy().replace('\\', "/");
        let modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        let fresh = cache
            .get(&path)
            .is_some_and(|c| c.modified == modified && c.len == meta.len());
        if !fresh {
            let Ok(content) = fs::read_to_string(&path) else { continue };
            cache.insert(path.clone(), CachedFile { modified, len: meta.len(), content });
        }
        out.push(FileEntry { path: rel, content: cache[&path].content.clone() });
        seen.push(path);
    }
}

#[tauri::command]
async fn load_all(app: AppHandle) -> Result<Vec<FileEntry>, String> {
    blocking(app, |app| {
        let state = app.state::<AppState>();
        let root = data_root(&state)?;
        let mut cache = state.files.lock().unwrap();
        let (mut seen, mut out) = (Vec::new(), Vec::new());
        walk(&root, &root, &mut cache, &mut seen, &mut out);
        let seen: HashSet<_> = seen.into_iter().collect();
        cache.retain(|p, _| seen.contains(p));
        Ok(out)
    })
    .await
}

/// Writes through a temp file + rename so a half-written file never gets synced.
#[tauri::command]
async fn write_file(app: AppHandle, path: String, content: String) -> Result<(), String> {
    blocking(app, move |app| {
        let state = app.state::<AppState>();
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
    })
    .await
}

#[tauri::command]
async fn remove_path(app: AppHandle, path: String) -> Result<(), String> {
    blocking(app, move |app| {
        let state = app.state::<AppState>();
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
    })
    .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AppState::default())
        .setup(|app| {
            let handle = app.handle().clone();
            let state = app.state::<AppState>();
            *state.config.lock().unwrap() = load_config(&handle);
            start_watcher(&handle, &state);
            // Shows which build is running, e.g. "Todoom v0.2.1".
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title(&format!("Todoom v{}", app.package_info().version));
            }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn load(root: &Path, cache: &mut HashMap<PathBuf, CachedFile>) -> Vec<(String, String)> {
        let (mut seen, mut out) = (Vec::new(), Vec::new());
        walk(root, root, cache, &mut seen, &mut out);
        let seen: HashSet<_> = seen.into_iter().collect();
        cache.retain(|p, _| seen.contains(p));
        let mut files: Vec<_> = out.into_iter().map(|f| (f.path, f.content)).collect();
        files.sort();
        files
    }

    #[test]
    fn walk_cache_follows_changes() {
        let root = std::env::temp_dir().join(format!("todoom-walk-{}", std::process::id()));
        let cards = root.join("boards/b1/cards");
        fs::create_dir_all(&cards).unwrap();
        fs::write(root.join("boards/b1/board.json"), "board").unwrap();
        fs::write(cards.join("c1.json"), "v1").unwrap();
        fs::write(cards.join("skip.json.tmp"), "tmp").unwrap();
        let mut cache = HashMap::new();

        assert_eq!(
            load(&root, &mut cache),
            [("boards/b1/board.json".into(), "board".into()), ("boards/b1/cards/c1.json".into(), "v1".into())]
        );

        fs::write(cards.join("c1.json"), "version 2").unwrap();
        fs::write(cards.join("c2.json"), "new").unwrap();
        fs::remove_file(root.join("boards/b1/board.json")).unwrap();
        assert_eq!(
            load(&root, &mut cache),
            [("boards/b1/cards/c1.json".into(), "version 2".into()), ("boards/b1/cards/c2.json".into(), "new".into())]
        );
        assert_eq!(cache.len(), 2);

        fs::remove_dir_all(&root).unwrap();
    }
}
