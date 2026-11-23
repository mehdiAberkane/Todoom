//! The data folder's files: which paths the interface may write or remove (the
//! allow list), loading them all (cached, slow files in the background), and
//! writing or removing one, atomically, never over a file that couldn't be read.

use super::*;

#[derive(Serialize)]
pub(crate) struct FileEntry {
    path: String,
    content: String,
}

pub(crate) fn data_root(state: &AppState) -> Result<PathBuf, String> {
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
pub(crate) fn resolve(root: &Path, rel: &str) -> Result<PathBuf, String> {
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
pub(crate) enum Access {
    Write,
    Remove,
}

/// The only paths the UI may write or delete, relative to the data folder: the
/// files Todoom itself produces. Anything else is refused, so the commands can't
/// be turned into "write or delete any file" even from injected script.
pub(crate) fn is_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Name of an attached file, as the UI makes it: `<id>-<cleaned name>`. Never a
/// JSON file (those are loaded as data), never hidden, no path in it.
pub(crate) fn is_attachment_name(s: &str) -> bool {
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
pub(crate) fn is_attachment(rel: &str) -> bool {
    matches!(rel.split('/').collect::<Vec<_>>().as_slice(),
        ["boards", board, "attachments", card, file] if is_id(board) && is_id(card) && is_attachment_name(file))
}

pub(crate) fn allowed(rel: &str, access: Access) -> bool {
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

pub(crate) type FileCache = Arc<Mutex<HashMap<PathBuf, CachedFile>>>;

/// A data file found in the folder, before it is read.
#[derive(Clone)]
pub(crate) struct Listed {
    pub(crate) path: PathBuf,
    pub(crate) rel: String,
    modified: SystemTime,
    len: u64,
}

/// The biggest data file read or written (MAX_DATA_FILE_BYTES in validate.ts): one
/// past it (a sync accident, a faulty script, a file renamed .json) is listed as
/// ignored, never read, sent to the page, copied into a snapshot, nor overwritten.
pub(crate) const MAX_DATA_FILE_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Serialize)]
pub(crate) struct TooBig {
    path: String,
    size: u64,
}

/// What a load returns: the files read, and those not available yet.
#[derive(Serialize)]
pub(crate) struct Loaded {
    files: Vec<FileEntry>,
    /// Data files over MAX_DATA_FILE_BYTES: not read.
    #[serde(rename = "tooBig")]
    too_big: Vec<TooBig>,
    /// Still being read (Google Drive downloading an "online only" file) or unreadable for now;
    /// the UI shows what it has and loads again a moment later.
    pending: Vec<String>,
}

/// A load answers with what it has after this long, instead of waiting for the slowest file.
pub(crate) const LOAD_DEADLINE: Duration = Duration::from_secs(15);
/// Files read at once: Google Drive downloads "online only" files one per read.
const READERS: usize = 8;

/// The JSON files under `dir`, from their metadata only: listing is fast even
/// when Google Drive hasn't downloaded the files yet.
pub(crate) fn list(root: &Path, dir: &Path, out: &mut Vec<Listed>) {
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

pub(crate) fn is_fresh(l: &Listed, cache: &HashMap<PathBuf, CachedFile>) -> bool {
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
pub(crate) fn load_files(
    root: &Path,
    cache: &FileCache,
    reading: &Arc<Mutex<HashSet<PathBuf>>>,
    deadline: Duration,
    read: fn(&Path) -> std::io::Result<String>,
) -> Loaded {
    let started = Instant::now();
    let mut listed = Vec::new();
    list(root, root, &mut listed);
    // Too big: decided from the metadata, before any read.
    let (listed, big): (Vec<Listed>, Vec<Listed>) = listed
        .into_iter()
        .partition(|l| l.len <= MAX_DATA_FILE_BYTES);
    let too_big: Vec<TooBig> = big
        .into_iter()
        .map(|l| {
            log::warn!(
                "{} ignoré : {} octets, plus que {MAX_DATA_FILE_BYTES}",
                l.rel,
                l.len
            );
            TooBig {
                path: l.rel,
                size: l.len,
            }
        })
        .collect();
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
    Loaded {
        files,
        too_big,
        pending,
    }
}

pub(crate) fn read_file(path: &Path) -> std::io::Result<String> {
    fs::read_to_string(path)
}

#[tauri::command]
pub(crate) async fn load_all(app: AppHandle) -> Result<Loaded, String> {
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
pub(crate) fn refuse_unreadable(target: &Path, rel: &str) -> Result<(), String> {
    // Too big to have been read: never written over either.
    if fs::metadata(target).is_ok_and(|m| m.len() > MAX_DATA_FILE_BYTES) {
        return Err(tr(
            format!(
                "{rel} est trop gros (plus de 5 Mo) : il n'est ni lu ni écrasé. Vérifie-le à la main."
            ),
            format!(
                "{rel} is too big (over 5 MB): it is neither read nor overwritten. Check it by hand."
            ),
        ));
    }
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
pub(crate) fn prepare_write(root: &Path, rel: &str) -> Result<PathBuf, String> {
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
pub(crate) fn write_atomic(target: &Path, content: &str) -> Result<(), String> {
    let tmp = target.with_extension("json.tmp");
    fs::write(&tmp, content).map_err(|e| e.to_string())?;
    if fs::rename(&tmp, target).is_err() {
        // Some virtual drives refuse renames over existing files.
        let _ = fs::remove_file(&tmp);
        fs::write(target, content).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub(crate) fn prepare_remove(root: &Path, rel: &str) -> Result<PathBuf, String> {
    if !allowed(rel, Access::Remove) {
        return Err(tr(
            format!("Suppression refusée : {rel} n'est pas une carte ni un tableau Todoom."),
            format!("Removal refused: {rel} is not a Todoom card or board."),
        ));
    }
    resolve(root, rel)
}

pub(crate) fn remove_target(target: &Path) -> Result<(), String> {
    if target.is_dir() {
        fs::remove_dir_all(target).map_err(|e| e.to_string())
    } else if target.exists() {
        fs::remove_file(target).map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}

/// Errors also go to the log file: the UI shows them, but only until it closes.
pub(crate) fn logged<T>(what: String, result: Result<T, String>) -> Result<T, String> {
    if let Err(e) = &result {
        log::warn!("{what} : {e}");
    }
    result
}

#[tauri::command]
pub(crate) async fn write_file(
    app: AppHandle,
    path: String,
    content: String,
) -> Result<(), String> {
    let what = format!("écriture de {path}");
    let result = blocking(app, move |app| {
        if content.len() as u64 > MAX_DATA_FILE_BYTES {
            return Err(tr(
                format!("{path} dépasserait 5 Mo : pas écrit."),
                format!("{path} would be over 5 MB: not written."),
            ));
        }
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
pub(crate) async fn remove_path(app: AppHandle, path: String) -> Result<(), String> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_data_file_too_big_is_listed_never_read_nor_overwritten() {
        let root = std::env::temp_dir().join(format!("todoom-big-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("boards/b1/cards")).unwrap();
        fs::write(root.join("boards/b1/board.json"), r#"{"id":"b1"}"#).unwrap();
        let big = root.join("boards/b1/cards/huge.json");
        let file = fs::File::create(&big).unwrap();
        file.set_len(MAX_DATA_FILE_BYTES + 1).unwrap();
        drop(file);
        fn read(p: &Path) -> std::io::Result<String> {
            assert!(
                !p.ends_with("huge.json"),
                "a file over the limit must not be read"
            );
            fs::read_to_string(p)
        }
        let cache: FileCache = Default::default();
        let loaded = load_files(
            &root,
            &cache,
            &Default::default(),
            Duration::from_secs(5),
            read,
        );
        assert_eq!(loaded.files.len(), 1);
        assert_eq!(loaded.too_big.len(), 1);
        assert_eq!(loaded.too_big[0].path, "boards/b1/cards/huge.json");
        assert_eq!(loaded.too_big[0].size, MAX_DATA_FILE_BYTES + 1);
        assert!(refuse_unreadable(&big, "boards/b1/cards/huge.json").is_err());
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
