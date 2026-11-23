use super::*;

// ---- Inbox --------------------------------------------------------------------
// Ideas dropped from the phone (« Share › Save to Drive ») into the data
// folder's « boîte de réception »: listed, read (small text only) and removed
// once their card is written. Nothing else of the folder is reachable this way.

pub(crate) const INBOX_DIR: &str = "boîte de réception";
const INBOX_MAX_BYTES: u64 = 64 * 1024;

/// A file name as the phone makes it (« singha - Brave Search »): any text,
/// but no path, no hidden file.
pub(crate) fn is_inbox_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 255
        && !name.starts_with('.')
        && !name
            .chars()
            .any(|c| c.is_control() || matches!(c, '/' | '\\' | ':'))
}

pub(crate) fn inbox_dir(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let root = data_root(&app.state::<AppState>())?;
    let dir = root.join(INBOX_DIR);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok((root, dir))
}

pub(crate) fn inbox_file(dir: &Path, name: &str) -> Result<PathBuf, String> {
    if !is_inbox_name(name) {
        return Err(tr(
            format!("Fichier refusé : {name}"),
            format!("File refused: {name}"),
        ));
    }
    Ok(dir.join(name))
}

#[derive(Serialize)]
pub(crate) struct InboxFile {
    name: String,
    size: u64,
}

/// The files waiting in the inbox (the folder is made if missing, so the phone can pick it).
pub(crate) fn list_inbox_in(dir: &Path) -> Vec<InboxFile> {
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
pub(crate) fn read_inbox_in(dir: &Path, name: &str) -> Result<String, String> {
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
pub(crate) async fn list_inbox(app: AppHandle) -> Result<Vec<InboxFile>, String> {
    blocking(app, |app| Ok(list_inbox_in(&inbox_dir(app)?.1))).await
}

#[tauri::command]
pub(crate) async fn read_inbox(app: AppHandle, name: String) -> Result<String, String> {
    blocking(app, move |app| read_inbox_in(&inbox_dir(app)?.1, &name)).await
}

#[tauri::command]
pub(crate) async fn remove_inbox(app: AppHandle, name: String) -> Result<(), String> {
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
}
