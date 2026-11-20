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
    new_debouncer,
    notify::{RecommendedWatcher, RecursiveMode},
    DebounceEventResult, Debouncer,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

const CHANGED_EVENT: &str = "todoom://changed";

/// Messages shown to the user follow the interface language, French by default.
static ENGLISH: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn tr(fr: String, en: String) -> String {
    if ENGLISH.load(std::sync::atomic::Ordering::Relaxed) { en } else { fr }
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
    files: FileCache,
    /// Files being read by a background reader, possibly started by an earlier load.
    reading: Arc<Mutex<HashSet<PathBuf>>>,
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
        .ok_or_else(|| tr("Aucun dossier de données configuré".into(), "No data folder configured".into()))
}

/// Joins a relative path to the data root, refusing anything that could escape it.
fn resolve(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    if rel.is_empty() || rel_path.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err(tr(format!("Chemin invalide : {rel}"), format!("Invalid path: {rel}")));
    }
    Ok(root.join(rel_path))
}

#[derive(Clone, Copy, PartialEq)]
enum Access {
    Write,
    Remove,
}

/// The only paths the UI may write or delete, relative to the data folder: the
/// files Todoom itself produces. Anything else is refused, so the commands can't
/// be turned into "write or delete any file" even from injected script.
fn allowed(rel: &str, access: Access) -> bool {
    let id = |s: &str| {
        !s.is_empty() && s.len() <= 128 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    };
    let json_id = |s: &str| s.strip_suffix(".json").is_some_and(id);
    let parts: Vec<&str> = rel.split('/').collect();
    match (access, parts.as_slice()) {
        (Access::Write, ["settings.json"]) => true,
        (Access::Write, [".presence", file]) => json_id(file),
        (Access::Write, ["boards", board, "board.json"]) => id(board),
        (_, ["boards", board, "cards", file]) => id(board) && json_id(file),
        // One file per comment; a comment can be deleted.
        (_, ["boards", board, "comments", card, file]) => id(board) && id(card) && json_id(file),
        // History: one file per card and per computer (or tool), only ever rewritten by it.
        (Access::Write, ["boards", board, "history", card, file]) => id(board) && id(card) && json_id(file),
        // A card deleted for good takes its comments and history with it.
        (Access::Remove, ["boards", board, "comments" | "history", card]) => id(board) && id(card),
        (Access::Remove, ["boards", board]) => id(board),
        _ => false,
    }
}

/// Folders that must never become the data folder: a whole drive, the home folder
/// itself or a system folder would be scanned on every reload and written into.
fn check_data_dir(path: &Path) -> Result<(), String> {
    let shown = path.display();
    if !path.is_absolute() {
        return Err(tr(format!("{shown} n'est pas un chemin complet."), format!("{shown} is not a full path.")));
    }
    if path.parent().is_none() {
        return Err(tr(
            format!("{shown} est la racine d'un disque : choisis un dossier dédié, par exemple …\\Mon Drive\\Todoom."),
            format!("{shown} is the root of a drive: pick a dedicated folder, for example …\\My Drive\\Todoom."),
        ));
    }
    let lower = |p: &Path| p.to_string_lossy().to_lowercase().trim_end_matches(['\\', '/']).to_string();
    let target = lower(path);
    if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))
        && target == lower(Path::new(&home))
    {
        return Err(tr(
            format!("{shown} est ton dossier personnel : choisis un sous-dossier dédié."),
            format!("{shown} is your home folder: pick a dedicated subfolder."),
        ));
    }
    let mut system: Vec<PathBuf> = ["SystemRoot", "windir", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "ProgramData"]
        .iter()
        .filter_map(|v| std::env::var_os(v).map(PathBuf::from))
        .collect();
    if cfg!(unix) {
        system.extend(["/System", "/Library", "/Applications", "/bin", "/sbin", "/usr", "/etc", "/var", "/private"].map(PathBuf::from));
    }
    for dir in system {
        let dir = lower(&dir);
        if target == dir || target.starts_with(&format!("{dir}\\")) || target.starts_with(&format!("{dir}/")) {
            return Err(tr(
                format!("{shown} est un dossier système : choisis un dossier à toi, par exemple dans ton Google Drive."),
                format!("{shown} is a system folder: pick a folder of your own, for example in your Google Drive."),
            ));
        }
    }
    Ok(())
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
            Err(e) => log::error!("surveillance impossible de {} : {e}", root.display()),
        },
        Err(e) => log::error!("initialisation de la surveillance impossible : {e}"),
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
        check_data_dir(Path::new(&path))?;
        fs::create_dir_all(&path).map_err(|e| tr(format!("Impossible de créer {path} : {e}"), format!("Cannot create {path}: {e}")))?;
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

type FileCache = Arc<Mutex<HashMap<PathBuf, CachedFile>>>;

/// A data file found in the folder, before it is read.
#[derive(Clone)]
struct Listed {
    path: PathBuf,
    rel: String,
    modified: SystemTime,
    len: u64,
}

/// What a load returns: the files read, and those not available yet.
#[derive(Serialize)]
struct Loaded {
    files: Vec<FileEntry>,
    /// Still being read (Google Drive downloading an "online only" file) or unreadable for now;
    /// the UI shows what it has and loads again a moment later.
    pending: Vec<String>,
}

/// A load answers with what it has after this long, instead of waiting for the slowest file.
const LOAD_DEADLINE: Duration = Duration::from_secs(15);
/// Files read at once: Google Drive downloads "online only" files one per read.
const READERS: usize = 8;

/// The JSON files under `dir`, from their metadata only: listing is fast even
/// when Google Drive hasn't downloaded the files yet.
fn list(root: &Path, dir: &Path, out: &mut Vec<Listed>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = entry.metadata() else { continue };
        if meta.is_dir() {
            list(root, &path, out);
            continue;
        }
        if !path.extension().is_some_and(|e| e == "json") {
            continue;
        }
        let Ok(rel) = path.strip_prefix(root) else { continue };
        let rel = rel.to_string_lossy().replace('\\', "/");
        let modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        out.push(Listed { path, rel, modified, len: meta.len() });
    }
}

fn is_fresh(l: &Listed, cache: &HashMap<PathBuf, CachedFile>) -> bool {
    cache.get(&l.path).is_some_and(|c| c.modified == l.modified && c.len == l.len)
}

/// Lists the data files and reads those that changed since the last load (the
/// rest comes from the cache: on Google Drive a listing costs ~30 ms while
/// reading every file costs seconds). Reads run in parallel on background
/// threads; after `deadline` the load answers with what it has, and the files
/// still being read are listed as pending. Those threads go on and fill the
/// cache, so the next load finds them ready.
fn load_files(
    root: &Path,
    cache: &FileCache,
    reading: &Arc<Mutex<HashSet<PathBuf>>>,
    deadline: Duration,
    read: fn(&Path) -> std::io::Result<String>,
) -> Loaded {
    let started = Instant::now();
    let mut listed = Vec::new();
    list(root, root, &mut listed);
    {
        let seen: HashSet<&PathBuf> = listed.iter().map(|l| &l.path).collect();
        cache.lock().unwrap().retain(|p, _| seen.contains(p));
    }
    let todo: Vec<Listed> = {
        let cached = cache.lock().unwrap();
        listed.iter().filter(|l| !is_fresh(l, &cached)).cloned().collect()
    };
    // Files an earlier load is still reading aren't read twice: their reader will fill the cache.
    let queue: Vec<Listed> = {
        let mut busy = reading.lock().unwrap();
        todo.iter().filter(|l| busy.insert(l.path.clone())).cloned().collect()
    };
    let workers = READERS.min(queue.len());
    let queue = Arc::new(Mutex::new(queue));
    for _ in 0..workers {
        let (queue, cache, reading) = (queue.clone(), cache.clone(), reading.clone());
        thread::spawn(move || loop {
            let Some(l) = queue.lock().unwrap().pop() else { break };
            match read(&l.path) {
                Ok(content) => {
                    cache.lock().unwrap().insert(l.path.clone(), CachedFile { modified: l.modified, len: l.len, content });
                }
                Err(e) => log::warn!("lecture impossible de {} : {e}", l.rel),
            }
            reading.lock().unwrap().remove(&l.path);
        });
    }
    // Waits for the files to read, until the deadline, or until no reader works on them any more.
    while !todo.is_empty() {
        let missing = {
            let cached = cache.lock().unwrap();
            todo.iter().filter(|l| !is_fresh(l, &cached)).count()
        };
        let busy = {
            let reading = reading.lock().unwrap();
            todo.iter().any(|l| reading.contains(&l.path))
        };
        if missing == 0 || !busy || started.elapsed() >= deadline {
            break;
        }
        thread::sleep(Duration::from_millis(40));
    }

    let cached = cache.lock().unwrap();
    let (mut files, mut pending) = (Vec::new(), Vec::new());
    for l in &listed {
        match cached.get(&l.path) {
            Some(c) if is_fresh(l, &cached) => files.push(FileEntry { path: l.rel.clone(), content: c.content.clone() }),
            _ => pending.push(l.rel.clone()),
        }
    }
    let ms = started.elapsed().as_millis();
    if todo.is_empty() {
        log::debug!("chargement : {} fichiers, tous depuis le cache, en {ms} ms", files.len());
    } else {
        log::info!(
            "chargement : {} fichiers en {ms} ms ({} lus, {} depuis le cache, {} en attente)",
            listed.len(),
            todo.len() - pending.len(),
            listed.len() - todo.len(),
            pending.len()
        );
        if !pending.is_empty() {
            let mut by_board: HashMap<&str, usize> = HashMap::new();
            for rel in &pending {
                *by_board.entry(rel.split('/').take(2).last().unwrap_or(rel)).or_default() += 1;
            }
            for (board, n) in by_board {
                log::info!("  en attente : {n} fichier(s) dans {board} (Google Drive les télécharge peut-être)");
            }
        }
    }
    Loaded { files, pending }
}

fn read_file(path: &Path) -> std::io::Result<String> {
    fs::read_to_string(path)
}

#[tauri::command]
async fn load_all(app: AppHandle) -> Result<Loaded, String> {
    blocking(app, |app| {
        let state = app.state::<AppState>();
        let root = data_root(&state)?;
        Ok(load_files(&root, &state.files, &state.reading, LOAD_DEADLINE, read_file))
    })
    .await
}

/// Never overwrites an existing file that isn't valid JSON: the UI lists such files
/// for the user to repair, and writing over one would destroy what is left of it.
fn refuse_unreadable(target: &Path, rel: &str) -> Result<(), String> {
    match fs::read_to_string(target) {
        Ok(existing) if serde_json::from_str::<serde_json::Value>(&existing).is_err() => Err(tr(
            format!("{rel} est illisible (JSON invalide) : il n'est pas écrasé. Répare-le ou supprime-le à la main."),
            format!("{rel} is unreadable (invalid JSON): it is not overwritten. Fix or delete it by hand."),
        )),
        _ => Ok(()),
    }
}

/// Checks a path the UI wants to write and returns where it lives, its folder created.
fn prepare_write(root: &Path, rel: &str) -> Result<PathBuf, String> {
    if !allowed(rel, Access::Write) {
        return Err(tr(
            format!("Écriture refusée : {rel} n'est pas un fichier de données Todoom."),
            format!("Write refused: {rel} is not a Todoom data file."),
        ));
    }
    let target = resolve(root, rel)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    refuse_unreadable(&target, rel)?;
    Ok(target)
}

/// Writes through a temp file + rename so a half-written file never gets synced.
fn write_atomic(target: &Path, content: &str) -> Result<(), String> {
    let tmp = target.with_extension("json.tmp");
    fs::write(&tmp, content).map_err(|e| e.to_string())?;
    if fs::rename(&tmp, target).is_err() {
        // Some virtual drives refuse renames over existing files.
        let _ = fs::remove_file(&tmp);
        fs::write(target, content).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn prepare_remove(root: &Path, rel: &str) -> Result<PathBuf, String> {
    if !allowed(rel, Access::Remove) {
        return Err(tr(
            format!("Suppression refusée : {rel} n'est pas une carte ni un tableau Todoom."),
            format!("Removal refused: {rel} is not a Todoom card or board."),
        ));
    }
    resolve(root, rel)
}

fn remove_target(target: &Path) -> Result<(), String> {
    if target.is_dir() {
        fs::remove_dir_all(target).map_err(|e| e.to_string())
    } else if target.exists() {
        fs::remove_file(target).map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}

/// Errors also go to the log file: the UI shows them, but only until it closes.
fn logged<T>(what: String, result: Result<T, String>) -> Result<T, String> {
    if let Err(e) = &result {
        log::warn!("{what} : {e}");
    }
    result
}

#[tauri::command]
async fn write_file(app: AppHandle, path: String, content: String) -> Result<(), String> {
    let what = format!("écriture de {path}");
    let result = blocking(app, move |app| {
        let state = app.state::<AppState>();
        let root = data_root(&state)?;
        let target = prepare_write(&root, &path)?;
        remember(&state, &root, &target, false);
        write_atomic(&target, &content)
    })
    .await;
    logged(what, result)
}

#[tauri::command]
async fn remove_path(app: AppHandle, path: String) -> Result<(), String> {
    let what = format!("suppression de {path}");
    let result = blocking(app, move |app| {
        let state = app.state::<AppState>();
        let root = data_root(&state)?;
        let target = prepare_remove(&root, &path)?;
        remember(&state, &root, &target, true);
        remove_target(&target)
    })
    .await;
    logged(what, result)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Journal in the app's log folder (%LOCALAPPDATA%\fr.devsecopsforce.todoom\logs on
        // Windows, ~/Library/Logs/fr.devsecopsforce.todoom on macOS), one old file kept.
        .plugin(
            tauri_plugin_log::Builder::new()
                .clear_targets()
                .target(tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                    file_name: Some("todoom".into()),
                }))
                .target(tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stderr))
                .level(log::LevelFilter::Info)
                .max_file_size(1_000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .setup(|app| {
            let handle = app.handle().clone();
            let state = app.state::<AppState>();
            *state.config.lock().unwrap() = load_config(&handle);
            log::info!("Todoom {} démarré", app.package_info().version);
            start_watcher(&handle, &state);
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

    fn load(root: &Path, cache: &FileCache) -> Vec<(String, String)> {
        let loaded = load_files(root, cache, &Default::default(), Duration::from_secs(10), read_file);
        assert!(loaded.pending.is_empty(), "{:?}", loaded.pending);
        let mut files: Vec<_> = loaded.files.into_iter().map(|f| (f.path, f.content)).collect();
        files.sort();
        files
    }

    fn slow_read(path: &Path) -> std::io::Result<String> {
        if path.file_name().is_some_and(|n| n.to_string_lossy().starts_with("slow")) {
            thread::sleep(Duration::from_millis(600));
        }
        read_file(path)
    }

    #[test]
    fn slow_files_are_pending_then_ready_without_blocking_the_rest() {
        let root = std::env::temp_dir().join(format!("todoom-slow-{}", std::process::id()));
        let cards = root.join("boards/b1/cards");
        fs::create_dir_all(&cards).unwrap();
        fs::write(root.join("boards/b1/board.json"), "board").unwrap();
        for i in 0..20 {
            fs::write(cards.join(format!("c{i}.json")), "card").unwrap();
        }
        fs::write(cards.join("slow1.json"), "s1").unwrap();
        fs::write(cards.join("slow2.json"), "s2").unwrap();
        let (cache, reading): (FileCache, Arc<Mutex<HashSet<PathBuf>>>) = Default::default();

        // The slow files take 600 ms each; the load answers after 150 ms with everything else.
        let started = Instant::now();
        let first = load_files(&root, &cache, &reading, Duration::from_millis(150), slow_read);
        assert!(started.elapsed() < Duration::from_millis(500), "the load waited for the slow files");
        assert_eq!(first.files.len(), 21);
        let mut pending = first.pending.clone();
        pending.sort();
        assert_eq!(pending, ["boards/b1/cards/slow1.json", "boards/b1/cards/slow2.json"]);

        // Read in parallel in the background: both are ready well before 2 × 600 ms.
        thread::sleep(Duration::from_millis(800));
        let second = load_files(&root, &cache, &reading, Duration::from_millis(150), slow_read);
        assert!(second.pending.is_empty(), "{:?}", second.pending);
        assert_eq!(second.files.len(), 23);
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn an_unreadable_file_is_pending_and_the_load_does_not_wait_for_it() {
        fn failing_read(path: &Path) -> std::io::Result<String> {
            if path.file_name().is_some_and(|n| n.to_string_lossy().starts_with("broken")) {
                return Err(std::io::Error::other("Drive a refusé"));
            }
            read_file(path)
        }
        let root = std::env::temp_dir().join(format!("todoom-broken-{}", std::process::id()));
        fs::create_dir_all(root.join("boards/b1/cards")).unwrap();
        fs::write(root.join("boards/b1/board.json"), "board").unwrap();
        fs::write(root.join("boards/b1/cards/broken.json"), "x").unwrap();
        let started = Instant::now();
        let loaded = load_files(&root, &Default::default(), &Default::default(), Duration::from_secs(10), failing_read);
        assert!(started.elapsed() < Duration::from_secs(2));
        assert_eq!(loaded.pending, ["boards/b1/cards/broken.json"]);
        assert_eq!(loaded.files.len(), 1);
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn only_todoom_data_files_can_be_written_or_removed() {
        for ok in [
            "settings.json",
            ".presence/PC-Main.json",
            "boards/mw0abc/board.json",
            "boards/mw0abc/cards/mw0xyz.json",
            "boards/mw0abc/comments/mw0xyz/mw1c.json",
            "boards/mw0abc/history/mw0xyz/PC-Main-cli.json",
        ] {
            assert!(allowed(ok, Access::Write), "{ok}");
        }
        for ok in [
            "boards/mw0abc",
            "boards/mw0abc/cards/mw0xyz.json",
            "boards/mw0abc/comments/mw0xyz/mw1c.json",
            "boards/mw0abc/comments/mw0xyz",
            "boards/mw0abc/history/mw0xyz",
        ] {
            assert!(allowed(ok, Access::Remove), "{ok}");
        }
        let traps = [
            "",
            "boards",
            "../outside.json",
            "boards/../../Windows/win.ini",
            "boards/b1/../../x.json",
            "C:/Windows/System32/drivers/etc/hosts",
            "/etc/passwd",
            "boards/b1/cards/c1.exe",
            "boards/b1/cards/c1.json/../../evil.json",
            "boards/b 1/board.json",
            "boards/b1/cards/sub/c1.json",
            ".presence/../settings.json",
            "settings.json.bak",
            "boards\\b1\\board.json",
            "boards/b1/comments/c1/../../board.json",
            "boards/b1/comments/c1/x/y.json",
            "boards/b1/history/c1/h.txt",
            "boards/b1/notes/c1/n.json",
        ];
        for trap in traps {
            assert!(!allowed(trap, Access::Write), "écriture acceptée : {trap}");
            assert!(!allowed(trap, Access::Remove), "suppression acceptée : {trap}");
        }
        // Whole folders other than one board, and settings/presence, can't be removed.
        for no in [
            "settings.json",
            ".presence/PC.json",
            "boards/b1/board.json",
            "boards/b1/cards",
            ".presence",
            "boards/b1/comments",
            "boards/b1/history/c1/PC.json",
        ] {
            assert!(!allowed(no, Access::Remove), "{no}");
        }
    }

    #[test]
    fn resolve_never_leaves_the_data_folder() {
        let root = Path::new("/data");
        assert!(resolve(root, "boards/b1/board.json").is_ok());
        for trap in ["", "..", "../x.json", "boards/../../x", "/etc/passwd"] {
            assert!(resolve(root, trap).is_err(), "{trap}");
        }
        // Only an absolute path on Windows; elsewhere `allowed` rejects the backslashes.
        if cfg!(windows) {
            assert!(resolve(root, "C:\\Windows\\win.ini").is_err());
        }
    }

    #[test]
    fn data_folder_cannot_be_a_drive_root_home_or_system_folder() {
        assert!(check_data_dir(Path::new("relative/folder")).is_err());
        if cfg!(windows) {
            assert!(check_data_dir(Path::new("C:\\")).is_err());
            assert!(check_data_dir(Path::new("G:\\")).is_err());
            let windir = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
            assert!(check_data_dir(Path::new(&windir)).is_err());
            assert!(check_data_dir(&Path::new(&windir).join("System32")).is_err());
            assert!(check_data_dir(Path::new(&std::env::var("ProgramFiles").unwrap())).is_err());
            assert!(check_data_dir(Path::new(&std::env::var("USERPROFILE").unwrap())).is_err());
            assert!(check_data_dir(Path::new("G:\\Mon Drive\\Todoom")).is_ok());
            assert!(check_data_dir(&Path::new(&std::env::var("USERPROFILE").unwrap()).join("Todoom")).is_ok());
        } else {
            assert!(check_data_dir(Path::new("/")).is_err());
            assert!(check_data_dir(Path::new("/etc/todoom")).is_err());
            assert!(check_data_dir(Path::new(&std::env::var("HOME").unwrap())).is_err());
            assert!(check_data_dir(&Path::new(&std::env::var("HOME").unwrap()).join("Todoom")).is_ok());
        }
    }

    #[test]
    fn writes_and_removes_cards_and_boards_in_the_data_folder() {
        let root = std::env::temp_dir().join(format!("todoom-io-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let write = |rel: &str, content: &str| prepare_write(&root, rel).and_then(|t| write_atomic(&t, content));
        let remove = |rel: &str| prepare_remove(&root, rel).and_then(|t| remove_target(&t));

        // Creates the folders, then overwrites in place, leaving no temp file behind.
        write("boards/b1/cards/c1.json", r#"{"id":"c1","title":"v1"}"#).unwrap();
        write("boards/b1/cards/c1.json", r#"{"id":"c1","title":"v2"}"#).unwrap();
        write("boards/b1/board.json", r#"{"id":"b1"}"#).unwrap();
        let card = root.join("boards/b1/cards/c1.json");
        assert_eq!(fs::read_to_string(&card).unwrap(), r#"{"id":"c1","title":"v2"}"#);
        assert!(!root.join("boards/b1/cards/c1.json.tmp").exists());

        // Refused before touching the disk.
        assert!(write("../outside.json", "{}").is_err());
        assert!(!root.parent().unwrap().join("outside.json").exists());
        fs::write(root.join("boards/b1/cards/broken.json"), "{coupé").unwrap();
        assert!(write("boards/b1/cards/broken.json", "{}").is_err());
        assert_eq!(fs::read_to_string(root.join("boards/b1/cards/broken.json")).unwrap(), "{coupé");
        assert!(remove("boards").is_err());
        assert!(remove("boards/b1/board.json").is_err());

        // A card, then a whole board; removing something already gone is fine.
        remove("boards/b1/cards/c1.json").unwrap();
        assert!(!card.exists());
        remove("boards/b1/cards/c1.json").unwrap();
        remove("boards/b1").unwrap();
        assert!(!root.join("boards/b1").exists());

        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn unreadable_files_are_not_overwritten() {
        let dir = std::env::temp_dir().join(format!("todoom-refuse-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let (broken, valid, missing) = (dir.join("broken.json"), dir.join("valid.json"), dir.join("missing.json"));
        fs::write(&broken, r#"{"id":"c1","title":"coupé par Dri"#).unwrap();
        fs::write(&valid, r#"{"id":"c2"}"#).unwrap();

        assert!(refuse_unreadable(&broken, "broken.json").unwrap_err().contains("illisible"));
        assert!(refuse_unreadable(&valid, "valid.json").is_ok());
        assert!(refuse_unreadable(&missing, "missing.json").is_ok());

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn walk_cache_follows_changes() {
        let root = std::env::temp_dir().join(format!("todoom-walk-{}", std::process::id()));
        let cards = root.join("boards/b1/cards");
        fs::create_dir_all(&cards).unwrap();
        fs::write(root.join("boards/b1/board.json"), "board").unwrap();
        fs::write(cards.join("c1.json"), "v1").unwrap();
        fs::write(cards.join("skip.json.tmp"), "tmp").unwrap();
        let cache: FileCache = Default::default();

        assert_eq!(
            load(&root, &cache),
            [("boards/b1/board.json".into(), "board".into()), ("boards/b1/cards/c1.json".into(), "v1".into())]
        );

        fs::write(cards.join("c1.json"), "version 2").unwrap();
        fs::write(cards.join("c2.json"), "new").unwrap();
        fs::remove_file(root.join("boards/b1/board.json")).unwrap();
        assert_eq!(
            load(&root, &cache),
            [("boards/b1/cards/c1.json".into(), "version 2".into()), ("boards/b1/cards/c2.json".into(), "new".into())]
        );
        assert_eq!(cache.lock().unwrap().len(), 2);

        fs::remove_dir_all(&root).unwrap();
    }
}
