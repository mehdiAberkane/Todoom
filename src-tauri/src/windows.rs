//! The app's small windows and its icon: the quick capture window and its global
//! shortcut, the notification area icon, and the PR/MR popup.

use super::*;

// ---- Quick capture ---------------------------------------------------------
// A small window to note an idea from anywhere: a global shortcut, or the
// Todoom icon in the notification area. It only sends the title to the main
// window, which makes the card like any other (number, history, undo).

/// Ctrl + Alt + N, Cmd + Option + N on a Mac.
pub(crate) const CAPTURE_SHORTCUT: &str = "CommandOrControl+Alt+N";

pub(crate) fn open_capture(app: &AppHandle) {
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

pub(crate) fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// The icon in the notification area (menu bar on a Mac): capture, show, quit.
pub(crate) fn build_tray(app: &tauri::App) -> tauri::Result<()> {
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

// ---- PR/MR popup ---------------------------------------------------------------
// A small window of its own in the bottom right corner of the screen, above the
// other applications, that never takes the focus: the PR/MR notices (a new one,
// a CI that failed, a merge). The main window sends it the notices; it sizes
// itself to them and hides when none is left.

pub(crate) const PR_POPUP: &str = "prpopup";
const PR_POPUP_WIDTH: f64 = 360.0;
const PR_POPUP_MARGIN: f64 = 16.0;

/// Creates the popup window, hidden, if it isn't there yet. Async: on Windows,
/// a window created from a synchronous command blocks the app.
#[tauri::command]
pub(crate) async fn open_pr_popup(app: AppHandle) -> Result<(), String> {
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
pub(crate) fn pr_popup_place(
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
pub(crate) fn pr_popup_layout(window: tauri::WebviewWindow, height: f64) -> Result<(), String> {
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
