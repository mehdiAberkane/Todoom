//! Files attached to a card: in its own folder of the data folder, under a plain
//! name, written once, within a size limit.

use super::*;

/// Largest attached file: Google Drive copies every one of them to every computer.
pub(crate) const MAX_ATTACHMENT_BYTES: usize = 10 * 1024 * 1024;

pub(crate) fn refuse_attachment(rel: &str) -> Result<(), String> {
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
pub(crate) fn store_attachment(root: &Path, rel: &str, bytes: &[u8]) -> Result<PathBuf, String> {
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

pub(crate) fn load_attachment(root: &Path, rel: &str) -> Result<Vec<u8>, String> {
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
pub(crate) async fn write_attachment(
    app: AppHandle,
    path: String,
    data: String,
) -> Result<(), String> {
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
pub(crate) async fn read_attachment(app: AppHandle, path: String) -> Result<String, String> {
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
pub(crate) async fn reveal_attachment(app: AppHandle, path: String) -> Result<(), String> {
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
