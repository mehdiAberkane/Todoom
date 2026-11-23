//! Which folder holds the data (chosen in a dialog opened here, never a path
//! from the page; never a drive root, home or system folder), and watching it
//! for the changes other computers make.

use super::*;

pub(crate) const CHANGED_EVENT: &str = "todoom://changed";

/// Folders that must never become the data folder: a whole drive, the home folder
/// itself or a system folder would be scanned on every reload and written into.
pub(crate) fn check_data_dir(path: &Path) -> Result<(), String> {
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

pub(crate) fn is_temp(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.ends_with(".tmp"))
}

pub(crate) fn remember(state: &AppState, root: &Path, path: &Path, prefix: bool) {
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

pub(crate) fn start_watcher(app: &AppHandle, state: &AppState) {
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
pub(crate) fn get_data_dir(state: State<AppState>) -> Option<String> {
    state.config.lock().unwrap().data_dir.clone()
}

/// Is this the folder the user chose? The one picked in the dialog, the Drive
/// folder Todoom proposed, or the current one: never a path a script made up.
pub(crate) fn chosen_data_dir(
    path: &str,
    picked: Option<&str>,
    suggested: Option<&str>,
    current: Option<&str>,
) -> bool {
    [picked, suggested, current]
        .into_iter()
        .flatten()
        .any(|p| Path::new(p) == Path::new(path))
}

/// The folder dialog, opened from Rust: what it returns is remembered as chosen.
#[tauri::command]
pub(crate) async fn pick_data_dir(app: AppHandle, title: String) -> Result<Option<String>, String> {
    blocking(app, move |app| {
        use tauri_plugin_dialog::DialogExt;
        let picked = app
            .dialog()
            .file()
            .set_title(title)
            .blocking_pick_folder()
            .and_then(|p| p.into_path().ok())
            .map(|p| p.to_string_lossy().into_owned());
        if let Some(dir) = &picked {
            *app.state::<AppState>().picked_dir.lock().unwrap() = Some(dir.clone());
        }
        Ok(picked)
    })
    .await
}

#[tauri::command]
pub(crate) async fn set_data_dir(app: AppHandle, path: String) -> Result<(), String> {
    blocking(app, move |app| {
        let state = app.state::<AppState>();
        let picked = state.picked_dir.lock().unwrap().clone();
        let current = state.config.lock().unwrap().data_dir.clone();
        if !chosen_data_dir(
            &path,
            picked.as_deref(),
            find_drive_folder().as_deref(),
            current.as_deref(),
        ) {
            return Err(tr(
                format!("Choisis le dossier avec « Parcourir… » : {path}"),
                format!("Choose the folder with « Browse… »: {path}"),
            ));
        }
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
            save_config(app, &cfg)?;
        }
        state.files.lock().unwrap().clear();
        start_watcher(app, &state);
        Ok(())
    })
    .await
}

#[tauri::command]
pub(crate) async fn suggest_data_dir(app: AppHandle) -> Result<Option<String>, String> {
    blocking(app, |_| Ok(find_drive_folder())).await
}

/// Looks for a local Google Drive folder and proposes `<Drive>/Todoom`.
pub(crate) fn find_drive_folder() -> Option<String> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_data_folder_is_one_the_user_chose() {
        let picked = Some("D:\\Partage\\Todoom");
        assert!(chosen_data_dir("D:\\Partage\\Todoom", picked, None, None));
        assert!(chosen_data_dir(
            "G:\\Mon Drive\\Todoom",
            None,
            Some("G:\\Mon Drive\\Todoom"),
            None
        ));
        assert!(chosen_data_dir(
            "E:\\Todoom",
            None,
            None,
            Some("E:\\Todoom")
        ));
        // A path no dialog gave: refused, even next to a picked one.
        assert!(!chosen_data_dir(
            "C:\\Users\\kirua\\.ssh",
            picked,
            Some("G:\\Mon Drive\\Todoom"),
            None
        ));
        assert!(!chosen_data_dir(
            "D:\\Partage\\Todoom\\..\\x",
            picked,
            None,
            None
        ));
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
}
