mod daemon;
mod local;
mod secrets;

use daemon::{Daemon, BRIDGE_ERROR};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

/// The running daemon, if it could be started.
#[derive(Default)]
struct DaemonState(Mutex<Option<Arc<Daemon>>>);

/// Forwards one JSON-RPC request to totzillad. Errors are JSON-RPC error objects.
#[tauri::command]
async fn daemon_call(
    state: tauri::State<'_, DaemonState>,
    method: String,
    params: Value,
    id: Option<String>,
) -> Result<Value, Value> {
    let daemon = state.0.lock().unwrap().clone();
    match daemon {
        Some(d) => d.call(&method, params, id).await,
        None => Err(json!({ "code": BRIDGE_ERROR, "message": "Daemon is not running" })),
    }
}

#[tauri::command]
async fn local_list(path: String) -> Result<local::LocalListing, String> {
    tauri::async_runtime::spawn_blocking(move || local::list(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn local_home() -> String {
    local::home()
}

#[tauri::command]
fn local_roots() -> Vec<String> {
    local::roots()
}

/// Credentials are filed under the product name, so renaming the app only
/// needs the one productName in tauri.conf.json.
fn secret_service(app: &tauri::AppHandle) -> String {
    app.package_info().name.clone()
}

#[tauri::command]
fn secret_get(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    secrets::get(&secret_service(&app), &key)
}

#[tauri::command]
fn secret_set(app: tauri::AppHandle, key: String, password: String) -> Result<(), String> {
    secrets::set(&secret_service(&app), &key, &password)
}

#[tauri::command]
fn secret_delete(app: tauri::AppHandle, key: String) -> Result<(), String> {
    secrets::delete(&secret_service(&app), &key)
}

/// `--self-test <file>`: starts the bundled daemon, asks for its version and
/// writes the outcome as JSON to `<file>` without opening a window. Used by CI
/// on the installed app to prove the daemon and its libraries are bundled.
fn self_test(out: &str) -> i32 {
    let result = match Daemon::spawn(|_| {}, || {}) {
        Ok(d) => tauri::async_runtime::block_on(async {
            let hello = d.call("daemon.hello", json!({}), None).await;
            let _ = d.call("daemon.shutdown", json!({}), None).await;
            hello
        }),
        Err(err) => Err(json!({ "code": BRIDGE_ERROR, "message": err.to_string() })),
    };
    let ok = result.is_ok();
    let report = json!({
        "daemon": daemon::daemon_path().map(|p| p.display().to_string()).unwrap_or_default(),
        "result": result.as_ref().ok(),
        "error": result.as_ref().err(),
    });
    match std::fs::write(out, report.to_string()) {
        Ok(()) if ok => 0,
        _ => 1,
    }
}

pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() == 3 && args[1] == "--self-test" {
        std::process::exit(self_test(&args[2]));
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(DaemonState::default())
        .setup(|app| {
            let name = app.package_info().name.clone();
            if let Some(window) = app.get_webview_window("main") {
                window.set_title(&name)?;
            }

            let events = app.handle().clone();
            let exits = app.handle().clone();
            match Daemon::spawn(
                move |msg| {
                    let _ = events.emit("daemon-event", msg);
                },
                move || {
                    if let Some(state) = exits.try_state::<DaemonState>() {
                        state.0.lock().unwrap().take();
                    }
                    let _ = exits.emit("daemon-exit", ());
                },
            ) {
                Ok(d) => *app.state::<DaemonState>().0.lock().unwrap() = Some(d),
                Err(err) => eprintln!("cannot start the daemon: {err}"),
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            daemon_call,
            local_list,
            local_home,
            local_roots,
            secret_get,
            secret_set,
            secret_delete
        ])
        .run(tauri::generate_context!())
        .expect("error while running the application");
}
