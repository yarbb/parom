//! Runs totzillad as a child process and speaks JSON-RPC 2.0 with it over
//! stdin/stdout (see daemon/PROTOCOL.md).

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{self, BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;

/// Error code used for failures between the app and the daemon process.
pub const BRIDGE_ERROR: i64 = -32099;

type Reply = Result<Value, Value>;

#[derive(Default)]
struct Pending {
    alive: bool,
    waiting: HashMap<u64, oneshot::Sender<Reply>>,
}

pub struct Daemon {
    stdin: Mutex<ChildStdin>,
    pending: Arc<Mutex<Pending>>,
    next_id: AtomicU64,
}

fn bridge_error(message: impl Into<String>) -> Value {
    json!({ "code": BRIDGE_ERROR, "message": message.into() })
}

/// The daemon ships next to the app executable in `daemon/`.
/// `TOTZILLA_DAEMON` overrides the path for development.
pub fn daemon_path() -> io::Result<PathBuf> {
    if let Some(path) = std::env::var_os("TOTZILLA_DAEMON") {
        return Ok(path.into());
    }
    let exe = std::env::current_exe()?;
    let dir = exe
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "executable has no parent directory"))?;
    let name = if cfg!(windows) { "totzillad.exe" } else { "totzillad" };
    Ok(dir.join("daemon").join(name))
}

impl Daemon {
    /// Starts the daemon. `on_event` receives notifications (messages
    /// without an id); `on_exit` runs once when the daemon's stdout closes.
    pub fn spawn<E, X>(on_event: E, on_exit: X) -> io::Result<Arc<Daemon>>
    where
        E: Fn(Value) + Send + 'static,
        X: FnOnce() + Send + 'static,
    {
        let path = daemon_path()?;
        let mut cmd = Command::new(&path);
        cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::inherit());
        if let Some(dir) = path.parent() {
            cmd.current_dir(dir);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = cmd.spawn()?;
        let stdin = child.stdin.take().expect("stdin is piped");
        let stdout = child.stdout.take().expect("stdout is piped");

        let pending = Arc::new(Mutex::new(Pending { alive: true, ..Default::default() }));
        let reader_pending = pending.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                let Ok(msg) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                match msg.get("id").and_then(Value::as_u64) {
                    Some(id) => {
                        let tx = reader_pending.lock().unwrap().waiting.remove(&id);
                        if let Some(tx) = tx {
                            let reply = match msg.get("error") {
                                Some(err) => Err(err.clone()),
                                None => Ok(msg.get("result").cloned().unwrap_or(Value::Null)),
                            };
                            let _ = tx.send(reply);
                        }
                    }
                    None if msg.get("method").is_some() => on_event(msg),
                    None => {}
                }
            }

            let waiting = {
                let mut p = reader_pending.lock().unwrap();
                p.alive = false;
                std::mem::take(&mut p.waiting)
            };
            for (_, tx) in waiting {
                let _ = tx.send(Err(bridge_error("Daemon exited")));
            }
            let _ = child.wait();
            on_exit();
        });

        Ok(Arc::new(Daemon { stdin: Mutex::new(stdin), pending, next_id: AtomicU64::new(1) }))
    }

    /// Sends a request and waits for its result or JSON-RPC error object.
    pub async fn call(&self, method: &str, params: Value) -> Reply {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        {
            let mut p = self.pending.lock().unwrap();
            if !p.alive {
                return Err(bridge_error("Daemon is not running"));
            }
            p.waiting.insert(id, tx);
        }

        let line = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }).to_string();
        let written = {
            let mut stdin = self.stdin.lock().unwrap();
            writeln!(stdin, "{line}").and_then(|_| stdin.flush())
        };
        if let Err(err) = written {
            self.pending.lock().unwrap().waiting.remove(&id);
            return Err(bridge_error(format!("Cannot reach the daemon: {err}")));
        }

        rx.await.unwrap_or_else(|_| Err(bridge_error("Daemon exited")))
    }
}
