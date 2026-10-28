// Other running app windows (processes) and the servers they are connected
// to, so the UI can warn when the same server is open twice: every window has
// its own connections, which doubles the requests a server sees.
//
// Each process keeps a small file `<data>/instances/<pid>.json` fresh; files
// that were not refreshed for a while belong to processes that are gone.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// A file older than this is a window that closed (beats come every 30 s).
const FRESH: Duration = Duration::from_secs(75);

#[derive(Serialize, Deserialize)]
struct Beat {
    server: Option<String>,
    at: u64,
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Removes this process's entry (the app is closing), so a window opened
/// right after does not take it for another one still running.
pub fn leave(data: &Path) {
    let _ = fs::remove_file(data.join("instances").join(format!("{}.json", std::process::id())));
}

/// Records this process's server (None when not connected) and returns the
/// servers of the other running processes.
pub fn beat(data: &Path, server: Option<String>) -> Result<Vec<String>, String> {
    let dir = data.join("instances");
    fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let own = format!("{}.json", std::process::id());
    let body = serde_json::to_string(&Beat { server, at: now() }).map_err(|e| e.to_string())?;
    fs::write(dir.join(&own), body).map_err(|e| e.to_string())?;

    let mut others = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        if entry.file_name().to_string_lossy() == own {
            continue;
        }
        let beat = fs::read_to_string(entry.path()).ok().and_then(|s| serde_json::from_str::<Beat>(&s).ok());
        match beat {
            Some(b) if now().saturating_sub(b.at) <= FRESH.as_secs() => others.extend(b.server),
            _ => {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
    Ok(others)
}
