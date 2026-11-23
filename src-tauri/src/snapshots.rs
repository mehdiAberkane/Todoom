use super::*;

// ---- Snapshots -------------------------------------------------------------
// A dated copy of the data files, kept on this computer, outside the synced
// folder: a sync incident or a script that damages files can't take them too.
// One JSON file per snapshot: { version, createdAt, host, files: { path: content } }.
// Attached files themselves aren't in it (only their descriptions): too big.

pub(crate) fn snapshots_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("snapshots");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// A snapshot's name, as the UI makes it (2026-11-22, 2026-11-22_09-30-00_manual): no path in it.
pub(crate) fn is_snapshot_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 80
        && !name.starts_with('.')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub(crate) fn snapshot_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    if !is_snapshot_name(name) {
        return Err(tr(
            format!("Nom d'instantané invalide : {name}"),
            format!("Invalid snapshot name: {name}"),
        ));
    }
    Ok(snapshots_dir(app)?.join(format!("{name}.json")))
}

#[derive(Serialize)]
pub(crate) struct SnapshotInfo {
    name: String,
    size: u64,
}

#[tauri::command]
pub(crate) async fn list_snapshots(app: AppHandle) -> Result<Vec<SnapshotInfo>, String> {
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
pub(crate) async fn save_snapshot(
    app: AppHandle,
    name: String,
    content: String,
) -> Result<(), String> {
    blocking(app, move |app| {
        serde_json::from_str::<serde_json::Value>(&content).map_err(|e| e.to_string())?;
        write_atomic(&snapshot_path(app, &name)?, &content)
    })
    .await
}

#[tauri::command]
pub(crate) async fn delete_snapshot(app: AppHandle, name: String) -> Result<(), String> {
    blocking(app, move |app| remove_target(&snapshot_path(app, &name)?)).await
}

#[derive(Deserialize)]
pub(crate) struct SnapshotFile {
    files: HashMap<String, String>,
}

#[derive(Serialize, Debug, PartialEq)]
pub(crate) struct Restored {
    written: usize,
    removed: usize,
}

/// Puts the data files back as in the snapshot: each one written (even over a
/// file that became unreadable), and the data files made since removed. Only
/// paths the UI may write are touched; the presence files are left alone.
pub(crate) fn restore_into(root: &Path, snapshot: &SnapshotFile) -> Result<Restored, String> {
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
pub(crate) async fn restore_snapshot(app: AppHandle, name: String) -> Result<Restored, String> {
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
