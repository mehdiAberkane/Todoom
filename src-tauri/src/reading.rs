use super::*;

// ---- Summaries for the phone ------------------------------------------------
// Plain text files in the data folder's « lecture » subfolder, readable in the
// Google Drive app. Only that folder, only .md files with a plain name.

pub(crate) const READING_DIR: &str = "lecture";

/// A summary's file name, as the UI makes it from a board's name: no path, no
/// hidden file, nothing Windows, macOS or Drive refuses.
pub(crate) fn is_reading_name(name: &str) -> bool {
    name.len() <= 160
        && name.ends_with(".md")
        && name.len() > 3
        && !name.starts_with('.')
        && !name.starts_with(' ')
        && !name.chars().any(|c| {
            c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
        })
}

pub(crate) fn reading_path(app: &AppHandle, name: &str) -> Result<(PathBuf, PathBuf), String> {
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
pub(crate) async fn list_reading(app: AppHandle) -> Result<Vec<String>, String> {
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
pub(crate) async fn write_reading(
    app: AppHandle,
    name: String,
    content: String,
) -> Result<(), String> {
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
pub(crate) async fn remove_reading(app: AppHandle, name: String) -> Result<(), String> {
    blocking(app, move |app| {
        let (root, target) = reading_path(app, &name)?;
        remember(&app.state::<AppState>(), &root, &target, false);
        remove_target(&target)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
