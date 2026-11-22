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

const CHANGED_EVENT: &str = "todoom://changed";

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
        .ok_or_else(|| {
            tr(
                "Aucun dossier de données configuré".into(),
                "No data folder configured".into(),
            )
        })
}

/// Joins a relative path to the data root, refusing anything that could escape it.
fn resolve(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    if rel.is_empty()
        || rel_path
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(tr(
            format!("Chemin invalide : {rel}"),
            format!("Invalid path: {rel}"),
        ));
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
fn is_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Name of an attached file, as the UI makes it: `<id>-<cleaned name>`. Never a
/// JSON file (those are loaded as data), never hidden, no path in it.
fn is_attachment_name(s: &str) -> bool {
    s.len() <= 160
        && s.split_once('-')
            .is_some_and(|(id, rest)| is_id(id) && !rest.is_empty())
        && !s.starts_with('.')
        && !s.contains("..")
        && !s.to_ascii_lowercase().ends_with(".json")
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// An attached file: boards/<board>/attachments/<card>/<id>-<name>.
fn is_attachment(rel: &str) -> bool {
    matches!(rel.split('/').collect::<Vec<_>>().as_slice(),
        ["boards", board, "attachments", card, file] if is_id(board) && is_id(card) && is_attachment_name(file))
}

/// Largest attached file: Google Drive copies every one of them to every computer.
const MAX_ATTACHMENT_BYTES: usize = 10 * 1024 * 1024;

fn allowed(rel: &str, access: Access) -> bool {
    let id = is_id;
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
        (Access::Write, ["boards", board, "history", card, file]) => {
            id(board) && id(card) && json_id(file)
        }
        // An attachment's description; the attached file itself goes through write_attachment.
        (Access::Write, ["boards", board, "attachments", card, file]) => {
            id(board) && id(card) && json_id(file)
        }
        (Access::Remove, ["boards", board, "attachments", card, file]) => {
            id(board) && id(card) && (json_id(file) || is_attachment_name(file))
        }
        // A card deleted for good takes its comments, history and attachments with it.
        (
            Access::Remove,
            [
                "boards",
                board,
                "comments" | "history" | "attachments",
                card,
            ],
        ) => id(board) && id(card),
        (Access::Remove, ["boards", board]) => id(board),
        _ => false,
    }
}

/// Folders that must never become the data folder: a whole drive, the home folder
/// itself or a system folder would be scanned on every reload and written into.
fn check_data_dir(path: &Path) -> Result<(), String> {
    let shown = path.display();
    if !path.is_absolute() {
        return Err(tr(
            format!("{shown} n'est pas un chemin complet."),
            format!("{shown} is not a full path."),
        ));
    }
    if path.parent().is_none() {
        return Err(tr(
            format!(
                "{shown} est la racine d'un disque : choisis un dossier dédié, par exemple …\\Mon Drive\\Todoom."
            ),
            format!(
                "{shown} is the root of a drive: pick a dedicated folder, for example …\\My Drive\\Todoom."
            ),
        ));
    }
    let lower = |p: &Path| {
        p.to_string_lossy()
            .to_lowercase()
            .trim_end_matches(['\\', '/'])
            .to_string()
    };
    let target = lower(path);
    if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))
        && target == lower(Path::new(&home))
    {
        return Err(tr(
            format!("{shown} est ton dossier personnel : choisis un sous-dossier dédié."),
            format!("{shown} is your home folder: pick a dedicated subfolder."),
        ));
    }
    let mut system: Vec<PathBuf> = [
        "SystemRoot",
        "windir",
        "ProgramFiles",
        "ProgramFiles(x86)",
        "ProgramW6432",
        "ProgramData",
    ]
    .iter()
    .filter_map(|v| std::env::var_os(v).map(PathBuf::from))
    .collect();
    if cfg!(unix) {
        system.extend(
            [
                "/System",
                "/Library",
                "/Applications",
                "/bin",
                "/sbin",
                "/usr",
                "/etc",
                "/var",
                "/private",
            ]
            .map(PathBuf::from),
        );
    }
    for dir in system {
        let dir = lower(&dir);
        if target == dir
            || target.starts_with(&format!("{dir}\\"))
            || target.starts_with(&format!("{dir}/"))
        {
            return Err(tr(
                format!(
                    "{shown} est un dossier système : choisis un dossier à toi, par exemple dans ton Google Drive."
                ),
                format!(
                    "{shown} is a system folder: pick a folder of your own, for example in your Google Drive."
                ),
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
    // The phone summaries are written from the data, never read back: not a change to reload for.
    let reading = root.join(READING_DIR);

    let debouncer = new_debouncer(
        Duration::from_millis(500),
        move |res: DebounceEventResult| {
            let Ok(events) = res else { return };
            let mut recent = recent.lock().unwrap();
            recent.retain(|_, (t, _)| t.elapsed() < SELF_WRITE_GRACE);
            let ours = |p: &Path| {
                recent
                    .iter()
                    .any(|(k, (_, prefix))| p == k || (*prefix && p.starts_with(k)))
            };
            let external = events.iter().any(|e| {
                !is_temp(&e.path)
                    && !e.path.starts_with(&presence)
                    && !e.path.starts_with(&reading)
                    && !ours(&e.path)
            });
            if external {
                let _ = handle.emit(CHANGED_EVENT, ());
            }
        },
    );

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
        fs::create_dir_all(&path).map_err(|e| {
            tr(
                format!("Impossible de créer {path} : {e}"),
                format!("Cannot create {path}: {e}"),
            )
        })?;
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
    if let Some(home) = std::env::var_os("HOME")
        && let Ok(entries) = fs::read_dir(PathBuf::from(home).join("Library/CloudStorage"))
    {
        for entry in entries.flatten() {
            if entry
                .file_name()
                .to_string_lossy()
                .starts_with("GoogleDrive")
            {
                for name in names {
                    candidates.push(entry.path().join(name));
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
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
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
        let Ok(rel) = path.strip_prefix(root) else {
            continue;
        };
        let rel = rel.to_string_lossy().replace('\\', "/");
        let modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        out.push(Listed {
            path,
            rel,
            modified,
            len: meta.len(),
        });
    }
}

fn is_fresh(l: &Listed, cache: &HashMap<PathBuf, CachedFile>) -> bool {
    cache
        .get(&l.path)
        .is_some_and(|c| c.modified == l.modified && c.len == l.len)
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
        listed
            .iter()
            .filter(|l| !is_fresh(l, &cached))
            .cloned()
            .collect()
    };
    // Files an earlier load is still reading aren't read twice: their reader will fill the cache.
    let queue: Vec<Listed> = {
        let mut busy = reading.lock().unwrap();
        todo.iter()
            .filter(|l| busy.insert(l.path.clone()))
            .cloned()
            .collect()
    };
    let workers = READERS.min(queue.len());
    let queue = Arc::new(Mutex::new(queue));
    for _ in 0..workers {
        let (queue, cache, reading) = (queue.clone(), cache.clone(), reading.clone());
        thread::spawn(move || {
            loop {
                let Some(l) = queue.lock().unwrap().pop() else {
                    break;
                };
                match read(&l.path) {
                    Ok(content) => {
                        cache.lock().unwrap().insert(
                            l.path.clone(),
                            CachedFile {
                                modified: l.modified,
                                len: l.len,
                                content,
                            },
                        );
                    }
                    Err(e) => log::warn!("lecture impossible de {} : {e}", l.rel),
                }
                reading.lock().unwrap().remove(&l.path);
            }
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
            Some(c) if is_fresh(l, &cached) => files.push(FileEntry {
                path: l.rel.clone(),
                content: c.content.clone(),
            }),
            _ => pending.push(l.rel.clone()),
        }
    }
    let ms = started.elapsed().as_millis();
    if todo.is_empty() {
        log::debug!(
            "chargement : {} fichiers, tous depuis le cache, en {ms} ms",
            files.len()
        );
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
                *by_board
                    .entry(rel.split('/').take(2).last().unwrap_or(rel))
                    .or_default() += 1;
            }
            for (board, n) in by_board {
                log::info!(
                    "  en attente : {n} fichier(s) dans {board} (Google Drive les télécharge peut-être)"
                );
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
        Ok(load_files(
            &root,
            &state.files,
            &state.reading,
            LOAD_DEADLINE,
            read_file,
        ))
    })
    .await
}

/// Never overwrites an existing file that isn't valid JSON: the UI lists such files
/// for the user to repair, and writing over one would destroy what is left of it.
fn refuse_unreadable(target: &Path, rel: &str) -> Result<(), String> {
    match fs::read_to_string(target) {
        Ok(existing) if serde_json::from_str::<serde_json::Value>(&existing).is_err() => Err(tr(
            format!(
                "{rel} est illisible (JSON invalide) : il n'est pas écrasé. Répare-le ou supprime-le à la main."
            ),
            format!(
                "{rel} is unreadable (invalid JSON): it is not overwritten. Fix or delete it by hand."
            ),
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

fn refuse_attachment(rel: &str) -> Result<(), String> {
    if is_attachment(rel) {
        Ok(())
    } else {
        Err(tr(
            format!("Pièce jointe refusée : {rel}"),
            format!("Attachment refused: {rel}"),
        ))
    }
}

/// Writes an attached file once: an existing one is never overwritten.
fn store_attachment(root: &Path, rel: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    refuse_attachment(rel)?;
    if bytes.len() > MAX_ATTACHMENT_BYTES {
        return Err(tr(
            format!(
                "Fichier trop gros ({} Mo, 10 Mo au plus)",
                bytes.len() / (1024 * 1024)
            ),
            format!(
                "File too big ({} MB, 10 MB at most)",
                bytes.len() / (1024 * 1024)
            ),
        ));
    }
    let target = resolve(root, rel)?;
    if target.exists() {
        return Err(tr(
            format!("{rel} existe déjà"),
            format!("{rel} already exists"),
        ));
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = target.with_extension("part");
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &target).map_err(|e| e.to_string())?;
    Ok(target)
}

fn load_attachment(root: &Path, rel: &str) -> Result<Vec<u8>, String> {
    refuse_attachment(rel)?;
    let target = resolve(root, rel)?;
    let len = fs::metadata(&target).map_err(|e| e.to_string())?.len();
    if len as usize > MAX_ATTACHMENT_BYTES {
        return Err(tr(
            format!("{rel} est trop gros pour être affiché"),
            format!("{rel} is too big to show"),
        ));
    }
    fs::read(&target).map_err(|e| e.to_string())
}

#[tauri::command]
async fn write_attachment(app: AppHandle, path: String, data: String) -> Result<(), String> {
    use base64::Engine;
    let what = format!("pièce jointe {path}");
    let result = blocking(app, move |app| {
        let state = app.state::<AppState>();
        let root = data_root(&state)?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(data.as_bytes())
            .map_err(|e| e.to_string())?;
        let target = store_attachment(&root, &path, &bytes)?;
        remember(&state, &root, &target, false);
        Ok(())
    })
    .await;
    logged(what, result)
}

#[tauri::command]
async fn read_attachment(app: AppHandle, path: String) -> Result<String, String> {
    use base64::Engine;
    blocking(app, move |app| {
        let root = data_root(&app.state::<AppState>())?;
        Ok(base64::engine::general_purpose::STANDARD.encode(load_attachment(&root, &path)?))
    })
    .await
}

/// Shows the attached file in the system's file manager. Attachments are never
/// opened from Todoom: one could be a program.
#[tauri::command]
async fn reveal_attachment(app: AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    blocking(app, move |app| {
        refuse_attachment(&path)?;
        let target = resolve(&data_root(&app.state::<AppState>())?, &path)?;
        app.opener()
            .reveal_item_in_dir(target)
            .map_err(|e| e.to_string())
    })
    .await
}

// ---- Snapshots -------------------------------------------------------------
// A dated copy of the data files, kept on this computer, outside the synced
// folder: a sync incident or a script that damages files can't take them too.
// One JSON file per snapshot: { version, createdAt, host, files: { path: content } }.
// Attached files themselves aren't in it (only their descriptions): too big.

fn snapshots_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("snapshots");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// A snapshot's name, as the UI makes it (2026-11-22, 2026-11-22_09-30-00_manual): no path in it.
fn is_snapshot_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 80
        && !name.starts_with('.')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn snapshot_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    if !is_snapshot_name(name) {
        return Err(tr(
            format!("Nom d'instantané invalide : {name}"),
            format!("Invalid snapshot name: {name}"),
        ));
    }
    Ok(snapshots_dir(app)?.join(format!("{name}.json")))
}

#[derive(Serialize)]
struct SnapshotInfo {
    name: String,
    size: u64,
}

#[tauri::command]
async fn list_snapshots(app: AppHandle) -> Result<Vec<SnapshotInfo>, String> {
    blocking(app, |app| {
        let mut out = Vec::new();
        for entry in fs::read_dir(snapshots_dir(app)?)
            .map_err(|e| e.to_string())?
            .flatten()
        {
            let path = entry.path();
            let Some(name) = path
                .file_name()
                .and_then(|n| n.to_str())
                .and_then(|n| n.strip_suffix(".json"))
            else {
                continue;
            };
            if !is_snapshot_name(name) {
                continue;
            }
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            out.push(SnapshotInfo {
                name: name.to_string(),
                size,
            });
        }
        out.sort_by(|a, b| b.name.cmp(&a.name));
        Ok(out)
    })
    .await
}

#[tauri::command]
async fn save_snapshot(app: AppHandle, name: String, content: String) -> Result<(), String> {
    blocking(app, move |app| {
        serde_json::from_str::<serde_json::Value>(&content).map_err(|e| e.to_string())?;
        write_atomic(&snapshot_path(app, &name)?, &content)
    })
    .await
}

#[tauri::command]
async fn delete_snapshot(app: AppHandle, name: String) -> Result<(), String> {
    blocking(app, move |app| remove_target(&snapshot_path(app, &name)?)).await
}

#[derive(Deserialize)]
struct SnapshotFile {
    files: HashMap<String, String>,
}

#[derive(Serialize, Debug, PartialEq)]
struct Restored {
    written: usize,
    removed: usize,
}

/// Puts the data files back as in the snapshot: each one written (even over a
/// file that became unreadable), and the data files made since removed. Only
/// paths the UI may write are touched; the presence files are left alone.
fn restore_into(root: &Path, snapshot: &SnapshotFile) -> Result<Restored, String> {
    for (rel, content) in &snapshot.files {
        if !allowed(rel, Access::Write) || rel.starts_with(".presence/") {
            return Err(tr(
                format!("Instantané refusé : {rel} n'est pas un fichier de données Todoom."),
                format!("Snapshot refused: {rel} is not a Todoom data file."),
            ));
        }
        serde_json::from_str::<serde_json::Value>(content).map_err(|_| {
            tr(
                format!("Instantané abîmé : {rel}"),
                format!("Damaged snapshot: {rel}"),
            )
        })?;
    }
    let mut listed = Vec::new();
    list(root, root, &mut listed);
    let mut removed = 0;
    for l in &listed {
        if l.rel.starts_with(".presence/")
            || !allowed(&l.rel, Access::Write)
            || snapshot.files.contains_key(&l.rel)
        {
            continue;
        }
        fs::remove_file(&l.path).map_err(|e| e.to_string())?;
        removed += 1;
    }
    for (rel, content) in &snapshot.files {
        let target = resolve(root, rel)?;
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        write_atomic(&target, content)?;
    }
    Ok(Restored {
        written: snapshot.files.len(),
        removed,
    })
}

#[tauri::command]
async fn restore_snapshot(app: AppHandle, name: String) -> Result<Restored, String> {
    let what = format!("restauration de l'instantané {name}");
    let result = blocking(app, move |app| {
        let raw = fs::read_to_string(snapshot_path(app, &name)?).map_err(|e| e.to_string())?;
        let snapshot: SnapshotFile = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        let state = app.state::<AppState>();
        let root = data_root(&state)?;
        // Our own writes: the watcher shouldn't take them for another computer's.
        remember(&state, &root, &root, true);
        let restored = restore_into(&root, &snapshot)?;
        state.files.lock().unwrap().clear();
        log::info!(
            "instantané {name} restauré : {} fichiers écrits, {} supprimés",
            restored.written,
            restored.removed
        );
        Ok(restored)
    })
    .await;
    logged(what, result)
}

/// Exports go where the user chose in the save dialog; only text reports
/// (Markdown, CSV), never a program or a data file of the folder.
fn export_target(path: &str) -> Result<PathBuf, String> {
    let target = PathBuf::from(path);
    let ext = target
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase());
    if !target.is_absolute() || !matches!(ext.as_deref(), Some("md" | "csv" | "txt")) {
        return Err(tr(
            format!("Export refusé : {path}"),
            format!("Export refused: {path}"),
        ));
    }
    Ok(target)
}

#[tauri::command]
async fn save_export(app: AppHandle, path: String, content: String) -> Result<(), String> {
    blocking(app, move |_| {
        fs::write(export_target(&path)?, content).map_err(|e| e.to_string())
    })
    .await
}

// ---- Quick capture ---------------------------------------------------------
// A small window to note an idea from anywhere: a global shortcut, or the
// Todoom icon in the notification area. It only sends the title to the main
// window, which makes the card like any other (number, history, undo).

/// Ctrl + Alt + N, Cmd + Option + N on a Mac.
const CAPTURE_SHORTCUT: &str = "CommandOrControl+Alt+N";

fn open_capture(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("capture") {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    let built = tauri::WebviewWindowBuilder::new(app, "capture", tauri::WebviewUrl::default())
        .title(tr(
            "Todoom · capture rapide".into(),
            "Todoom · quick capture".into(),
        ))
        .inner_size(480.0, 190.0)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .center()
        .focused(true)
        .build();
    if let Err(e) = built {
        log::warn!("fenêtre de capture impossible : {e}");
    }
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// The icon in the notification area (menu bar on a Mac): capture, show, quit.
fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    let capture = MenuItem::with_id(
        app,
        "capture",
        tr("Capture rapide".into(), "Quick capture".into()),
        true,
        Some(CAPTURE_SHORTCUT),
    )?;
    let show = MenuItem::with_id(
        app,
        "show",
        tr("Afficher Todoom".into(), "Show Todoom".into()),
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(
        app,
        "quit",
        tr("Quitter".into(), "Quit".into()),
        true,
        None::<&str>,
    )?;
    let menu = Menu::with_items(app, &[&capture, &show, &quit])?;
    let mut tray = TrayIconBuilder::with_id("todoom")
        .tooltip("Todoom")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "capture" => open_capture(app),
            "show" => show_main(app),
            // Closing the main window goes through its guard (changes not written yet).
            "quit" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.close();
                }
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

// ---- Summaries for the phone ------------------------------------------------
// Plain text files in the data folder's « lecture » subfolder, readable in the
// Google Drive app. Only that folder, only .md files with a plain name.

const READING_DIR: &str = "lecture";

/// A summary's file name, as the UI makes it from a board's name: no path, no
/// hidden file, nothing Windows, macOS or Drive refuses.
fn is_reading_name(name: &str) -> bool {
    name.len() <= 160
        && name.ends_with(".md")
        && name.len() > 3
        && !name.starts_with('.')
        && !name.starts_with(' ')
        && !name.chars().any(|c| {
            c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
        })
}

fn reading_path(app: &AppHandle, name: &str) -> Result<(PathBuf, PathBuf), String> {
    if !is_reading_name(name) {
        return Err(tr(
            format!("Nom de résumé refusé : {name}"),
            format!("Summary name refused: {name}"),
        ));
    }
    let root = data_root(&app.state::<AppState>())?;
    let dir = root.join(READING_DIR);
    Ok((root, dir.join(name)))
}

#[tauri::command]
async fn list_reading(app: AppHandle) -> Result<Vec<String>, String> {
    blocking(app, |app| {
        let dir = data_root(&app.state::<AppState>())?.join(READING_DIR);
        let Ok(entries) = fs::read_dir(&dir) else {
            return Ok(Vec::new());
        };
        Ok(entries
            .flatten()
            .filter_map(|e| e.file_name().to_str().map(str::to_string))
            .filter(|n| is_reading_name(n))
            .collect())
    })
    .await
}

#[tauri::command]
async fn write_reading(app: AppHandle, name: String, content: String) -> Result<(), String> {
    blocking(app, move |app| {
        let (root, target) = reading_path(app, &name)?;
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        remember(&app.state::<AppState>(), &root, &target, false);
        fs::write(&target, content).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
async fn remove_reading(app: AppHandle, name: String) -> Result<(), String> {
    blocking(app, move |app| {
        let (root, target) = reading_path(app, &name)?;
        remember(&app.state::<AppState>(), &root, &target, false);
        remove_target(&target)
    })
    .await
}

// ---- Inbox --------------------------------------------------------------------
// Ideas dropped from the phone (« Share › Save to Drive ») into the data
// folder's « boîte de réception »: listed, read (small text only) and removed
// once their card is written. Nothing else of the folder is reachable this way.

const INBOX_DIR: &str = "boîte de réception";
const INBOX_MAX_BYTES: u64 = 64 * 1024;

/// A file name as the phone makes it (« singha - Brave Search »): any text,
/// but no path, no hidden file.
fn is_inbox_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 255
        && !name.starts_with('.')
        && !name
            .chars()
            .any(|c| c.is_control() || matches!(c, '/' | '\\' | ':'))
}

fn inbox_dir(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let root = data_root(&app.state::<AppState>())?;
    let dir = root.join(INBOX_DIR);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok((root, dir))
}

fn inbox_file(dir: &Path, name: &str) -> Result<PathBuf, String> {
    if !is_inbox_name(name) {
        return Err(tr(
            format!("Fichier refusé : {name}"),
            format!("File refused: {name}"),
        ));
    }
    Ok(dir.join(name))
}

#[derive(Serialize)]
struct InboxFile {
    name: String,
    size: u64,
}

/// The files waiting in the inbox (the folder is made if missing, so the phone can pick it).
fn list_inbox_in(dir: &Path) -> Vec<InboxFile> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            let name = e.file_name().to_str()?.to_string();
            (meta.is_file() && is_inbox_name(&name)).then_some(InboxFile {
                name,
                size: meta.len(),
            })
        })
        .collect()
}

/// A small file as text; anything that isn't UTF-8 comes back with replacement marks, for the UI to refuse.
fn read_inbox_in(dir: &Path, name: &str) -> Result<String, String> {
    let path = inbox_file(dir, name)?;
    let len = fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if len > INBOX_MAX_BYTES {
        return Err(tr(
            format!("{name} est trop gros"),
            format!("{name} is too big"),
        ));
    }
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[tauri::command]
async fn list_inbox(app: AppHandle) -> Result<Vec<InboxFile>, String> {
    blocking(app, |app| Ok(list_inbox_in(&inbox_dir(app)?.1))).await
}

#[tauri::command]
async fn read_inbox(app: AppHandle, name: String) -> Result<String, String> {
    blocking(app, move |app| read_inbox_in(&inbox_dir(app)?.1, &name)).await
}

#[tauri::command]
async fn remove_inbox(app: AppHandle, name: String) -> Result<(), String> {
    blocking(app, move |app| {
        let (root, dir) = inbox_dir(app)?;
        let path = inbox_file(&dir, &name)?;
        remember(&app.state::<AppState>(), &root, &path, false);
        if path.is_file() {
            fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        Ok(())
    })
    .await
}

// ---- Pull / merge requests ------------------------------------------------------
// The open pull requests (GitHub) or merge requests (GitLab) of a board's
// repository, read through the gh and glab tools already signed in on this
// computer: Todoom stores no token. The repository comes from the board's file,
// which anyone who can write the synced folder controls: host and path are
// checked, the arguments are fixed and no shell is involved.

const REVIEW_TIMEOUT: Duration = Duration::from_secs(25);

/// A host name: letters, digits, dots and dashes.
fn is_forge_host(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 253
        && !host.starts_with(['-', '.'])
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
}

/// owner/repo on GitHub, group/…/project on GitLab: plain names, never an option or "..".
fn is_forge_path(forge: &str, path: &str) -> bool {
    let parts: Vec<&str> = path.split('/').collect();
    let count_ok = match forge {
        "github" => parts.len() == 2,
        "gitlab" => (2..=20).contains(&parts.len()),
        _ => false,
    };
    count_ok
        && parts.iter().all(|p| {
            !p.is_empty()
                && p.len() <= 100
                && !p.starts_with(['-', '.'])
                && p.chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
        })
}

/// Open merge requests, or the latest merged ones (the interface keeps the last 24 hours).
fn gitlab_query(merged: bool) -> String {
    let (state, sort, limit) = if merged {
        ("merged", "MERGED_AT_DESC", 20)
    } else {
        ("opened", "UPDATED_DESC", 50)
    };
    format!(
        "query($path: ID!) {{ project(fullPath: $path) {{ mergeRequests(state: {state}, first: {limit}, sort: {sort}) {{ nodes {{ iid title webUrl draft sourceBranch updatedAt mergedAt author {{ username }} headPipeline {{ status }} }} }} }} }}"
    )
}

/// The command line for a forge, arguments as a list: the open pull/merge
/// requests, or with `merged` the latest merged ones.
fn review_args(
    forge: &str,
    host: &str,
    path: &str,
    merged: bool,
) -> Option<(&'static str, Vec<String>)> {
    if !is_forge_host(host) || !is_forge_path(forge, path) {
        return None;
    }
    let (state, limit) = if merged {
        ("merged", "20")
    } else {
        ("open", "50")
    };
    match forge {
        "github" => Some((
            "gh",
            [
                "pr",
                "list",
                "--repo",
                &format!("{host}/{path}"),
                "--state",
                state,
                "--limit",
                limit,
                "--json",
                "number,title,url,isDraft,headRefName,author,statusCheckRollup,updatedAt,mergedAt",
            ]
            .map(String::from)
            .to_vec(),
        )),
        "gitlab" => Some((
            "glab",
            [
                "api",
                "graphql",
                "--hostname",
                host,
                "-f",
                &format!("query={}", gitlab_query(merged)),
                "-f",
                &format!("path={path}"),
            ]
            .map(String::from)
            .to_vec(),
        )),
        _ => None,
    }
}

/// Where gh or glab is: on the PATH, else where their installers put them
/// (an app opened from the Dock or the Start menu doesn't get the shell's PATH).
fn find_tool(name: &str) -> Option<PathBuf> {
    let exe = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    if cfg!(windows) {
        for var in ["ProgramFiles", "LOCALAPPDATA"] {
            if let Some(base) = std::env::var_os(var).map(PathBuf::from) {
                dirs.push(base.join("GitHub CLI"));
                dirs.push(base.join("Programs").join(name));
                dirs.push(base.join("Programs").join("GitHub CLI"));
            }
        }
    } else {
        dirs.extend(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"].map(PathBuf::from));
        if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
            dirs.push(home.join(".local/bin"));
        }
    }
    dirs.into_iter().map(|d| d.join(&exe)).find(|p| p.is_file())
}

/// Runs the tool and returns its output, or an error code the interface explains:
/// "missing:<tool>", "auth:<tool>", "notfound", or "failed:<message>".
fn run_review_tool(tool: &str, args: &[String]) -> Result<String, String> {
    let program = find_tool(tool).ok_or_else(|| format!("missing:{tool}"))?;
    let mut cmd = std::process::Command::new(program);
    cmd.args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        // No colors, no prompts, no pager: plain JSON.
        .env("NO_COLOR", "1")
        .env("GH_PROMPT_DISABLED", "1")
        .env("GLAB_NO_PROMPT", "1")
        .env("GH_PAGER", "")
        .env("PAGER", "");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console flashing
    }
    let mut child = cmd.spawn().map_err(|e| format!("failed:{e}"))?;
    // Read both pipes on threads, so a full pipe never blocks the tool.
    let mut out_pipe = child.stdout.take();
    let mut err_pipe = child.stderr.take();
    let out = thread::spawn(move || {
        let mut s = String::new();
        if let Some(p) = out_pipe.as_mut() {
            let _ = std::io::Read::read_to_string(p, &mut s);
        }
        s
    });
    let err = thread::spawn(move || {
        let mut s = String::new();
        if let Some(p) = err_pipe.as_mut() {
            let _ = std::io::Read::read_to_string(p, &mut s);
        }
        s
    });
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| format!("failed:{e}"))? {
            break status;
        }
        if started.elapsed() > REVIEW_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("failed:{tool} timeout"));
        }
        thread::sleep(Duration::from_millis(100));
    };
    let stdout = out.join().unwrap_or_default();
    let stderr = err.join().unwrap_or_default();
    if status.success() {
        return Ok(stdout);
    }
    Err(review_error(tool, &stderr))
}

/// The error code for what the tool wrote on failure.
fn review_error(tool: &str, stderr: &str) -> String {
    let lower = stderr.to_lowercase();
    const SIGNED_OUT: [&str; 6] = [
        "auth login",
        "not logged",
        "401",
        "unauthorized",
        "invalid token",
        "token is expired",
    ];
    if SIGNED_OUT.iter().any(|w| lower.contains(w)) {
        format!("auth:{tool}")
    } else if lower.contains("could not resolve")
        || lower.contains("404")
        || lower.contains("not found")
    {
        "notfound".to_string()
    } else {
        let line = stderr
            .lines()
            .map(str::trim)
            .find(|l| !l.is_empty())
            .unwrap_or("?");
        format!("failed:{}", line.chars().take(200).collect::<String>())
    }
}

#[tauri::command]
async fn list_reviews(
    app: AppHandle,
    forge: String,
    host: String,
    path: String,
    merged: Option<bool>,
) -> Result<String, String> {
    blocking(app, move |_| {
        let (tool, args) = review_args(&forge, &host, &path, merged.unwrap_or(false))
            .ok_or_else(|| "badrepo".to_string())?;
        run_review_tool(tool, &args)
    })
    .await
}

// ---- PR/MR popup ---------------------------------------------------------------
// A small window of its own in the bottom right corner of the screen, above the
// other applications, that never takes the focus: the PR/MR notices (a new one,
// a CI that failed, a merge). The main window sends it the notices; it sizes
// itself to them and hides when none is left.

const PR_POPUP: &str = "prpopup";
const PR_POPUP_WIDTH: f64 = 360.0;
const PR_POPUP_MARGIN: f64 = 16.0;

/// Creates the popup window, hidden, if it isn't there yet. Async: on Windows,
/// a window created from a synchronous command blocks the app.
#[tauri::command]
async fn open_pr_popup(app: AppHandle) -> Result<(), String> {
    if app.get_webview_window(PR_POPUP).is_some() {
        return Ok(());
    }
    tauri::WebviewWindowBuilder::new(&app, PR_POPUP, tauri::WebviewUrl::default())
        .title("Todoom · PR/MR")
        .inner_size(PR_POPUP_WIDTH, 120.0)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focusable(false)
        .focused(false)
        .visible(false)
        .shadow(true)
        .visible_on_all_workspaces(true)
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Where the popup goes, in physical pixels: the bottom right corner of the
/// screen's work area (above the taskbar or the Dock), its height capped by it.
fn pr_popup_place(
    area_x: i32,
    area_y: i32,
    area_w: u32,
    area_h: u32,
    scale: f64,
    height: f64,
) -> (f64, i32, i32) {
    let height = height
        .min(area_h as f64 / scale - 2.0 * PR_POPUP_MARGIN)
        .max(1.0);
    let x = area_x as f64 + area_w as f64 - (PR_POPUP_WIDTH + PR_POPUP_MARGIN) * scale;
    let y = area_y as f64 + area_h as f64 - (height + PR_POPUP_MARGIN) * scale;
    (height, x.round() as i32, y.round() as i32)
}

/// Called by the popup itself after each change: its height in CSS pixels, 0 to hide.
#[tauri::command]
fn pr_popup_layout(window: tauri::WebviewWindow, height: f64) -> Result<(), String> {
    if window.label() != PR_POPUP {
        return Err("not the popup".into());
    }
    if height <= 0.0 {
        return window.hide().map_err(|e| e.to_string());
    }
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())
        .ok_or("no screen")?;
    let area = monitor.work_area();
    let (height, x, y) = pr_popup_place(
        area.position.x,
        area.position.y,
        area.size.width,
        area.size.height,
        monitor.scale_factor(),
        height,
    );
    window
        .set_size(tauri::LogicalSize::new(PR_POPUP_WIDTH, height))
        .map_err(|e| e.to_string())?;
    window
        .set_position(tauri::PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())
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
    fn the_inbox_reads_small_text_files_of_its_folder_only() {
        let dir = std::env::temp_dir().join(format!("todoom-inbox-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("sub")).unwrap();
        fs::write(
            dir.join("singha - Brave Search"),
            "https://search.brave.com/search?q=singha",
        )
        .unwrap();
        fs::write(dir.join(".hidden"), "x").unwrap();
        fs::write(
            dir.join("big.txt"),
            vec![b'a'; (INBOX_MAX_BYTES + 1) as usize],
        )
        .unwrap();
        fs::write(dir.join("image.png"), [0x89, b'P', b'N', b'G', 0xff, 0xfe]).unwrap();
        let mut names: Vec<_> = list_inbox_in(&dir).into_iter().map(|f| f.name).collect();
        names.sort();
        assert_eq!(names, ["big.txt", "image.png", "singha - Brave Search"]);
        assert_eq!(
            read_inbox_in(&dir, "singha - Brave Search").unwrap(),
            "https://search.brave.com/search?q=singha"
        );
        assert!(read_inbox_in(&dir, "big.txt").is_err());
        assert!(
            read_inbox_in(&dir, "image.png")
                .unwrap()
                .contains('\u{FFFD}')
        );
        for trap in ["../settings.json", "sub/x", "..\\x", ".hidden", "C:x", ""] {
            assert!(read_inbox_in(&dir, trap).is_err(), "{trap}");
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn review_commands_take_only_plain_repositories() {
        let (tool, args) =
            review_args("github", "github.com", "mehdiAberkane/Todoom", false).unwrap();
        assert_eq!(tool, "gh");
        assert!(args.contains(&"github.com/mehdiAberkane/Todoom".to_string()));
        let (tool, args) =
            review_args("gitlab", "gitlab.example.com", "g/sub/project", false).unwrap();
        assert_eq!(tool, "glab");
        assert!(args.contains(&"path=g/sub/project".to_string()));
        let (_, merged) = review_args("gitlab", "gitlab.com", "g/p", true).unwrap();
        assert!(merged.iter().any(|a| a.contains("state: merged")));
        let (_, merged) = review_args("github", "github.com", "o/r", true).unwrap();
        assert!(
            merged
                .windows(2)
                .any(|w| w[0] == "--state" && w[1] == "merged")
        );
        assert!(args.contains(&"gitlab.example.com".to_string()));
        for (forge, host, path) in [
            ("github", "github.com", "a/b/c"),
            ("github", "github.com", "../b"),
            ("github", "github.com", "-x/b"),
            ("github", "github.com", "a/b;rm"),
            ("github", "-h", "a/b"),
            ("github", "evil.com/x", "a/b"),
            ("gitlab", "gitlab.com", "single"),
            ("gitlab", "gitlab.com", "g/.hidden"),
            ("bitbucket", "bitbucket.org", "a/b"),
            ("github", "github.com", "a b/c"),
        ] {
            assert!(
                review_args(forge, host, path, false).is_none(),
                "{forge} {host} {path}"
            );
        }
    }

    #[test]
    fn review_errors_say_what_to_do() {
        assert_eq!(review_error("glab", "glab: Invalid token"), "auth:glab");
        assert_eq!(
            review_error(
                "gh",
                "To get started with GitHub CLI, please run:  gh auth login"
            ),
            "auth:gh"
        );
        assert_eq!(
            review_error(
                "glab",
                "GET https://gitlab.com/api/v4/user: 401 {message: 401 Unauthorized}"
            ),
            "auth:glab"
        );
        assert_eq!(
            review_error(
                "gh",
                "GraphQL: Could not resolve to a Repository with the name 'a/b'."
            ),
            "notfound"
        );
        assert_eq!(review_error("gh", "\nboom\nmore"), "failed:boom");
    }

    #[test]
    fn the_pr_popup_sits_in_the_bottom_right_corner_of_the_work_area() {
        // 1920×1040 work area (taskbar below), 100 %: 16 px from the right and the taskbar.
        assert_eq!(
            pr_popup_place(0, 0, 1920, 1040, 1.0, 200.0),
            (200.0, 1544, 824)
        );
        // 150 %, a second screen on the left: physical pixels, height kept in CSS pixels.
        assert_eq!(
            pr_popup_place(-2880, 0, 2880, 1620, 1.5, 200.0),
            (200.0, -564, 1296)
        );
        // Taller than the screen: capped.
        assert_eq!(pr_popup_place(0, 0, 1920, 1040, 1.0, 5000.0).0, 1008.0);
    }

    #[test]
    fn summary_names_hold_no_path() {
        for ok in [
            "Todoom.md",
            "0 - Aujourd'hui.md",
            "Projet- Été - 2026.md",
            "Todoom (TOD2).md",
        ] {
            assert!(is_reading_name(ok), "{ok}");
        }
        for bad in [
            "",
            ".md",
            "x.json",
            "x.txt",
            "../x.md",
            "a/b.md",
            "a\\b.md",
            ".cache.md",
            " x.md",
            "C:x.md",
            "x?.md",
            "x\n.md",
        ] {
            assert!(!is_reading_name(bad), "{bad}");
        }
    }

    #[test]
    fn exports_are_text_reports_at_a_chosen_place() {
        let base = std::env::temp_dir();
        assert!(export_target(base.join("todoom.md").to_str().unwrap()).is_ok());
        assert!(export_target(base.join("todoom.CSV").to_str().unwrap()).is_ok());
        for bad in ["x.exe", "x.json", "x.md.bat", "x"] {
            assert!(
                export_target(base.join(bad).to_str().unwrap()).is_err(),
                "{bad}"
            );
        }
        assert!(export_target("relative.md").is_err());
    }

    #[test]
    fn snapshot_names_hold_no_path() {
        for ok in [
            "2026-11-22",
            "2026-11-22_09-30-00_manual",
            "2026-11-22_09-30-00_before-restore",
        ] {
            assert!(is_snapshot_name(ok), "{ok}");
        }
        for bad in ["", "..", "../x", "a/b", "a\\b", ".hidden", "C:", "x.json"] {
            assert!(!is_snapshot_name(bad), "{bad}");
        }
    }

    #[test]
    fn restoring_puts_the_files_back_and_removes_the_newer_ones() {
        let root = std::env::temp_dir().join(format!("todoom-restore-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("boards/b1/cards")).unwrap();
        fs::create_dir_all(root.join(".presence")).unwrap();
        fs::write(root.join("boards/b1/board.json"), "{ abîmé").unwrap();
        fs::write(root.join("boards/b1/cards/new.json"), r#"{"id":"new"}"#).unwrap();
        fs::write(root.join(".presence/PC.json"), r#"{"host":"PC"}"#).unwrap();
        fs::write(root.join("notes.json"), "{}").unwrap();
        let snapshot = SnapshotFile {
            files: HashMap::from([
                (
                    "boards/b1/board.json".to_string(),
                    r#"{"id":"b1"}"#.to_string(),
                ),
                (
                    "boards/b1/cards/old.json".to_string(),
                    r#"{"id":"old"}"#.to_string(),
                ),
            ]),
        };
        assert_eq!(
            restore_into(&root, &snapshot).unwrap(),
            Restored {
                written: 2,
                removed: 1
            }
        );
        assert_eq!(
            fs::read_to_string(root.join("boards/b1/board.json")).unwrap(),
            r#"{"id":"b1"}"#
        );
        assert!(root.join("boards/b1/cards/old.json").exists());
        assert!(!root.join("boards/b1/cards/new.json").exists());
        // Not ours to remove: presence, and a file that isn't Todoom data.
        assert!(root.join(".presence/PC.json").exists());
        assert!(root.join("notes.json").exists());

        let evil = SnapshotFile {
            files: HashMap::from([("../outside.json".to_string(), "{}".to_string())]),
        };
        assert!(restore_into(&root, &evil).is_err());
        let damaged = SnapshotFile {
            files: HashMap::from([("settings.json".to_string(), "{ nope".to_string())]),
        };
        assert!(restore_into(&root, &damaged).is_err());
        assert!(
            root.join("boards/b1/cards/old.json").exists(),
            "a refused snapshot changes nothing"
        );
        let _ = fs::remove_dir_all(&root);
    }

    fn load(root: &Path, cache: &FileCache) -> Vec<(String, String)> {
        let loaded = load_files(
            root,
            cache,
            &Default::default(),
            Duration::from_secs(10),
            read_file,
        );
        assert!(loaded.pending.is_empty(), "{:?}", loaded.pending);
        let mut files: Vec<_> = loaded
            .files
            .into_iter()
            .map(|f| (f.path, f.content))
            .collect();
        files.sort();
        files
    }

    fn slow_read(path: &Path) -> std::io::Result<String> {
        if path
            .file_name()
            .is_some_and(|n| n.to_string_lossy().starts_with("slow"))
        {
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
        let first = load_files(
            &root,
            &cache,
            &reading,
            Duration::from_millis(150),
            slow_read,
        );
        assert!(
            started.elapsed() < Duration::from_millis(500),
            "the load waited for the slow files"
        );
        assert_eq!(first.files.len(), 21);
        let mut pending = first.pending.clone();
        pending.sort();
        assert_eq!(
            pending,
            ["boards/b1/cards/slow1.json", "boards/b1/cards/slow2.json"]
        );

        // Read in parallel in the background: both are ready well before 2 × 600 ms.
        thread::sleep(Duration::from_millis(800));
        let second = load_files(
            &root,
            &cache,
            &reading,
            Duration::from_millis(150),
            slow_read,
        );
        assert!(second.pending.is_empty(), "{:?}", second.pending);
        assert_eq!(second.files.len(), 23);
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn an_unreadable_file_is_pending_and_the_load_does_not_wait_for_it() {
        fn failing_read(path: &Path) -> std::io::Result<String> {
            if path
                .file_name()
                .is_some_and(|n| n.to_string_lossy().starts_with("broken"))
            {
                return Err(std::io::Error::other("Drive a refusé"));
            }
            read_file(path)
        }
        let root = std::env::temp_dir().join(format!("todoom-broken-{}", std::process::id()));
        fs::create_dir_all(root.join("boards/b1/cards")).unwrap();
        fs::write(root.join("boards/b1/board.json"), "board").unwrap();
        fs::write(root.join("boards/b1/cards/broken.json"), "x").unwrap();
        let started = Instant::now();
        let loaded = load_files(
            &root,
            &Default::default(),
            &Default::default(),
            Duration::from_secs(10),
            failing_read,
        );
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
            assert!(
                !allowed(trap, Access::Remove),
                "suppression acceptée : {trap}"
            );
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
    fn attachments_are_named_files_in_their_card_folder_only() {
        for ok in [
            "boards/b1/attachments/c1/mw1-capture.png",
            "boards/b1/attachments/c1/mw1-rapport_final.v2.pdf",
        ] {
            assert!(is_attachment(ok), "{ok}");
            assert!(allowed(ok, Access::Remove), "{ok}");
        }
        assert!(allowed("boards/b1/attachments/c1/mw1.json", Access::Write));
        assert!(allowed("boards/b1/attachments/c1", Access::Remove));
        for no in [
            "boards/b1/attachments/c1/mw1-data.json",
            "boards/b1/attachments/c1/capture.png",
            "boards/b1/attachments/c1/.hidden",
            "boards/b1/attachments/c1/mw1-..png",
            "boards/b1/attachments/c1/mw1-a b.png",
            "boards/b1/attachments/c1/x/mw1-a.png",
            "boards/b1/attachments/../cards/mw1-a.png",
            "boards/b1/cards/mw1-a.png",
        ] {
            assert!(!is_attachment(no), "{no}");
        }
        assert!(
            !allowed("boards/b1/attachments/c1/mw1-capture.png", Access::Write),
            "binary files go through write_attachment"
        );
    }

    #[test]
    fn an_attachment_is_written_once_within_the_size_limit_and_read_back() {
        let root = std::env::temp_dir().join(format!("todoom-attach-{}", std::process::id()));
        let rel = "boards/b1/attachments/c1/mw1-capture.png";
        let bytes = [0x89u8, b'P', b'N', b'G', 0, 1, 2, 255];
        store_attachment(&root, rel, &bytes).unwrap();
        assert_eq!(load_attachment(&root, rel).unwrap(), bytes);
        assert!(
            store_attachment(&root, rel, &bytes).is_err(),
            "never overwritten"
        );
        let big = vec![0u8; MAX_ATTACHMENT_BYTES + 1];
        assert!(store_attachment(&root, "boards/b1/attachments/c1/mw2-big.bin", &big).is_err());
        assert!(store_attachment(&root, "boards/b1/cards/mw3-x.png", &bytes).is_err());
        assert!(load_attachment(&root, "boards/b1/board.json").is_err());
        fs::remove_dir_all(&root).unwrap();
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
            assert!(
                check_data_dir(&Path::new(&std::env::var("USERPROFILE").unwrap()).join("Todoom"))
                    .is_ok()
            );
        } else {
            assert!(check_data_dir(Path::new("/")).is_err());
            assert!(check_data_dir(Path::new("/etc/todoom")).is_err());
            assert!(check_data_dir(Path::new(&std::env::var("HOME").unwrap())).is_err());
            assert!(
                check_data_dir(&Path::new(&std::env::var("HOME").unwrap()).join("Todoom")).is_ok()
            );
        }
    }

    #[test]
    fn writes_and_removes_cards_and_boards_in_the_data_folder() {
        let root = std::env::temp_dir().join(format!("todoom-io-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let write = |rel: &str, content: &str| {
            prepare_write(&root, rel).and_then(|t| write_atomic(&t, content))
        };
        let remove = |rel: &str| prepare_remove(&root, rel).and_then(|t| remove_target(&t));

        // Creates the folders, then overwrites in place, leaving no temp file behind.
        write("boards/b1/cards/c1.json", r#"{"id":"c1","title":"v1"}"#).unwrap();
        write("boards/b1/cards/c1.json", r#"{"id":"c1","title":"v2"}"#).unwrap();
        write("boards/b1/board.json", r#"{"id":"b1"}"#).unwrap();
        let card = root.join("boards/b1/cards/c1.json");
        assert_eq!(
            fs::read_to_string(&card).unwrap(),
            r#"{"id":"c1","title":"v2"}"#
        );
        assert!(!root.join("boards/b1/cards/c1.json.tmp").exists());

        // Refused before touching the disk.
        assert!(write("../outside.json", "{}").is_err());
        assert!(!root.parent().unwrap().join("outside.json").exists());
        fs::write(root.join("boards/b1/cards/broken.json"), "{coupé").unwrap();
        assert!(write("boards/b1/cards/broken.json", "{}").is_err());
        assert_eq!(
            fs::read_to_string(root.join("boards/b1/cards/broken.json")).unwrap(),
            "{coupé"
        );
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
        let (broken, valid, missing) = (
            dir.join("broken.json"),
            dir.join("valid.json"),
            dir.join("missing.json"),
        );
        fs::write(&broken, r#"{"id":"c1","title":"coupé par Dri"#).unwrap();
        fs::write(&valid, r#"{"id":"c2"}"#).unwrap();

        assert!(
            refuse_unreadable(&broken, "broken.json")
                .unwrap_err()
                .contains("illisible")
        );
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
            [
                ("boards/b1/board.json".into(), "board".into()),
                ("boards/b1/cards/c1.json".into(), "v1".into())
            ]
        );

        fs::write(cards.join("c1.json"), "version 2").unwrap();
        fs::write(cards.join("c2.json"), "new").unwrap();
        fs::remove_file(root.join("boards/b1/board.json")).unwrap();
        assert_eq!(
            load(&root, &cache),
            [
                ("boards/b1/cards/c1.json".into(), "version 2".into()),
                ("boards/b1/cards/c2.json".into(), "new".into())
            ]
        );
        assert_eq!(cache.lock().unwrap().len(), 2);

        fs::remove_dir_all(&root).unwrap();
    }
}
