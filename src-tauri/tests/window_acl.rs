//! Which window may call which of the app's commands, as Tauri decides it from
//! build.rs (the app manifest) and capabilities/*.json. The commands here are
//! stand-ins with the real names: only Tauri's access check is under test.

use tauri::WebviewWindowBuilder;
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{INVOKE_KEY, get_ipc_response, mock_builder};
use tauri::webview::InvokeRequest;

#[tauri::command]
fn write_file() -> &'static str {
    "ran"
}
#[tauri::command]
fn set_data_dir() -> &'static str {
    "ran"
}
#[tauri::command]
fn pr_popup_layout() -> &'static str {
    "ran"
}

fn call(window: &str, cmd: &str) -> Result<String, String> {
    let app = mock_builder()
        .invoke_handler(tauri::generate_handler![
            write_file,
            set_data_dir,
            pr_popup_layout
        ])
        .build(tauri::generate_context!(test = true))
        .expect("app");
    let webview = WebviewWindowBuilder::new(&app, window, Default::default())
        .build()
        .expect("window");
    get_ipc_response(
        &webview,
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "http://tauri.localhost".parse().unwrap(),
            body: InvokeBody::default(),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .map(|b| b.deserialize::<String>().unwrap())
    .map_err(|e| e.to_string())
}

#[test]
fn the_main_window_may_call_the_app_commands() {
    assert_eq!(call("main", "write_file"), Ok("ran".into()));
    assert_eq!(call("main", "set_data_dir"), Ok("ran".into()));
}

#[test]
fn the_capture_window_may_call_none() {
    // It only sends the idea to the main window, by an event.
    for cmd in ["write_file", "set_data_dir", "pr_popup_layout"] {
        assert!(call("capture", cmd).is_err(), "{cmd}");
    }
}

#[test]
fn the_pr_popup_may_only_size_itself() {
    assert_eq!(call("prpopup", "pr_popup_layout"), Ok("ran".into()));
    for cmd in ["write_file", "set_data_dir"] {
        assert!(call("prpopup", cmd).is_err(), "{cmd}");
    }
}
