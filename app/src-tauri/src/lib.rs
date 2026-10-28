mod daemon;
mod edit;
mod git;
mod github;
mod gitrepo;
mod instances;
mod local;
mod migrate;
mod secrets;
mod support;

use daemon::{Daemon, BRIDGE_ERROR};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

/// The running daemon, if it could be started.
#[derive(Default)]
struct DaemonState(Mutex<Option<Arc<Daemon>>>);

/// Forwards one JSON-RPC request to paromd. Errors are JSON-RPC error objects.
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
async fn local_walk(path: String) -> Result<local::LocalTree, String> {
    tauri::async_runtime::spawn_blocking(move || local::walk(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn local_mkdir(path: String) -> Result<(), String> {
    local::mkdir(&path)
}

#[tauri::command]
fn local_rename(from: String, to: String) -> Result<(), String> {
    local::rename(&from, &to)
}

#[tauri::command]
async fn local_trash(paths: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || local::trash(&paths))
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

#[tauri::command]
fn edit_new_dir(edits: tauri::State<'_, edit::Edits>) -> Result<String, String> {
    edits.new_dir()
}

#[tauri::command]
fn edit_open(path: String, editor: Option<String>) -> Result<(), String> {
    edit::open(&path, editor.as_deref())
}

#[tauri::command]
fn edit_watch(edits: tauri::State<'_, edit::Edits>, path: String) {
    edits.watch(&path);
}

#[tauri::command]
fn edit_unwatch(edits: tauri::State<'_, edit::Edits>, path: String) {
    edits.unwatch(&path);
}

#[tauri::command]
fn edit_cleanup(edits: tauri::State<'_, edit::Edits>) {
    edits.cleanup();
}

// Server sync: local git (blocking work runs off the UI thread).
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn git_status(dir: String) -> Result<git::RepoStatus, String> {
    blocking(move || git::status(&dir)).await
}

#[tauri::command]
async fn git_tree(dir: String, rev: String) -> Result<Vec<git::TreeFile>, String> {
    blocking(move || git::tree(&dir, &rev)).await
}

#[tauri::command]
async fn git_has_commit(dir: String, sha: String) -> Result<bool, String> {
    blocking(move || git::has_commit(&dir, &sha)).await
}

#[tauri::command]
async fn git_is_ancestor(dir: String, ancestor: String, descendant: String) -> Result<bool, String> {
    blocking(move || git::is_ancestor(&dir, &ancestor, &descendant)).await
}

#[tauri::command]
async fn git_commits_between(dir: String, from: String, to: String) -> Result<usize, String> {
    blocking(move || git::commits_between(&dir, &from, &to)).await
}

#[tauri::command]
async fn git_diff(dir: String, from: String, to: String) -> Result<Vec<git::Change>, String> {
    blocking(move || git::diff(&dir, &from, &to)).await
}

#[tauri::command]
async fn git_read_file(dir: String, rev: String, path: String) -> Result<String, String> {
    blocking(move || git::read_file(&dir, &rev, &path)).await
}

#[tauri::command]
async fn git_export(dir: String, rev: String, paths: Vec<String>, dest: String) -> Result<(), String> {
    blocking(move || git::export(&dir, &rev, &paths, &dest)).await
}

#[derive(serde::Serialize)]
struct AppPaths {
    data: String,
    backups: String,
    history: String,
}

#[tauri::command]
fn app_paths(app: tauri::AppHandle) -> Result<AppPaths, String> {
    let data = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let s = |p: std::path::PathBuf| p.display().to_string();
    Ok(AppPaths { backups: s(data.join("backups")), history: s(data.join("history")), data: s(data) })
}

/// Keeps this window's entry fresh; returns the servers other windows are connected to.
#[tauri::command]
fn instance_beat(app: tauri::AppHandle, server: Option<String>) -> Result<Vec<String>, String> {
    let data = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    instances::beat(&data, server)
}

#[tauri::command]
fn read_small_file(path: String) -> Result<String, String> {
    support::read_small(&path)
}

#[tauri::command]
fn write_small_file(path: String, content: String) -> Result<(), String> {
    support::write_small(&path, &content)
}

#[tauri::command]
fn append_line(path: String, line: String) -> Result<(), String> {
    support::append_line(&path, &line)
}

#[tauri::command]
async fn remove_backup(path: String) -> Result<(), String> {
    blocking(move || support::remove_dir(&path)).await
}

#[tauri::command]
async fn compare_files(downloaded: String, local: String) -> Result<String, String> {
    blocking(move || support::compare_files(&downloaded, &local).map(str::to_owned)).await
}

#[tauri::command]
async fn copy_file(from: String, to: String) -> Result<(), String> {
    blocking(move || support::copy_file(&from, &to)).await
}

#[tauri::command]
async fn dir_size(path: String) -> Result<u64, String> {
    blocking(move || Ok(support::dir_size(&path))).await
}

#[tauri::command]
fn machine_name() -> String {
    support::machine_name()
}

#[tauri::command]
async fn run_command(command: String, cwd: Option<String>) -> Result<support::CommandResult, String> {
    blocking(move || support::run_command(&command, cwd.as_deref())).await
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

/// Copies passwords saved under the app's old name (once, after a rename).
#[tauri::command]
async fn secret_migrate(app: tauri::AppHandle, keys: Vec<String>) -> Result<usize, String> {
    blocking(move || Ok(migrate::secrets(&secret_service(&app), &keys))).await
}

#[tauri::command]
fn secret_delete(app: tauri::AppHandle, key: String) -> Result<(), String> {
    secrets::delete(&secret_service(&app), &key)
}

// GitHub tab: the token lives in the credential store and is only read here.
fn user_agent(app: &tauri::AppHandle) -> String {
    format!("{}/{}", app.package_info().name, app.package_info().version)
}

fn github_token(app: &tauri::AppHandle) -> Result<Option<String>, String> {
    secrets::get(&secret_service(app), github::TOKEN_KEY)
}

/// The signed-in account, or None. A token GitHub no longer accepts is dropped.
#[tauri::command]
async fn github_user(app: tauri::AppHandle) -> Result<Option<Value>, String> {
    blocking(move || {
        let Some(token) = github_token(&app)? else { return Ok(None) };
        match github::user(&user_agent(&app), &token) {
            Ok(u) => Ok(Some(u)),
            Err(e) if e.status == 401 => {
                secrets::delete(&secret_service(&app), github::TOKEN_KEY)?;
                Ok(None)
            }
            Err(e) => Err(e.into()),
        }
    })
    .await
}

/// Checks a personal access token and keeps it if GitHub accepts it.
#[tauri::command]
async fn github_sign_in_token(app: tauri::AppHandle, token: String) -> Result<Value, String> {
    blocking(move || {
        let token = token.trim().to_owned();
        let user = github::user(&user_agent(&app), &token)?;
        secrets::set(&secret_service(&app), github::TOKEN_KEY, &token)?;
        Ok(user)
    })
    .await
}

#[tauri::command]
fn github_sign_out(app: tauri::AppHandle) -> Result<(), String> {
    secrets::delete(&secret_service(&app), github::TOKEN_KEY)
}

#[tauri::command]
async fn github_device_start(app: tauri::AppHandle) -> Result<github::DeviceCode, String> {
    blocking(move || github::device_start(&user_agent(&app))).await
}

/// One poll of the device flow: the user once approved, None while waiting.
#[tauri::command]
async fn github_device_poll(app: tauri::AppHandle, device_code: String) -> Result<Option<Value>, String> {
    blocking(move || {
        let ua = user_agent(&app);
        let Some(token) = github::device_poll(&ua, &device_code)? else { return Ok(None) };
        let user = github::user(&ua, &token)?;
        secrets::set(&secret_service(&app), github::TOKEN_KEY, &token)?;
        Ok(Some(user))
    })
    .await
}

/// A REST call as the signed-in user; `path` is relative to api.github.com.
#[tauri::command]
async fn github_api(
    app: tauri::AppHandle,
    method: String,
    path: String,
    body: Option<Value>,
    html: Option<bool>,
) -> Result<Value, String> {
    blocking(move || {
        let token = github_token(&app)?.ok_or("Not signed in to GitHub")?;
        Ok(github::api(&user_agent(&app), &token, &method, &path, body, html.unwrap_or(false))?)
    })
    .await
}

/// Opens a web page in the default browser (https only: links in issues and
/// pull requests, GitHub settings pages).
#[tauri::command]
fn open_github_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err(format!("not an https URL: {url}"));
    }
    open::that_detached(&url).map_err(|e| e.to_string())
}

#[tauri::command]
async fn repo_info(dir: String) -> Result<gitrepo::BranchInfo, String> {
    blocking(move || gitrepo::branch_info(&dir)).await
}

#[tauri::command]
async fn repo_changes(dir: String) -> Result<Vec<gitrepo::FileChange>, String> {
    blocking(move || gitrepo::changes(&dir)).await
}

#[tauri::command]
async fn repo_file_diff(dir: String, path: String, rev: Option<String>) -> Result<gitrepo::FileDiff, String> {
    blocking(move || gitrepo::file_diff(&dir, &path, rev.as_deref())).await
}

#[tauri::command]
async fn repo_commit(
    dir: String,
    paths: Vec<String>,
    message: String,
    name: Option<String>,
    email: Option<String>,
) -> Result<String, String> {
    blocking(move || gitrepo::commit(&dir, &paths, &message, name.as_deref(), email.as_deref())).await
}

#[tauri::command]
async fn repo_log(dir: String, limit: usize) -> Result<Vec<gitrepo::LogEntry>, String> {
    blocking(move || gitrepo::log(&dir, limit)).await
}

#[tauri::command]
async fn repo_commit_files(dir: String, rev: String) -> Result<Vec<gitrepo::CommitFile>, String> {
    blocking(move || gitrepo::commit_files(&dir, &rev)).await
}

/// fetch, pull (fast-forward only) or push origin, with the GitHub token.
#[tauri::command]
async fn repo_remote(
    app: tauri::AppHandle,
    dir: String,
    op: String,
    name: Option<String>,
    email: Option<String>,
) -> Result<gitrepo::BranchInfo, String> {
    blocking(move || {
        let token = github_token(&app).ok().flatten();
        match op.as_str() {
            "fetch" => gitrepo::fetch(&dir, token.as_deref()),
            "pull" => gitrepo::pull(&dir, token.as_deref(), name.as_deref(), email.as_deref()),
            "push" => gitrepo::push(&dir, token.as_deref()),
            _ => Err(format!("unknown operation: {op}")),
        }
    })
    .await
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

    let context = tauri::generate_context!();
    // Data from the app's working name moves over before any window opens.
    migrate::data_dirs(&context.config().identifier);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_drag::init())
        .manage(DaemonState::default())
        .setup(|app| {
            let name = app.package_info().name.clone();
            if let Some(window) = app.get_webview_window("main") {
                window.set_title(&name)?;
            }

            // Temp copies of edited server files; day-old left-overs go first.
            let edits = edit::Edits::new(std::env::temp_dir().join(format!("{name}-edit")));
            edits.cleanup();
            let saved = app.handle().clone();
            edits.start(move |path| {
                let _ = saved.emit("edit-saved", path);
            });
            app.manage(edits);

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
                Ok(d) => {
                    // Persistent daemon state (trusted keys) lives in the app data folder.
                    // Done before the UI can open a session.
                    match app.path().app_data_dir() {
                        Ok(dir) => {
                            let init = tauri::async_runtime::block_on(
                                d.call("daemon.init", json!({ "data_dir": dir.display().to_string() }), None),
                            );
                            if let Err(err) = init {
                                eprintln!("daemon.init failed: {err}");
                            }
                        }
                        Err(err) => eprintln!("no app data folder: {err}"),
                    }
                    *app.state::<DaemonState>().0.lock().unwrap() = Some(d);
                }
                Err(err) => eprintln!("cannot start the daemon: {err}"),
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            daemon_call,
            instance_beat,
            local_list,
            local_walk,
            local_mkdir,
            local_rename,
            local_trash,
            local_home,
            local_roots,
            secret_get,
            secret_set,
            secret_delete,
            secret_migrate,
            edit_new_dir,
            edit_open,
            edit_watch,
            edit_unwatch,
            edit_cleanup,
            git_status,
            git_tree,
            git_has_commit,
            git_is_ancestor,
            git_commits_between,
            git_diff,
            git_read_file,
            git_export,
            app_paths,
            read_small_file,
            write_small_file,
            append_line,
            remove_backup,
            dir_size,
            compare_files,
            copy_file,
            machine_name,
            run_command,
            github_user,
            github_sign_in_token,
            github_sign_out,
            github_device_start,
            github_device_poll,
            github_api,
            open_github_url,
            repo_info,
            repo_changes,
            repo_file_diff,
            repo_commit,
            repo_log,
            repo_commit_files,
            repo_remote
        ])
        .run(context)
        .expect("error while running the application");
}
