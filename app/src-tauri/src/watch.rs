//! Live changes for the GitHub tab, as in GitHub Desktop: the open
//! repository's folder is watched, and the UI hears "repo-fs" at most every
//! 300 ms while files change, then reads the status again.

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Default)]
pub struct RepoWatch {
    watcher: Mutex<Option<RecommendedWatcher>>,
    dirty: Arc<AtomicBool>,
}

impl RepoWatch {
    /// Calls `on_change` from a background thread after files changed.
    pub fn start(&self, on_change: impl Fn() + Send + 'static) {
        let dirty = self.dirty.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_millis(300));
            if dirty.swap(false, Ordering::Relaxed) {
                on_change();
            }
        });
    }

    /// Watches `dir` instead of the folder watched before; "" stops watching.
    pub fn watch(&self, dir: &str) -> Result<(), String> {
        let mut slot = self.watcher.lock().map_err(|e| e.to_string())?;
        *slot = None;
        if dir.is_empty() {
            return Ok(());
        }
        let dirty = self.dirty.clone();
        let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
            if let Ok(ev) = res {
                if !matches!(ev.kind, EventKind::Access(_)) && ev.paths.iter().any(|p| relevant(p)) {
                    dirty.store(true, Ordering::Relaxed);
                }
            }
        })
        .map_err(|e| e.to_string())?;
        watcher.watch(Path::new(dir), RecursiveMode::Recursive).map_err(|e| e.to_string())?;
        *slot = Some(watcher);
        Ok(())
    }
}

/// Inside `.git` only the index and HEAD matter (commits and checkouts made
/// with other tools); objects, logs and FETCH_HEAD change on every fetch.
fn relevant(p: &Path) -> bool {
    let parts: Vec<String> = p.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
    match parts.iter().position(|c| c == ".git") {
        None => true,
        Some(i) => matches!(parts.get(i + 1).map(String::as_str), Some("index" | "HEAD")),
    }
}
