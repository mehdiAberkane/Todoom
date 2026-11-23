//! Exports (a board as Markdown, CSV or JSON): written where the user chose in a
//! save dialog opened here, never at a path from the page.

use super::*;

/// Exports go where the user chose in the save dialog; only text reports
/// (Markdown, CSV), never a program or a data file of the folder.
pub(crate) fn export_target(path: &str) -> Result<PathBuf, String> {
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

/// The save dialog, opened from Rust, and the export written where it says: the
/// destination is never a path given by the page. False when it is cancelled.
#[tauri::command]
pub(crate) async fn save_export(
    app: AppHandle,
    file_name: String,
    content: String,
) -> Result<bool, String> {
    blocking(app, move |app| {
        use tauri_plugin_dialog::DialogExt;
        let ext = export_extension(&file_name)?;
        let Some(chosen) = app
            .dialog()
            .file()
            .set_file_name(&file_name)
            .add_filter(ext.to_uppercase(), &[ext])
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let path = chosen.into_path().map_err(|e| e.to_string())?;
        fs::write(export_target(&path.to_string_lossy())?, content).map_err(|e| e.to_string())?;
        Ok(true)
    })
    .await
}

/// The kind of report a suggested file name asks for: Markdown, CSV or text only.
pub(crate) fn export_extension(file_name: &str) -> Result<&'static str, String> {
    let ext = Path::new(file_name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase());
    match ext.as_deref() {
        Some("md") => Ok("md"),
        Some("csv") => Ok("csv"),
        Some("txt") => Ok("txt"),
        _ => Err(tr(
            format!("Export refusé : {file_name}"),
            format!("Export refused: {file_name}"),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_export_is_a_text_report() {
        assert_eq!(export_extension("Todoom-2026-11-23.MD"), Ok("md"));
        assert_eq!(export_extension("board.csv"), Ok("csv"));
        assert!(export_extension("x.exe").is_err());
        assert!(export_extension("noext").is_err());
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
}
