mod daemon;

use daemon::{Daemon, BRIDGE_ERROR};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

/// The running daemon, if it could be started.
#[derive(Default)]
struct DaemonState(Mutex<Option<Arc<Daemon>>>);

/// Forwards one JSON-RPC request to totzillad. Errors are JSON-RPC error objects.
#[tauri::command]
async fn daemon_call(state: tauri::State<'_, DaemonState>, method: String, params: Value) -> Result<Value, Value> {
    let daemon = state.0.lock().unwrap().clone();
    match daemon {
        Some(d) => d.call(&method, params).await,
        None => Err(json!({ "code": BRIDGE_ERROR, "message": "Daemon is not running" })),
    }
}

/// `--self-test <file>`: starts the bundled daemon, asks for its version and
/// writes the outcome as JSON to `<file>` without opening a window. Used by CI
/// on the installed app to prove the daemon and its libraries are bundled.
fn self_test(out: &str) -> i32 {
    let result = match Daemon::spawn(|_| {}, || {}) {
        Ok(d) => tauri::async_runtime::block_on(async {
            let hello = d.call("daemon.hello", json!({})).await;
            let _ = d.call("daemon.shutdown", json!({})).await;
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
        .invoke_handler(tauri::generate_handler![daemon_call])
        .run(tauri::generate_context!())
        .expect("error while running the application");
}
