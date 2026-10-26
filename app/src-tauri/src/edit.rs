//! Editing server files in place: temp copies, opening them in an editor,
//! and noticing when the editor saves them (polled once a second, which
//! also catches editors that replace the file instead of writing to it).

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

type Stamp = Option<(SystemTime, u64)>;

fn stamp(path: &Path) -> Stamp {
    let meta = fs::metadata(path).ok()?;
    Some((meta.modified().ok()?, meta.len()))
}

#[derive(Clone)]
pub struct Edits {
    base: PathBuf,
    watched: Arc<Mutex<HashMap<String, Stamp>>>,
}

impl Edits {
    /// `base` is the folder for all temp copies, e.g. `<temp>/<product>-edit`.
    pub fn new(base: PathBuf) -> Self {
        Edits { base, watched: Default::default() }
    }

    /// Calls `changed` with the path of every watched file that was saved.
    pub fn start(&self, changed: impl Fn(String) + Send + 'static) {
        let watched = self.watched.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_secs(1));
            let mut saved = Vec::new();
            {
                let mut files = watched.lock().unwrap();
                for (path, last) in files.iter_mut() {
                    let now = stamp(Path::new(path));
                    if now.is_some() && now != *last {
                        *last = now;
                        saved.push(path.clone());
                    }
                }
            }
            for path in saved {
                changed(path);
            }
        });
    }

    /// A fresh folder for one edited file, so names never collide.
    pub fn new_dir(&self) -> Result<String, String> {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let dir = self.base.join(format!("{}-{nanos}", std::process::id()));
        fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        Ok(dir.display().to_string())
    }

    /// Starts watching from the file's current state (after the download).
    pub fn watch(&self, path: &str) {
        self.watched.lock().unwrap().insert(path.to_string(), stamp(Path::new(path)));
    }

    pub fn unwatch(&self, path: &str) {
        self.watched.lock().unwrap().remove(path);
    }

    /// Deletes temp copies older than a day. Newer ones may belong to another
    /// window of the app that is still editing them.
    pub fn cleanup(&self) {
        let Ok(entries) = fs::read_dir(&self.base) else { return };
        let day = Duration::from_secs(24 * 60 * 60);
        for entry in entries.flatten() {
            let old = entry
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.elapsed().ok())
                .is_some_and(|age| age > day);
            if old {
                let _ = fs::remove_dir_all(entry.path());
            }
        }
    }
}

/// Opens `path` with `editor`, or with the program the system associates with it.
pub fn open(path: &str, editor: Option<&str>) -> Result<(), String> {
    match editor.filter(|e| !e.trim().is_empty()) {
        Some(editor) => Command::new(editor).arg(path).spawn().map(|_| ()).map_err(|e| format!("{editor}: {e}")),
        None => open::that(path).map_err(|e| format!("{path}: {e}")),
    }
}
